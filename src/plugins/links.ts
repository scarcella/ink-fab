import { Decoration } from '@codemirror/view';
import type { EditorState } from '@codemirror/state';
import type { SyntaxNode } from '@lezer/common';
import type { InkFabPlugin } from './types';
import { resolveLinkTarget } from './lib/resolve';

// Markdown links become clickable when the caret is outside them. The editor
// shell owns the actual click dispatch (it needs the app's open-file callback);
// this plugin only tags the range with the resolved target.

export function getNodeUrl(state: EditorState, node: SyntaxNode): string | null {
  const cursor = node.cursor();
  if (!cursor.firstChild()) return null;
  do {
    if (cursor.name === 'URL') {
      return state.doc.sliceString(cursor.from, cursor.to);
    }
  } while (cursor.nextSibling());
  return null;
}

export function links(): InkFabPlugin {
  return {
    name: 'links',
    nodes: [
      {
        node: 'Link',
        render: (node, ctx) => {
          if (ctx.touches(node.from, node.to)) return null;
          const target = getNodeUrl(ctx.state, node);
          if (!target) return null;
          const resolved = resolveLinkTarget(target, ctx.filePath);
          if (!resolved) return null;
          return [
            Decoration.mark({
              class: 'cm-live-link',
              attributes: {
                'data-inkfab-href': resolved.href,
                ...(resolved.localPath ? { 'data-inkfab-path': resolved.localPath } : {}),
                title: resolved.href,
              },
            }).range(node.from, node.to),
          ];
        },
      },
    ],
    styles: `
.cm-editor .cm-live-link {
  color: var(--accent);
  cursor: pointer;
  text-decoration: underline;
  text-decoration-color: rgba(12, 74, 110, 0.25);
  text-underline-offset: 0.14em;
}
.cm-editor .cm-live-link:hover {
  text-decoration-color: rgba(12, 74, 110, 0.55);
}
`,
  };
}
