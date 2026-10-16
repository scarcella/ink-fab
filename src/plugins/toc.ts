import { Decoration, EditorView, WidgetType } from '@codemirror/view';
import type { InkFabPlugin } from './types';
import { blockShell } from './lib/block-shell';
import { collectHeadings, type Heading } from './lib/headings';

// A line containing only `[[toc]]` (or `${toc}`) renders as a table of
// contents built from the document's headings. Clicking an entry scrolls to
// the heading (anchor ids come from the headings plugin).

type TocEntry = Pick<Heading, 'level' | 'text' | 'id'>;

class TocWidget extends WidgetType {
  constructor(readonly headings: TocEntry[]) {
    super();
  }
  eq(other: TocWidget) {
    if (other.headings.length !== this.headings.length) return false;
    return other.headings.every(
      (h, i) =>
        h.id === this.headings[i].id &&
        h.text === this.headings[i].text &&
        h.level === this.headings[i].level
    );
  }
  toDOM() {
    const wrapper = document.createElement('nav');
    wrapper.className = 'cm-toc-block';
    const heading = document.createElement('div');
    heading.className = 'cm-toc-title';
    heading.textContent = 'Contents';
    wrapper.appendChild(heading);

    const minLevel = this.headings.reduce((m, h) => Math.min(m, h.level), 6);
    const list = document.createElement('ul');
    this.headings.forEach((h) => {
      const li = document.createElement('li');
      li.style.marginLeft = `${(h.level - minLevel) * 14}px`;
      const a = document.createElement('a');
      a.textContent = h.text || '(untitled)';
      a.href = `#${h.id}`;
      a.setAttribute('data-inkfab-toc', h.id);
      li.appendChild(a);
      list.appendChild(li);
    });
    wrapper.appendChild(list);
    return blockShell(wrapper);
  }
  ignoreEvent() {
    return false;
  }
}

const tocClickHandler = EditorView.domEventHandlers({
  click: (event, view) => {
    if (!(event.target instanceof HTMLElement)) return false;
    const target = event.target.closest<HTMLElement>('[data-inkfab-toc]');
    if (!target) return false;
    const id = target.dataset.inkfabToc;
    if (!id) return false;
    event.preventDefault();
    const heading = view.dom.querySelector<HTMLElement>(`#${CSS.escape(id)}`);
    heading?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    return true;
  },
});

export function toc(): InkFabPlugin {
  return {
    name: 'toc',
    extensions: [tocClickHandler],
    scans: [
      {
        pattern: /^[ \t]*(?:\[\[toc\]\]|\$\{toc\})[ \t]*$/gim,
        render: (m, ctx) => {
          const headings = collectHeadings(ctx.state).map(({ level, text, id }) => ({
            level,
            text,
            id,
          }));
          if (headings.length === 0) return null;
          return [
            Decoration.replace({
              widget: new TocWidget(headings),
              block: true,
            }).range(m.index, m.index + m[0].length),
          ];
        },
      },
    ],
    styles: `
.cm-toc-block {
  margin: 0;
  padding: 14px 18px 16px;
  background: var(--bg-sunken);
  border: 1px solid var(--border-soft);
  border-radius: 10px;
  font-family: var(--font-sans);
  font-size: 13px;
  line-height: 1.6;
}
.cm-toc-title {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--fg-muted);
  margin-bottom: 6px;
  font-weight: 600;
}
.cm-toc-block ul {
  list-style: none;
  padding: 0;
  margin: 0;
}
.cm-toc-block li {
  padding: 2px 0;
}
.cm-toc-block a {
  color: var(--fg);
  text-decoration: none;
  cursor: pointer;
}
.cm-toc-block a:hover {
  color: var(--accent);
  text-decoration: underline;
  text-underline-offset: 0.15em;
}
`,
  };
}
