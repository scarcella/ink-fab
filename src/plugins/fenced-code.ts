import type { InkFabPlugin } from './types';
import type { EditorView } from '@codemirror/view';
import { lineClasses } from './lib/lines';

// Base styling for code blocks shown as source: mono font, sunken background.
// Applies to every fence — the highlight/mermaid plugins replace the ones
// they can render, and this styling is what you see when the caret is inside.
// An empty fence with the caret inside it, on this line if it's empty or
// below it if not.
function insertCodeBlock(view: EditorView) {
  const line = view.state.doc.lineAt(view.state.selection.main.head);
  const empty = !line.text.trim();
  const open = (empty ? '' : '\n') + '```\n';
  const from = empty ? line.from : line.to;
  view.dispatch({
    changes: { from, to: line.to, insert: open + '\n```' },
    selection: { anchor: from + open.length },
    userEvent: 'input.code',
  });
  return true;
}

export function fencedCode(): InkFabPlugin {
  return {
    name: 'fenced-code',
    commands: [{ name: 'Code block', aliases: ['fence', 'snippet'], run: insertCodeBlock }],
    nodes: [
      {
        node: 'FencedCode',
        render: (node, ctx) => lineClasses(ctx.state, node.from, node.to, 'cm-code-line'),
      },
      {
        node: 'CodeBlock',
        render: (node, ctx) => lineClasses(ctx.state, node.from, node.to, 'cm-code-line'),
      },
    ],
    styles: `
.cm-editor .cm-code-line {
  font-family: var(--font-mono);
  font-size: 0.88em;
  background: var(--bg-code);
  line-height: 1.6;
  padding-left: 1.25em;
  padding-right: 1.25em;
}
`,
  };
}
