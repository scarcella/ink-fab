import { Decoration, WidgetType } from '@codemirror/view';
import MarkdownIt from 'markdown-it';
import taskLists from 'markdown-it-task-lists';
import footnote from 'markdown-it-footnote';
import type { InkFabPlugin } from './types';
import { resolveImageSource, resolveLinkTarget } from './lib/resolve';

// GFM tables render as real <table>s when the caret is outside the block.
// Cell contents go through markdown-it's inline renderer, so bold/code/links
// inside cells work.

const md = new MarkdownIt({
  html: false,
  linkify: true,
})
  .use(taskLists, { enabled: true })
  .use(footnote);

type ColumnAlign = 'left' | 'center' | 'right' | null;

// Splits a GFM table row into cells. Treats `|` as a separator only outside
// code spans; honours `\|` as a literal pipe.
export function splitTableRow(line: string): string[] {
  let src = line.trim();
  if (src.startsWith('|')) src = src.slice(1);
  if (src.endsWith('|')) {
    // Not an escaped pipe.
    let trailingBackslashes = 0;
    for (let j = src.length - 2; j >= 0 && src[j] === '\\'; j--) trailingBackslashes++;
    if (trailingBackslashes % 2 === 0) src = src.slice(0, -1);
  }

  const cells: string[] = [];
  let current = '';
  let codeFence = 0; // length of the active backtick run, 0 when outside a code span

  for (let i = 0; i < src.length; i++) {
    const c = src[i];

    if (codeFence === 0 && c === '\\' && src[i + 1] === '|') {
      current += '|';
      i++;
      continue;
    }

    if (c === '`') {
      let run = 1;
      while (src[i + run] === '`') run++;
      if (codeFence === 0) codeFence = run;
      else if (codeFence === run) codeFence = 0;
      current += '`'.repeat(run);
      i += run - 1;
      continue;
    }

    if (c === '|' && codeFence === 0) {
      cells.push(current.trim());
      current = '';
      continue;
    }

    current += c;
  }
  cells.push(current.trim());
  return cells;
}

function parseAlignments(delimiterLine: string): ColumnAlign[] {
  return splitTableRow(delimiterLine).map((cell) => {
    const t = cell.trim();
    const left = t.startsWith(':');
    const right = t.endsWith(':');
    if (left && right) return 'center';
    if (right) return 'right';
    if (left) return 'left';
    return null;
  });
}

function parseTable(
  source: string
): { header: string[]; aligns: ColumnAlign[]; rows: string[][] } | null {
  const lines = source
    .replace(/\r\n/g, '\n')
    .split('\n')
    .filter((l) => l.trim().length > 0);
  if (lines.length < 2) return null;
  const header = splitTableRow(lines[0]);
  const aligns = parseAlignments(lines[1]);
  const rows = lines.slice(2).map(splitTableRow);
  return { header, aligns, rows };
}

class TableWidget extends WidgetType {
  constructor(readonly source: string, readonly filePath: string | null) {
    super();
  }
  eq(other: TableWidget) {
    return other.source === this.source && other.filePath === this.filePath;
  }
  toDOM() {
    const wrapper = document.createElement('div');
    wrapper.className = 'cm-table-block';

    const parsed = parseTable(this.source);
    if (!parsed) {
      wrapper.textContent = this.source;
      return wrapper;
    }
    const { header, aligns, rows } = parsed;

    const table = document.createElement('table');
    const thead = document.createElement('thead');
    const headerRow = document.createElement('tr');
    header.forEach((cell, i) => {
      const th = document.createElement('th');
      th.innerHTML = md.renderInline(cell);
      const align = aligns[i];
      if (align) th.style.textAlign = align;
      headerRow.appendChild(th);
    });
    thead.appendChild(headerRow);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    rows.forEach((row) => {
      const tr = document.createElement('tr');
      for (let i = 0; i < header.length; i++) {
        const td = document.createElement('td');
        td.innerHTML = md.renderInline(row[i] ?? '');
        const align = aligns[i];
        if (align) td.style.textAlign = align;
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);

    // Rewrite links/images so the editor click handler can treat them like native links.
    table.querySelectorAll<HTMLAnchorElement>('a[href]').forEach((a) => {
      const href = a.getAttribute('href');
      if (!href) return;
      const resolved = resolveLinkTarget(href, this.filePath);
      if (!resolved) return;
      a.setAttribute('data-inkfab-href', resolved.href);
      if (resolved.localPath) a.setAttribute('data-inkfab-path', resolved.localPath);
      a.setAttribute('title', resolved.href);
    });

    table.querySelectorAll<HTMLImageElement>('img[src]').forEach((img) => {
      const src = img.getAttribute('src');
      if (!src) return;
      const resolved = resolveImageSource(src, this.filePath);
      if (!resolved) return;
      img.setAttribute('src', resolved);
      img.setAttribute('loading', 'lazy');
      img.setAttribute('draggable', 'false');
    });

    wrapper.appendChild(table);
    return wrapper;
  }
  ignoreEvent() {
    return false;
  }
}

export function tables(): InkFabPlugin {
  return {
    name: 'tables',
    nodes: [
      {
        node: 'Table',
        render: (node, ctx) => {
          if (ctx.touches(node.from, node.to)) return null;
          const raw = ctx.state.doc.sliceString(node.from, node.to);
          if (!raw.trim()) return null;
          return [
            Decoration.replace({
              widget: new TableWidget(raw, ctx.filePath),
              block: true,
            }).range(node.from, node.to),
          ];
        },
      },
    ],
    // Spacing is padding, not margin — see the height-map note in headings.ts.
    styles: `
.cm-table-block {
  overflow-x: auto;
  padding: 1.4em 0;
}
.cm-table-block table {
  width: max-content;
  max-width: 100%;
  border-collapse: collapse;
  font-family: var(--font-sans);
  font-size: 13px;
  line-height: 1.45;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 10px;
  overflow: hidden;
  table-layout: auto;
}
.cm-table-block th,
.cm-table-block td {
  padding: 10px 12px;
  border-bottom: 1px solid var(--border-soft);
  border-right: 1px solid var(--border-soft);
  vertical-align: top;
  word-break: normal;
  overflow-wrap: break-word;
  hyphens: none;
  min-width: 7ch;
}
.cm-table-block thead th {
  white-space: nowrap;
  background: var(--bg-sunken);
  font-weight: 600;
  color: var(--fg);
}
.cm-table-block th:last-child,
.cm-table-block td:last-child {
  border-right: none;
}
.cm-table-block tr:last-child td {
  border-bottom: none;
}
.cm-table-block tbody tr:nth-child(even) td {
  background: color-mix(in srgb, var(--bg-sunken) 35%, transparent);
}
.cm-table-block a {
  color: var(--accent);
  text-decoration: underline;
  text-decoration-color: color-mix(in srgb, var(--accent) 25%, transparent);
  text-underline-offset: 0.14em;
}
.cm-table-block a:hover {
  text-decoration-color: color-mix(in srgb, var(--accent) 55%, transparent);
}
`,
  };
}
