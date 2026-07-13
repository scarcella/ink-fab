import { syntaxTree } from '@codemirror/language';
import { EditorState, Range, StateEffect, StateField } from '@codemirror/state';
import { Decoration, DecorationSet, EditorView, WidgetType } from '@codemirror/view';
import katex from 'katex';
import MarkdownIt from 'markdown-it';
import taskLists from 'markdown-it-task-lists';
import footnote from 'markdown-it-footnote';
import mermaid from 'mermaid';
import hljs from 'highlight.js';

mermaid.initialize({
  startOnLoad: false,
  securityLevel: 'strict',
  theme: 'neutral',
  fontFamily: 'var(--font-sans)',
});
let mermaidIdCounter = 0;

const focusEffect = StateEffect.define<boolean>();

const focusField = StateField.define<boolean>({
  create: () => false,
  update(value, tr) {
    for (const e of tr.effects) if (e.is(focusEffect)) return e.value;
    return value;
  },
});

const focusTracker = EditorView.focusChangeEffect.of((_state, focusing) =>
  focusEffect.of(focusing)
);

type ResolvedTarget = {
  href: string;
  localPath?: string;
};

// Block widgets must not carry vertical margins — CodeMirror measures widget
// height without them, which corrupts click/arrow-key position mapping. The
// shell provides the spacing as padding; the inner card keeps border/background.
function blockShell(child: HTMLElement): HTMLElement {
  const shell = document.createElement('div');
  shell.className = 'cm-block-shell';
  shell.appendChild(child);
  return shell;
}

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

// GitHub-style slug: lowercase, spaces → '-', strip most punctuation.
function slugify(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || 'section';
}

