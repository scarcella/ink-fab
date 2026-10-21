import { Decoration, WidgetType } from '@codemirror/view';
import type { SyntaxNode } from '@lezer/common';
import type { InkFabPlugin } from './types';
import { lineClasses } from './lib/lines';

// Bullet markers (-, *, +) render as real bullets, cycling glyph with nesting
// depth like a typeset document. The raw mark reappears only when the caret
// touches the marker itself, so typing elsewhere in an item never flickers
// the bullet away. Ordered-list numbers stay as typed. Task items drop the
// dash entirely — the drawn checkbox (tasks plugin) is the whole marker,
// matching how GitHub renders them.

const GLYPHS = ['•', '◦', '▪'];

class BulletWidget extends WidgetType {
  constructor(readonly depth: number) {
    super();
  }
  eq(other: BulletWidget) {
    return other.depth === this.depth;
  }
  toDOM() {
    const el = document.createElement('span');
    el.className = 'cm-list-bullet';
    el.textContent = GLYPHS[this.depth % GLYPHS.length];
    el.setAttribute('aria-hidden', 'true');
    return el;
  }
}

function bulletDepth(node: SyntaxNode) {
  let depth = -1;
  for (let cur: SyntaxNode | null = node; cur; cur = cur.parent) {
    if (cur.name === 'BulletList') depth++;
  }
  return Math.max(depth, 0);
}

// Lines get one class per enclosing ListItem (cm-li-1 … cm-li-6); the rules
// are declared in ascending order so the deepest one's padding wins. Padding
// is on the line, so wrapped continuation lines indent with their item.
const MAX_ITEM_DEPTH = 6;
const INDENT_PER_LEVEL = 1.3; // em

function itemDepth(node: SyntaxNode) {
  let depth = 0;
  for (let cur: SyntaxNode | null = node; cur; cur = cur.parent) {
    if (cur.name === 'ListItem') depth++;
  }
  return Math.min(depth, MAX_ITEM_DEPTH);
}

const indentStyles = Array.from(
  { length: MAX_ITEM_DEPTH },
  (_, i) =>
    `.cm-editor .cm-line.cm-li-${i + 1} { padding-left: ${((i + 1) * INDENT_PER_LEVEL).toFixed(1)}em; }`
).join('\n');

export function lists(): InkFabPlugin {
  return {
    name: 'lists',
    nodes: [
      {
        node: 'ListItem',
        render: (node, ctx) =>
          lineClasses(ctx.state, node.from, node.to, `cm-li-${itemDepth(node)}`),
      },
      {
        node: 'ListMark',
        render: (node, ctx) => {
          if (node.parent?.parent?.name !== 'BulletList') return null;

          // Task item: hide the dash (and its trailing space) when the caret
          // is off the line — same reveal rule the checkbox itself uses.
          if (node.nextSibling?.name === 'Task') {
            const line = ctx.state.doc.lineAt(node.from);
            if (ctx.touches(line.from, line.to)) return null;
            const trailingSpace =
              ctx.state.doc.sliceString(node.to, node.to + 1) === ' ' ? 1 : 0;
            return [Decoration.replace({}).range(node.from, node.to + trailingSpace)];
          }

          if (ctx.touches(node.from, node.to)) return null;
          return [
            Decoration.replace({
              widget: new BulletWidget(bulletDepth(node)),
            }).range(node.from, node.to),
          ];
        },
      },
    ],
    styles: `
.cm-list-bullet {
  color: var(--fg);
}
${indentStyles}
`,
  };
}
