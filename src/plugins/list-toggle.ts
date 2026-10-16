import { keymap, type EditorView } from '@codemirror/view';
import { Prec, type ChangeSpec, type EditorState, type Line } from '@codemirror/state';
import type { InkFabPlugin } from './types';

// ⇧⌘7 / ⇧⌘8 switch the selected lines to a numbered / bulleted list (the
// Google Docs keys). Pressing the key for the type a line already has turns
// the list off. Numbers continue from the item above at the same indent, and
// the numbered items that follow are renumbered so interleaving a bullet and
// switching it back never leaves a stale count. Task boxes are kept.
//
// Tab / Shift-Tab on a list item follow the list's structure instead of a
// fixed indent unit: Tab nests the item under the one above it (aligned to
// that item's text), Shift-Tab moves it out to its parent item's level and
// continues the parent's list. A fixed 2-space step can't do this — "1. " is
// three columns wide — and left items stranded between levels, restarting
// their numbering at 1.

type Kind = 'bullet' | 'ordered';

const MARKER_RE = /^(\s*)(?:([-*+])|(\d+)[.)])\s+/;

type Parsed = { indent: string; kind: Kind | null; markerEnd: number; num: number };

function parse(text: string): Parsed {
  const m = MARKER_RE.exec(text);
  if (!m) {
    const indent = /^\s*/.exec(text)![0];
    return { indent, kind: null, markerEnd: indent.length, num: 0 };
  }
  return {
    indent: m[1],
    kind: m[2] ? 'bullet' : 'ordered',
    markerEnd: m[0].length,
    num: m[3] ? Number(m[3]) : 0,
  };
}

// The number the item just above `line` (same indent, same list) ends on.
function countAbove(state: EditorState, line: Line, indent: string) {
  for (let n = line.number - 1; n >= 1; n--) {
    const text = state.doc.line(n).text;
    if (!text.trim()) return 0;
    const p = parse(text);
    if (p.indent.length > indent.length) continue; // a nested child
    if (p.indent.length < indent.length || !p.kind) return 0;
    if (p.kind === 'ordered') return p.num;
  }
  return 0;
}

// Renumbers the run of numbered items at `indent` that follows `after`,
// counting on from `start` and stepping over nested children.
function renumberAfter(
  state: EditorState,
  after: Line,
  indent: string,
  start: number,
  changes: ChangeSpec[]
) {
  let n = start;
  for (let i = after.number + 1; i <= state.doc.lines; i++) {
    const line = state.doc.line(i);
    if (!line.text.trim()) return;
    const p = parse(line.text);
    if (p.indent.length > indent.length) continue;
    if (p.indent.length < indent.length || p.kind !== 'ordered') return;
    n++;
    if (p.num !== n) {
      const numFrom = line.from + p.indent.length;
      changes.push({ from: numFrom, to: numFrom + String(p.num).length, insert: String(n) });
    }
  }
}

// The list item above `line` that is its sibling (same indent) or parent
// (shallower), stepping over nested lines; null if the list ends first.
function findAbove(state: EditorState, line: Line, indent: string, want: 'sibling' | 'parent') {
  for (let n = line.number - 1; n >= 1; n--) {
    const text = state.doc.line(n).text;
    if (!text.trim()) return null;
    const p = parse(text);
    if (want === 'sibling' && p.indent.length > indent.length) continue;
    if (want === 'parent' && p.indent.length >= indent.length) continue;
    if (!p.kind) return null;
    if (want === 'sibling' && p.indent.length !== indent.length) return null;
    return { line: state.doc.line(n), ...p };
  }
  return null;
}

