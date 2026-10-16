import { Decoration, WidgetType } from '@codemirror/view';
import katex from 'katex';
import type { InkFabPlugin } from './types';

// `$…$` renders inline and `$$…$$` as display math via KaTeX. lang-markdown
// doesn't parse math, so these are text scans (the runtime already skips
// matches inside code and under the caret).

class KaTeXWidget extends WidgetType {
  constructor(readonly source: string, readonly block: boolean) {
    super();
  }
  eq(other: KaTeXWidget) {
    return other.source === this.source && other.block === this.block;
  }
  toDOM() {
    const el = document.createElement(this.block ? 'div' : 'span');
    el.className = this.block ? 'cm-math-block' : 'cm-math-inline';
    try {
      katex.render(this.source, el, {
        throwOnError: false,
        displayMode: this.block,
        output: 'html',
      });
    } catch {
      el.textContent = this.source;
    }
    return el;
  }
  ignoreEvent() {
    return false;
  }
}

export function math(): InkFabPlugin {
  return {
    name: 'math',
    scans: [
      {
        pattern: /\$\$([\s\S]+?)\$\$/g,
        render: (m) => {
          const content = m[1].trim();
          if (!content) return null;
          return [
            Decoration.replace({
              widget: new KaTeXWidget(content, true),
              block: true,
            }).range(m.index, m.index + m[0].length),
          ];
        },
      },
      {
        pattern: /(?<!\$)\$([^$\n]+?)\$(?!\$)/g,
        render: (m) => {
          const content = m[1];
          if (!content.trim()) return null;
          return [
            Decoration.replace({
              widget: new KaTeXWidget(content, false),
            }).range(m.index, m.index + m[0].length),
          ];
        },
      },
    ],
    // Spacing is padding, not margin — see the height-map note in headings.ts.
    styles: `
.cm-math-inline {
  display: inline-block;
  padding: 0 2px;
  color: var(--fg);
}
.cm-math-block {
  display: block;
  text-align: center;
  padding: 1.7em 0;
  font-size: 1.05em;
}
/* KaTeX overrides: keep it refined, not shouty */
.katex { font-size: 1.02em; }
.katex-display { margin: 0; }
`,
  };
}
