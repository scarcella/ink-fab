import type { InkFabPlugin } from './types';
import { lineClasses } from './lib/lines';

// Base styling for code blocks shown as source: mono font, sunken background.
// Applies to every fence — the highlight/mermaid plugins replace the ones
// they can render, and this styling is what you see when the caret is inside.
export function fencedCode(): InkFabPlugin {
  return {
    name: 'fenced-code',
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
