import type { Range } from '@codemirror/state';
import { Decoration } from '@codemirror/view';
import type { SyntaxNode } from '@lezer/common';
import type { InkFabPlugin, NodeRenderer, PluginContext } from './types';

// Typora-style mark hiding: syntax marks (#, *, `, >, []()) disappear unless
// the caret is inside the construct they belong to.

const hide = (from: number, to: number): Range<Decoration>[] => [
  Decoration.replace({}).range(from, to),
];

function hideUnlessParentTouched(
  node: SyntaxNode,
  ctx: PluginContext
): Range<Decoration>[] | null {
  const parent = node.parent;
  if (parent && !ctx.touches(parent.from, parent.to)) {
    return hide(node.from, node.to);
  }
  return null;
}

const simpleMarks: NodeRenderer[] = ['EmphasisMark', 'CodeMark', 'StrikethroughMark'].map(
  (name) => ({ node: name, render: hideUnlessParentTouched })
);

export function markHiding(): InkFabPlugin {
  return {
    name: 'mark-hiding',
    nodes: [
      ...simpleMarks,
      {
        // `# ` (including the following spaces) disappears when the caret
        // is outside the heading.
        node: 'HeaderMark',
        render: (node, ctx) => {
          const parent = node.parent;
          if (!parent || ctx.touches(parent.from, parent.to)) return null;
          const doc = ctx.state.doc;
          let end = node.to;
          while (end < doc.length && doc.sliceString(end, end + 1) === ' ') end++;
          return hide(node.from, end);
        },
      },
      {
        node: 'LinkMark',
        render: (node, ctx) => {
          const parent = node.parent;
          if (
            parent &&
            (parent.name === 'Link' || parent.name === 'Image') &&
            !ctx.touches(parent.from, parent.to)
          ) {
            return hide(node.from, node.to);
          }
          return null;
        },
      },
      {
        // The (url) part of a link — the link text alone stays visible.
        node: 'URL',
        render: (node, ctx) => {
          const parent = node.parent;
          if (parent && parent.name === 'Link' && !ctx.touches(parent.from, parent.to)) {
            return hide(node.from, node.to);
          }
          return null;
        },
      },
      {
        node: 'QuoteMark',
        render: (node, ctx) => {
          const parent = node.parent;
          if (!parent || ctx.touches(parent.from, parent.to)) return null;
          const doc = ctx.state.doc;
          let end = node.to;
          if (doc.sliceString(end, end + 1) === ' ') end++;
          return hide(node.from, end);
        },
      },
    ],
  };
}
