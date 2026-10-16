import { Decoration } from '@codemirror/view';
import type { InkFabPlugin, NodeRenderer } from './types';
import { headingIdAt } from './lib/headings';
import { lineClasses } from './lib/lines';

// Heading typography + GitHub-style anchor ids (`## What you can write` →
// id="what-you-can-write"), which the toc plugin and in-document links target.

const headingLine = (level: number, lineFrom: number, id: string | null) =>
  Decoration.line({
    class: `cm-h cm-h${level}`,
    ...(id ? { attributes: { id } } : {}),
  }).range(lineFrom);

const atx = (level: number): NodeRenderer => ({
  node: `ATXHeading${level}`,
  render: (node, ctx) => {
    const line = ctx.state.doc.lineAt(node.from);
    return [headingLine(level, line.from, headingIdAt(ctx.state, line.from))];
  },
});

const setext = (level: 1 | 2): NodeRenderer => ({
  node: `SetextHeading${level}`,
  render: (node, ctx) => {
    const firstLine = ctx.state.doc.lineAt(node.from);
    const decos = [headingLine(level, firstLine.from, headingIdAt(ctx.state, firstLine.from))];
    if (firstLine.to < node.to) {
      // The underline (`===`/`---`) gets the same look as the heading text.
      decos.push(...lineClasses(ctx.state, firstLine.to + 1, node.to, `cm-h cm-h${level}`));
    }
    return decos;
  },
});

export function headings(): InkFabPlugin {
  return {
    name: 'headings',
    nodes: [atx(1), atx(2), atx(3), atx(4), atx(5), atx(6), setext(1), setext(2)],
    // Vertical rhythm must be padding, not margin — CodeMirror's height map
    // measures lines without margins, which breaks click/arrow positioning.
    styles: `
.cm-editor .cm-h {
  font-family: var(--font-serif);
  font-weight: 700;
  letter-spacing: -0.015em;
  color: var(--fg);
  padding-top: 1.8em;
  padding-bottom: 0.5em;
  line-height: 1.2;
}
.cm-editor .cm-h1 { font-size: 2em; }
.cm-editor .cm-h2 { font-size: 1.55em; }
.cm-editor .cm-h3 { font-size: 1.25em; }
.cm-editor .cm-h4 { font-size: 1.1em; font-style: italic; color: var(--fg); }
.cm-editor .cm-h5,
.cm-editor .cm-h6 {
  font-size: 1em;
  color: var(--fg-muted);
  text-transform: uppercase;
  letter-spacing: 0.08em;
}
`,
  };
}
