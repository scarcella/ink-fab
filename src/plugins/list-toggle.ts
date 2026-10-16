import { keymap, type EditorView } from '@codemirror/view';
import type { ChangeSpec, EditorState, Line } from '@codemirror/state';
import type { InkFabPlugin } from './types';

// ⇧⌘7 / ⇧⌘8 switch the selected lines to a numbered / bulleted list (the
// Google Docs keys). Pressing the key for the type a line already has turns
// the list off. Numbers continue from the item above at the same indent, and
// the numbered items that follow are renumbered so interleaving a bullet and
// switching it back never leaves a stale count. Task boxes are kept.

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
    for (const [indent, start] of indents) {
      let n = start;
      for (let i = last.number + 1; i <= state.doc.lines; i++) {
        const line = state.doc.line(i);
        if (!line.text.trim()) break;
        const p = parse(line.text);
        if (p.indent.length > indent.length) continue;
        if (p.indent.length < indent.length || p.kind !== 'ordered') break;
        n++;
        if (p.num !== n) {
          const numFrom = line.from + p.indent.length;
          changes.push({ from: numFrom, to: numFrom + String(p.num).length, insert: String(n) });
        }
      }
    }

    view.dispatch({ changes, userEvent: 'input.list' });
    return true;
  };
}

export function listToggle(): InkFabPlugin {
  return {
    name: 'list-toggle',
    extensions: [
      keymap.of([
        { key: 'Mod-Shift-7', run: toggleList('ordered') },
        { key: 'Mod-Shift-8', run: toggleList('bullet') },
      ]),
    ],
  };
}
