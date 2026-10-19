import {
  autocompletion,
  type CompletionContext,
  type CompletionResult,
} from '@codemirror/autocomplete';
import { syntaxTree } from '@codemirror/language';
import { EditorView } from '@codemirror/view';
import type { EditorState } from '@codemirror/state';
import type { SyntaxNode } from '@lezer/common';
import type { InkFabPlugin } from './types';
import { commandsFacet, formatKey } from './lib/commands';

// Typing `/` at the start of a line or after a space opens a menu of every
// plugin's commands, each with its shortcut, so the menu teaches the keys.
// The `/` is ordinary text the whole time: keep typing and the menu filters,
// and once nothing matches (`/usr/bin`), or on Space or Esc, it closes and
// leaves what you typed. Mid-word slashes (and/or, 1/2, https://), pasted
// text and code never open it.

const CODE_NODES = new Set(['FencedCode', 'CodeBlock', 'InlineCode', 'CodeText']);

function inCode(state: EditorState, pos: number) {
  for (let n: SyntaxNode | null = syntaxTree(state).resolveInner(pos, -1); n; n = n.parent) {
    if (CODE_NODES.has(n.name)) return true;
  }
  return false;
}

function slashSource(ctx: CompletionContext): CompletionResult | null {
  const m = ctx.matchBefore(/\/\w*/);
  if (!m) return null;
  const lineStart = ctx.state.doc.lineAt(m.from).from;
  if (m.from > lineStart && !/\s/.test(ctx.state.sliceDoc(m.from - 1, m.from))) return null;
  if (inCode(ctx.state, m.from)) return null;

  // Match the start of any word in the name or its aliases: "/todo", "/h2".
  const q = ' ' + m.text.slice(1).toLowerCase();
  const commands = ctx.state
    .facet(commandsFacet)
    .filter((c) => [c.name, ...(c.aliases ?? [])].some((w) => (' ' + w.toLowerCase()).includes(q)));
  if (!commands.length) return null;

  return {
    from: m.from,
    filter: false, // we filtered above, aliases included
    options: commands.map((c) => ({
      label: c.name,
      detail: c.key ? formatKey(c.key) : undefined,
      apply: (view: EditorView, _completion: unknown, from: number, to: number) => {
        view.dispatch({ changes: { from, to }, userEvent: 'delete.slash' });
        c.run(view);
      },
    })),
  };
}

const menuTheme = EditorView.theme({
  '.cm-tooltip.cm-tooltip-autocomplete': {
    background: 'var(--bg)',
    border: '1px solid var(--border)',
    borderRadius: '6px',
    boxShadow: '0 4px 16px var(--shadow)',
    padding: '4px',
  },
  '.cm-tooltip.cm-tooltip-autocomplete > ul': {
    fontFamily: 'var(--font-sans)',
    fontSize: '13px',
    minWidth: '220px',
    maxHeight: '18em',
  },
  '.cm-tooltip.cm-tooltip-autocomplete > ul > li': {
    display: 'flex',
    justifyContent: 'space-between',
    gap: '24px',
    padding: '4px 8px',
    borderRadius: '4px',
    color: 'var(--fg)',
  },
  '.cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected]': {
    background: 'var(--accent-soft)',
    color: 'var(--fg)',
  },
  '.cm-completionDetail': {
    fontStyle: 'normal',
    color: 'var(--fg-muted)',
    marginLeft: 'auto',
  },
});

export function slashMenu(): InkFabPlugin {
  return {
    name: 'slash-menu',
    extensions: [autocompletion({ override: [slashSource], icons: false }), menuTheme],
  };
}
