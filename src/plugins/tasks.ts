import { Decoration, WidgetType } from '@codemirror/view';
import type { InkFabPlugin } from './types';

// `- [ ]` / `- [x]` render as drawn checkboxes when the caret is off the line.

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

export function tasks(): InkFabPlugin {
  return {
    name: 'tasks',
    nodes: [
      {
        node: 'TaskMarker',
        render: (node, ctx) => {
          const line = ctx.state.doc.lineAt(node.from);
          if (ctx.touches(line.from, line.to)) return null;
          const checked = /x/i.test(ctx.state.doc.sliceString(node.from, node.to));
          return [
            Decoration.replace({
              widget: new TaskCheckboxWidget(checked),
            }).range(node.from, node.to),
          ];
        },
      },
    ],
    styles: `
.cm-task-box {
  display: inline-block;
  width: 14px;
  height: 14px;
  border: 1.5px solid var(--fg-muted);
  border-radius: 3px;
  margin-right: 6px;
  position: relative;
  top: 2px;
  background: transparent;
}
.cm-task-box.checked {
  background: var(--accent);
  border-color: var(--accent);
}
.cm-task-box.checked::after {
  content: "";
  position: absolute;
  left: 3.5px;
  top: 0.5px;
  width: 4px;
  height: 8px;
  border-right: 2px solid #fdfcf7;
  border-bottom: 2px solid #fdfcf7;
  transform: rotate(45deg);
}
`,
  };
}
