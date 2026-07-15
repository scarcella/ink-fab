import { syntaxTree } from '@codemirror/language';
import type { EditorState } from '@codemirror/state';

export type Heading = {
  level: number;
  text: string;
  id: string;
  /** Start of the heading's first line — stable key for per-node lookup. */
  lineFrom: number;
};

// GitHub-style slug: lowercase, spaces → '-', strip most punctuation.
export function slugify(text: string): string {
  return (
    text
      .trim()
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s-]/gu, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '') || 'section'
  );
}

export function headingTextFromLine(line: string): string {
  // Strip leading # marks and surrounding spaces, plus any trailing #'s (closed ATX form).
  return line
    .replace(/^\s{0,3}#{1,6}\s*/, '')
    .replace(/\s+#+\s*$/, '')
    .trim();
}

// Heading collection is shared by the headings plugin (anchor ids) and the toc
// plugin (link list), and slug de-duplication is document-wide, so it can't be
// computed per node. EditorState is immutable, so memoize per state: whichever
// plugin asks first pays the tree walk, everyone else gets the cached list.
const cache = new WeakMap<EditorState, Heading[]>();

export function collectHeadings(state: EditorState): Heading[] {
  const hit = cache.get(state);
  if (hit) return hit;

  const headings: Heading[] = [];
  const slugCounts = new Map<string, number>();
  const dedupeSlug = (base: string) => {
    const n = slugCounts.get(base) ?? 0;
    slugCounts.set(base, n + 1);
    return n === 0 ? base : `${base}-${n}`;
  };
  const add = (level: number, lineFrom: number, rawLineText: string) => {
    const text = headingTextFromLine(rawLineText);
    headings.push({ level, text, id: dedupeSlug(slugify(text)), lineFrom });
  };

  syntaxTree(state).iterate({
    enter: (node) => {
      const atx = /^ATXHeading(\d)$/.exec(node.name);
      if (atx) {
        const line = state.doc.lineAt(node.from);
        add(Number(atx[1]), line.from, line.text);
        return;
      }
      if (node.name === 'SetextHeading1' || node.name === 'SetextHeading2') {
        const line = state.doc.lineAt(node.from);
        add(node.name === 'SetextHeading1' ? 1 : 2, line.from, line.text);
      }
    },
  });

  cache.set(state, headings);
  return headings;
}

const idIndex = new WeakMap<EditorState, Map<number, string>>();

/** Anchor id for the heading starting at lineFrom, or null. */
export function headingIdAt(state: EditorState, lineFrom: number): string | null {
  let idx = idIndex.get(state);
  if (!idx) {
    idx = new Map(collectHeadings(state).map((h) => [h.lineFrom, h.id]));
    idIndex.set(state, idx);
  }
  return idx.get(lineFrom) ?? null;
}
