import { Decoration, WidgetType } from '@codemirror/view';
import type { EditorState } from '@codemirror/state';
import type { InkFabPlugin } from './types';
import { getNodeUrl } from './links';
import { resolveImageSource } from './lib/resolve';

// `![alt](src)` renders as a figure with the alt text as caption. Relative
// paths resolve against the current file.

class ImageWidget extends WidgetType {
  constructor(readonly src: string, readonly alt: string) {
    super();
  }
  eq(other: ImageWidget) {
    return other.src === this.src && other.alt === this.alt;
  }
  toDOM() {
    const figure = document.createElement('figure');
    figure.className = 'cm-image-block';

    const img = document.createElement('img');
    img.src = this.src;
    img.alt = this.alt;
    img.loading = 'lazy';
    img.draggable = false;
    figure.append(img);

    if (this.alt) {
      const caption = document.createElement('figcaption');
      caption.textContent = this.alt;
      figure.append(caption);
    }

    return figure;
  }
  ignoreEvent() {
    return false;
  }
}

function getImageAlt(state: EditorState, from: number, to: number) {
  const raw = state.doc.sliceString(from, to);
  const match = raw.match(/^!\[([^\]]*)\]\(.+\)$/s);
  return match ? match[1] : '';
}

export function images(): InkFabPlugin {
  return {
    name: 'images',
    nodes: [
      {
        node: 'Image',
        render: (node, ctx) => {
          if (ctx.touches(node.from, node.to)) return null;
          const target = getNodeUrl(ctx.state, node);
          if (!target) return null;
          const src = resolveImageSource(target, ctx.filePath);
          if (!src) return null;
          return [
            Decoration.replace({
              widget: new ImageWidget(src, getImageAlt(ctx.state, node.from, node.to)),
              block: true,
            }).range(node.from, node.to),
          ];
        },
      },
    ],
    // Spacing is padding, not margin — see the height-map note in headings.ts.
    styles: `
.cm-image-block {
  margin: 0;
  padding: 1.4em 0;
  text-align: center;
}
.cm-image-block img {
  display: block;
  max-width: min(100%, 820px);
  max-height: 60vh;
  margin: 0 auto;
  border-radius: 10px;
  box-shadow: 0 10px 30px rgba(28, 25, 23, 0.08);
}
.cm-image-block figcaption {
  margin-top: 0.65em;
  font-family: var(--font-sans);
  font-size: 12px;
  color: var(--fg-muted);
  letter-spacing: 0.02em;
}
`,
  };
}