function shiftItem(dir: 'in' | 'out') {
  return (view: EditorView) => {
    const { state } = view;
    const sel = state.selection.main;
    const line = state.doc.lineAt(sel.from);
    if (state.selection.ranges.length > 1 || state.doc.lineAt(sel.to).number !== line.number) {
      return false; // multi-line: leave it to the stock indent commands
    }
    const p = parse(line.text);
    if (!p.kind) return false;

    let indent: string;
    let marker: string;
    const changes: ChangeSpec[] = [];
    if (dir === 'in') {
      const sib = findAbove(state, line, p.indent, 'sibling');
      if (!sib) return false;
      indent = ' '.repeat(sib.markerEnd);
      // Join the nested list already there, taking its type; else keep ours.
      const prev = findAbove(state, line, indent, 'sibling');
      const kind = prev?.kind ?? p.kind;
      marker =
        kind === 'ordered'
          ? `${(prev?.num ?? 0) + 1}. `
          : prev
            ? `${prev.line.text[prev.indent.length]} `
            : line.text.slice(p.indent.length, p.markerEnd);
      renumberAfter(state, line, p.indent, sib.num, changes); // the list it left
    } else {
      const parent = findAbove(state, line, p.indent, 'parent');
      if (!parent) return false;
      indent = parent.indent;
      marker =
        parent.kind === 'ordered'
          ? `${parent.num + 1}. `
          : `${parent.line.text[parent.indent.length]} `;
      renumberAfter(state, line, indent, parent.num + 1, changes); // the list it joined
      renumberAfter(state, line, p.indent, 0, changes); // siblings now nested under it
    }

    const markerEnd = line.from + p.markerEnd;
    const shift = indent.length + marker.length - p.markerEnd;
    changes.push({ from: line.from, to: markerEnd, insert: indent + marker });
    const place = (pos: number) => (pos <= markerEnd ? markerEnd + shift : pos + shift);
    view.dispatch({
      changes,
      selection: { anchor: place(sel.anchor), head: place(sel.head) },
      userEvent: 'input.indent',
    });
    return true;
  };
}

function toggleList(kind: Kind) {
  return (view: EditorView) => {
    const { state } = view;
    const lines: Line[] = [];
    for (const r of state.selection.ranges) {
      for (let n = state.doc.lineAt(r.from).number; n <= state.doc.lineAt(r.to).number; n++) {
        if (!lines.some((l) => l.number === n)) lines.push(state.doc.line(n));
      }
    }
    lines.sort((a, b) => a.number - b.number);

    // The first line decides: already this kind → turn the list off.
    const off = parse(lines[0].text).kind === kind;
    const changes: ChangeSpec[] = [];
    const counters = new Map<string, number>(); // next number per indent

    for (const line of lines) {
      const p = parse(line.text);
      let marker = '';
      if (!off) {
        if (kind === 'bullet') marker = '- ';
        else {
          const next = (counters.get(p.indent) ?? countAbove(state, line, p.indent)) + 1;
          counters.set(p.indent, next);
          marker = `${next}. `;
        }
      }
      const from = line.from + p.indent.length;
      changes.push({ from, to: line.from + p.markerEnd, insert: marker });
    }

    // Renumber the numbered items that follow, per indent touched. Lines that
    // just stopped being numbered are skipped over, so the items after them
    // keep counting from the item above.
    const last = lines[lines.length - 1];
    const indents = new Map<string, number>();
    for (const line of lines) {
      const indent = parse(line.text).indent;
      indents.set(indent, counters.get(indent) ?? countAbove(state, lines[0], indent));
    }
    for (const [indent, start] of indents) renumberAfter(state, last, indent, start, changes);

    view.dispatch({ changes, userEvent: 'input.list' });
    return true;
  };
}

export function listToggle(): InkFabPlugin {
  return {
    name: 'list-toggle',
    extensions: [
      // High precedence so Tab reaches us before the editor's indentWithTab.
      Prec.high(
        keymap.of([
          { key: 'Mod-Shift-7', run: toggleList('ordered') },
          { key: 'Mod-Shift-8', run: toggleList('bullet') },
          { key: 'Tab', run: shiftItem('in') },
          { key: 'Shift-Tab', run: shiftItem('out') },
        ])
      ),
    ],
  };
}