function headingTextFromLine(line: string): string {
  // Strip leading # marks and surrounding spaces, plus any trailing #'s (closed ATX form).
  return line
    .replace(/^\s{0,3}#{1,6}\s*/, '')
    .replace(/\s+#+\s*$/, '')
    .trim();
}

class TocWidget extends WidgetType {
  constructor(readonly headings: Array<{ level: number; text: string; id: string }>) {
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

    const minLevel = this.headings.reduce(
      (m, h) => Math.min(m, h.level),
      6
    );
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

class HighlightedCodeWidget extends WidgetType {
  constructor(readonly source: string, readonly lang: string) {
    super();
  }
  eq(other: HighlightedCodeWidget) {
    return other.source === this.source && other.lang === this.lang;
  }
  toDOM() {
    const wrapper = document.createElement('div');
    wrapper.className = 'cm-code-block';
    const label = document.createElement('div');
    label.className = 'cm-code-lang';
    label.textContent = this.lang;
    wrapper.appendChild(label);

    const pre = document.createElement('pre');
    const code = document.createElement('code');
    code.className = `hljs language-${this.lang}`;
    try {
      const { value } = hljs.getLanguage(this.lang)
        ? hljs.highlight(this.source, { language: this.lang, ignoreIllegals: true })
        : hljs.highlightAuto(this.source);
      code.innerHTML = value;
    } catch {
      code.textContent = this.source;
    }
    pre.appendChild(code);
    wrapper.appendChild(pre);
    return blockShell(wrapper);
  }
  ignoreEvent() {
    return false;
  }
}

class MermaidWidget extends WidgetType {
  constructor(readonly source: string) {
    super();
  }
  eq(other: MermaidWidget) {
    return other.source === this.source;
  }
  toDOM() {
    const wrapper = document.createElement('div');
    wrapper.className = 'cm-mermaid-block';
    wrapper.textContent = this.source; // placeholder while rendering
    const id = `cm-mermaid-${++mermaidIdCounter}`;
    mermaid
      .render(id, this.source)
      .then(({ svg, bindFunctions }) => {
        wrapper.innerHTML = svg;
        bindFunctions?.(wrapper);
      })
      .catch((err) => {
        wrapper.textContent = '';
        const pre = document.createElement('pre');
        pre.className = 'cm-mermaid-error';
        pre.textContent = `Mermaid error: ${err?.message ?? err}\n\n${this.source}`;
        wrapper.appendChild(pre);
      });
    return blockShell(wrapper);
  }
  ignoreEvent() {
    return false;
  }
}

class TaskCheckboxWidget extends WidgetType {
  constructor(readonly checked: boolean) {
    super();
  }
  eq(other: TaskCheckboxWidget) {
    return other.checked === this.checked;
  }
  toDOM() {
    const el = document.createElement('span');
    el.className = 'cm-task-box' + (this.checked ? ' checked' : '');
    el.setAttribute('aria-hidden', 'true');
    return el;
  }
}

const md = new MarkdownIt({
  html: false,
  linkify: true,
}).use(taskLists, { enabled: true }).use(footnote);

type ColumnAlign = 'left' | 'center' | 'right' | null;

// Splits a GFM table row into cells. Treats `|` as a separator only outside
// code spans; honours `\|` as a literal pipe.
function splitTableRow(line: string): string[] {
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

function parseTable(source: string): { header: string[]; aligns: ColumnAlign[]; rows: string[][] } | null {
  const lines = source.replace(/\r\n/g, '\n').split('\n').filter((l) => l.trim().length > 0);
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

function getNodeUrl(state: EditorState, node: { cursor: () => any }) {
  const cursor = node.cursor();
  if (!cursor.firstChild()) return null;

  do {
    if (cursor.name === 'URL') {
      return state.doc.sliceString(cursor.from, cursor.to);
    }
  } while (cursor.nextSibling());

  return null;
}

function getImageAlt(state: EditorState, from: number, to: number) {
  const raw = state.doc.sliceString(from, to);
  const match = raw.match(/^!\[([^\]]*)\]\(.+\)$/s);
  return match ? match[1] : '';
}

function resolveLinkTarget(target: string, filePath: string | null): ResolvedTarget | null {
  if (/^(https?:|mailto:)/i.test(target) || target.startsWith('//')) {
    return { href: target };
  }

  if (/^file:\/\//i.test(target)) {
    return { href: target };
  }

  if (!filePath) return null;
  const resolved = window.inkfab.resolveFileTarget(filePath, target);
  if (!resolved) return null;

  return {
    href: resolved.fileUrl,
    localPath: resolved.filePath,
  };
}

function resolveImageSource(target: string, filePath: string | null) {
  if (/^file:\/\//i.test(target)) return target;
  if (!filePath) return null;
  return window.inkfab.resolveFileTarget(filePath, target)?.fileUrl ?? null;
}

function build(state: EditorState, filePath: string | null): DecorationSet {
  const sel = state.selection.main;
  const focused = state.field(focusField, false);
  const decos: Range<Decoration>[] = [];
  const codeRanges: Array<[number, number]> = [];
  const touches = (from: number, to: number) =>
    focused && sel.from <= to && sel.to >= from;
  const inCode = (pos: number) => codeRanges.some(([f, t]) => pos >= f && pos < t);

  const tree = syntaxTree(state);
  const docLen = state.doc.length;

  // Collect headings for both anchor-id assignment and TOC rendering.
  const headings: Array<{ level: number; text: string; id: string; lineFrom: number }> = [];
  const slugCounts = new Map<string, number>();
  const dedupeSlug = (base: string) => {
    const n = slugCounts.get(base) ?? 0;
    slugCounts.set(base, n + 1);
    return n === 0 ? base : `${base}-${n}`;
  };
  const addHeading = (level: number, lineFrom: number, rawLineText: string) => {
    const text = headingTextFromLine(rawLineText);
    const id = dedupeSlug(slugify(text));
    headings.push({ level, text, id, lineFrom });
    return id;
  };

  const pushLineClass = (from: number, to: number, cls: string) => {
    let pos = from;
    while (pos <= to && pos <= docLen) {
      const line = state.doc.lineAt(pos);
      decos.push(Decoration.line({ class: cls }).range(line.from));
      if (line.to >= to) break;
      pos = line.to + 1;
    }
  };

  tree.iterate({
    from: 0,
    to: docLen,
    enter: (node) => {
      const { name, from, to } = node;

      if (name === 'InlineCode' || name === 'FencedCode' || name === 'CodeBlock') {
        codeRanges.push([from, to]);
      }

      const atx = /^ATXHeading(\d)$/.exec(name);
      if (atx) {
        const level = Number(atx[1]);
        const line = state.doc.lineAt(from);
        const id = addHeading(level, line.from, state.doc.sliceString(line.from, line.to));
        decos.push(
          Decoration.line({
            class: `cm-h cm-h${level}`,
            attributes: { id },
          }).range(line.from)
        );
      }

      if (name === 'SetextHeading1' || name === 'SetextHeading2') {
        const level = name === 'SetextHeading1' ? 1 : 2;
        const firstLine = state.doc.lineAt(from);
        const id = addHeading(
          level,
          firstLine.from,
          state.doc.sliceString(firstLine.from, firstLine.to)
        );
        decos.push(
          Decoration.line({
            class: `cm-h cm-h${level}`,
            attributes: { id },
          }).range(firstLine.from)
        );
        if (firstLine.to < to) {
          pushLineClass(firstLine.to + 1, to, `cm-h cm-h${level}`);
        }
      }

      if (name === 'Blockquote') {
        pushLineClass(from, to, 'cm-quote');
      }

      if (name === 'FencedCode' || name === 'CodeBlock') {
        pushLineClass(from, to, 'cm-code-line');
      }

      if (name === 'FencedCode' && !touches(from, to)) {
        const raw = state.doc.sliceString(from, to);
        const match = raw.match(/^```\s*([A-Za-z0-9_+-]*)\s*\n([\s\S]*?)\n?```\s*$/);
        if (match) {
          const lang = match[1].toLowerCase();
          const body = match[2];
          if (lang === 'mermaid' && body.trim()) {
            decos.push(
              Decoration.replace({
                widget: new MermaidWidget(body.trim()),
                block: true,
              }).range(from, to)
            );
          } else if (lang && hljs.getLanguage(lang) && body.length > 0) {
            decos.push(
              Decoration.replace({
                widget: new HighlightedCodeWidget(body, lang),
                block: true,
              }).range(from, to)
            );
          }
        }
      }

      if (name === 'HorizontalRule') {
        const line = state.doc.lineAt(from);
        decos.push(Decoration.line({ class: 'cm-hr-line' }).range(line.from));
        if (!touches(line.from, line.to)) {
          decos.push(Decoration.replace({}).range(from, to));
        }
      }

      if (name === 'HeaderMark') {
        const parent = node.node.parent;
        if (parent && !touches(parent.from, parent.to)) {
          let end = to;
          while (end < docLen && state.doc.sliceString(end, end + 1) === ' ') {
            end++;
          }
          decos.push(Decoration.replace({}).range(from, end));
        }
      }

      if (name === 'EmphasisMark' || name === 'CodeMark' || name === 'StrikethroughMark') {
        const parent = node.node.parent;
        if (parent && !touches(parent.from, parent.to)) {
          decos.push(Decoration.replace({}).range(from, to));
        }
      }

      if (name === 'LinkMark') {
        const parent = node.node.parent;
        if (
          parent &&
          (parent.name === 'Link' || parent.name === 'Image') &&
          !touches(parent.from, parent.to)
        ) {
          decos.push(Decoration.replace({}).range(from, to));
        }
      }

      if (name === 'URL') {
        const parent = node.node.parent;
        if (parent && parent.name === 'Link' && !touches(parent.from, parent.to)) {
          decos.push(Decoration.replace({}).range(from, to));
        }
      }

      if (name === 'QuoteMark') {
        const parent = node.node.parent;
        if (parent && !touches(parent.from, parent.to)) {
          let end = to;
          if (state.doc.sliceString(end, end + 1) === ' ') end++;
          decos.push(Decoration.replace({}).range(from, end));
        }
      }

      if (name === 'TaskMarker') {
        const line = state.doc.lineAt(from);
        const text = state.doc.sliceString(from, to);
        const checked = /x/i.test(text);
        if (!touches(line.from, line.to)) {
          decos.push(
            Decoration.replace({
              widget: new TaskCheckboxWidget(checked),
            }).range(from, to)
          );
        }
      }

      if (name === 'Table' && !touches(from, to)) {
        // Replace the full table block with a rendered table.
        const raw = state.doc.sliceString(from, to);
        if (raw.trim()) {
          decos.push(
            Decoration.replace({
              widget: new TableWidget(raw, filePath),
              block: true,
            }).range(from, to)
          );
        }
      }

      if (name === 'Link' && !touches(from, to)) {
        const target = getNodeUrl(state, node.node);
        if (!target) return;
        const resolvedTarget = resolveLinkTarget(target, filePath);
        if (!resolvedTarget) return;
        decos.push(
          Decoration.mark({
            class: 'cm-live-link',
            attributes: {
              'data-inkfab-href': resolvedTarget.href,
              ...(resolvedTarget.localPath
                ? { 'data-inkfab-path': resolvedTarget.localPath }
                : {}),
              title: resolvedTarget.href,
            },
          }).range(from, to)
        );
      }

      if (name === 'Image' && !touches(from, to)) {
        const target = getNodeUrl(state, node.node);
        if (!target) return;
        const src = resolveImageSource(target, filePath);
        if (!src) return;
        decos.push(
          Decoration.replace({
            widget: new ImageWidget(src, getImageAlt(state, from, to)),
            block: true,
          }).range(from, to)
        );
      }
    },
  });

  // Math pass — lang-markdown doesn't parse math, so we scan full text.
  const text = state.doc.toString();

  const blockRe = /\$\$([\s\S]+?)\$\$/g;
  let m: RegExpExecArray | null;
  while ((m = blockRe.exec(text)) !== null) {
    const from = m.index;
    const to = from + m[0].length;
    if (inCode(from)) continue;
    if (touches(from, to)) continue;
    const content = m[1].trim();
    if (!content) continue;
    decos.push(
      Decoration.replace({
        widget: new KaTeXWidget(content, true),
        block: true,
      }).range(from, to)
    );
  }

  const inlineRe = /(?<!\$)\$([^$\n]+?)\$(?!\$)/g;
  while ((m = inlineRe.exec(text)) !== null) {
    const from = m.index;
    const to = from + m[0].length;
    if (inCode(from)) continue;
    if (touches(from, to)) continue;
    const content = m[1];
    if (!content.trim()) continue;
    decos.push(
      Decoration.replace({ widget: new KaTeXWidget(content, false) }).range(from, to)
    );
  }

  // TOC pass — replace any line consisting of `[[toc]]` or `${toc}` with a TOC widget.
  const tocRe = /^[ \t]*(?:\[\[toc\]\]|\$\{toc\})[ \t]*$/gim;
  while ((m = tocRe.exec(text)) !== null) {
    const lineFrom = m.index;
    const lineTo = lineFrom + m[0].length;
    if (inCode(lineFrom)) continue;
    if (touches(lineFrom, lineTo)) continue;
    if (headings.length === 0) continue;
    decos.push(
      Decoration.replace({
        widget: new TocWidget(headings.map(({ level, text, id }) => ({ level, text, id }))),
        block: true,
      }).range(lineFrom, lineTo)
    );
  }

  return Decoration.set(decos, true);
}

export function createLiveMarkdown(filePath: string | null) {
  const liveMarkdownField = StateField.define<DecorationSet>({
    create: (state) => build(state, filePath),
    update: (value, tr) => {
      const focusChanged = tr.effects.some((e) => e.is(focusEffect));
      if (tr.docChanged || tr.selection || focusChanged) {
        return build(tr.state, filePath);
      }
      return value;
    },
    provide: (f) => EditorView.decorations.from(f),
  });

  return [focusField, focusTracker, liveMarkdownField];
}
