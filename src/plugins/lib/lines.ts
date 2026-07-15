import type { EditorState, Range } from '@codemirror/state';
import { Decoration } from '@codemirror/view';

/** One line decoration per document line covered by [from, to]. */
export function lineClasses(
  state: EditorState,
  from: number,
  to: number,
  cls: string
): Range<Decoration>[] {
  const decos: Range<Decoration>[] = [];
  let pos = from;
  while (pos <= to && pos <= state.doc.length) {
    const line = state.doc.lineAt(pos);
    decos.push(Decoration.line({ class: cls }).range(line.from));
    if (line.to >= to) break;
    pos = line.to + 1;
  }
  return decos;
}
