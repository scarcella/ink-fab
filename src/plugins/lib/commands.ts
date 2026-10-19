import { Facet, type ChangeSpec, type EditorState, type Line } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import type { Command } from '../types';

// Every plugin's commands, collected by the runtime. The / menu reads them
// from here, so any plugin that declares a command shows up in it.
export const commandsFacet = Facet.define<Command[], Command[]>({
  combine: (values) => values.flat(),
});

const isMac = typeof navigator !== 'undefined' && /Mac/.test(navigator.platform);

/** 'Mod-Shift-9' → '⇧⌘9' on macOS, 'Ctrl+Shift+9' elsewhere. */
export function formatKey(key: string) {
  const parts = key.split('-');
  const base = parts.pop()!;
  const has = (m: string) => parts.includes(m);
  const name = base === 'Enter' ? (isMac ? '↵' : 'Enter') : base.toUpperCase();
  if (!isMac) {
    const mods = [has('Mod') || has('Ctrl') ? 'Ctrl' : '', has('Alt') ? 'Alt' : '', has('Shift') ? 'Shift' : ''];
    return [...mods.filter(Boolean), name].join('+');
  }
  return (
    (has('Ctrl') ? '⌃' : '') +
    (has('Alt') ? '⌥' : '') +
    (has('Shift') ? '⇧' : '') +
    (has('Mod') || has('Meta') ? '⌘' : '') +
    name
  );
}

/**
 * The lines a line command acts on. Blank lines inside a multi-line selection
 * are skipped so the gaps between items stay gaps.
 */
export function selectedLines(state: EditorState): Line[] {
  const lines = new Map<number, Line>();
  for (const r of state.selection.ranges) {
    const first = state.doc.lineAt(r.from).number;
    const last = state.doc.lineAt(r.to).number;
    for (let n = first; n <= last; n++) {
      const line = state.doc.line(n);
      if (first !== last && !line.text.trim()) continue;
      lines.set(n, line);
    }
  }
  return [...lines.values()].sort((a, b) => a.number - b.number);
}

/**
 * Applies line edits with the caret pushed past anything inserted at it, so
 * running "Heading 1" on an empty line leaves you typing after the `# `.
 */
export function dispatchLineChanges(view: EditorView, changes: ChangeSpec[], userEvent: string) {
  const set = view.state.changes(changes);
  view.dispatch({ changes: set, selection: view.state.selection.map(set, 1), userEvent });
}

const BLOCK_RE = /^(\s*)(#{1,6}\s+|>\s?)?/;

/**
 * Gives the selected lines a block prefix (`# `, `> `), replacing any other
 * one. If the first line already has this prefix, removes it instead, the
 * way the Google Docs style keys toggle.
 */
export function toggleBlockPrefix(prefix: string) {
  return (view: EditorView) => {
    const lines = selectedLines(view.state);
    const off = BLOCK_RE.exec(lines[0].text)![2]?.trim() === prefix.trim();
    const changes = lines.map((line) => {
      const [whole, indent] = BLOCK_RE.exec(line.text)!;
      return { from: line.from + indent.length, to: line.from + whole.length, insert: off ? '' : prefix };
    });
    dispatchLineChanges(view, changes, 'input.block');
    return true;
  };
}
