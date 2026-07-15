import type { InkFabPlugin } from './types';
import { lineClasses } from './lib/lines';

// Blockquote lines get a muted, italic, left-ruled treatment. The `>` marks
// themselves are hidden by the mark-hiding plugin.
export function blockquotes(): InkFabPlugin {
  return {
    name: 'blockquotes',
    nodes: [
      {
        node: 'Blockquote',
        render: (node, ctx) => lineClasses(ctx.state, node.from, node.to, 'cm-quote'),
      },
    ],
    styles: `
.cm-editor .cm-quote {
  color: var(--fg-muted);
  font-style: italic;
  border-left: 2px solid var(--border);
  padding-left: 1.2em;
  margin-left: -1.2em;
}
`,
  };
}
