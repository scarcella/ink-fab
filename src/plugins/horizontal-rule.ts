import { Decoration, type EditorView } from '@codemirror/view';
import type { InkFabPlugin } from './types';

// `---` renders as a centred rule; the source text reappears when the caret
// is on the line.
// Puts a rule on its own line below the caret. A blank line goes above it
// when the line before has text, or `---` would turn that text into a heading.
function insertDivider(view: EditorView) {
  const { state } = view;
  const line = state.doc.lineAt(state.selection.main.head);
  const prevHasText = line.number > 1 && state.doc.line(line.number - 1).text.trim() !== '';
  const hasText = line.text.trim() !== '';
  const insert = hasText ? '\n\n---\n' : (prevHasText ? '\n' : '') + '---\n';
  const from = hasText ? line.to : line.from;
  view.dispatch({
    changes: { from, to: line.to, insert },
    selection: { anchor: from + insert.length },
    userEvent: 'input.divider',
  });
  return true;
}

export function horizontalRule(): InkFabPlugin {
  return {
    name: 'horizontal-rule',
    commands: [{ name: 'Divider', aliases: ['rule', 'hr', 'line'], run: insertDivider }],
    nodes: [
      {
        node: 'HorizontalRule',
        render: (node, ctx) => {
          const line = ctx.state.doc.lineAt(node.from);
          const decos = [Decoration.line({ class: 'cm-hr-line' }).range(line.from)];
          if (!ctx.touches(line.from, line.to)) {
            decos.push(Decoration.replace({}).range(node.from, node.to));
          }
          return decos;
        },
      },
    ],
    // Spacing is padding, not margin — see the height-map note in headings.ts.
    styles: `
.cm-editor .cm-hr-line {
  position: relative;
  text-align: center;
  color: transparent;
  user-select: none;
  padding: 0.4em 0;
}
.cm-editor .cm-hr-line::before {
  content: "";
  display: block;
  border-top: 1px solid var(--border);
  width: 40%;
  margin: 0 auto;
}
.app.raw .cm-editor .cm-hr-line::before { display: none; }
.app.raw .cm-editor .cm-hr-line { color: var(--fg-muted); }
`,
  };
}
