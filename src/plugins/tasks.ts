import { Decoration, EditorView, WidgetType } from '@codemirror/view';
import type { ChangeSpec, Line } from '@codemirror/state';
import type { InkFabPlugin } from './types';
import { dispatchLineChanges, selectedLines } from './lib/commands';

// `- [ ]` / `- [x]` render as drawn checkboxes when the caret is off the line,
// and a done item's text is struck through. The file stays plain GFM.
//
// Checklist (⇧⌘9, Google Docs' key) turns the selected lines into tasks, or
// back into plain text if the first one already is. ⌘↵ ticks them, org-mode
// style: open → done → open, making a task first if the line isn't one.
// Clicking a drawn box ticks it without moving the caret onto the line.

const TASK_RE = /^((\s*)(?:([-*+]|\d+[.)])\s+)?)(?:\[([ xX])\](?=\s|$))?/;

function tickLine(line: Line): ChangeSpec {
  const [, lead, indent, marker, box] = TASK_RE.exec(line.text)!;
  if (box !== undefined) {
    const at = line.from + lead.length + 1; // the char inside [ ]
    return { from: at, to: at + 1, insert: box === ' ' ? 'x' : ' ' };
  }
  if (marker) return { from: line.from + lead.length, insert: '[ ] ' };
  return { from: line.from + indent.length, insert: '- [ ] ' };
}

function tickTasks(view: EditorView) {
  dispatchLineChanges(view, selectedLines(view.state).map(tickLine), 'input.task');
  return true;
}

function toggleChecklist(view: EditorView) {
  const lines = selectedLines(view.state);
  const off = TASK_RE.exec(lines[0].text)![4] !== undefined;
  const changes: ChangeSpec[] = [];
  for (const line of lines) {
    const [, lead, indent, marker, box] = TASK_RE.exec(line.text)!;
    if (off && box !== undefined) {
      // Drop the marker and box (and the space after), leaving the text.
      const end = lead.length + 3 + (line.text[lead.length + 3] === ' ' ? 1 : 0);
      changes.push({ from: line.from + indent.length, to: line.from + end });
    } else if (!off && box === undefined) {
      changes.push(
        marker
          ? { from: line.from + lead.length, insert: '[ ] ' }
          : { from: line.from + indent.length, insert: '- [ ] ' }
      );
    }
  }
  dispatchLineChanges(view, changes, 'input.task');
  return true;
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
  ignoreEvent() {
    return false; // let the mousedown handler below see clicks
  }
}

const clickToToggle = EditorView.domEventHandlers({
  mousedown(e, view) {
    const box = (e.target as HTMLElement).closest?.('.cm-task-box');
    if (!box) return false;
    e.preventDefault(); // keep the caret off the line so the box stays drawn
    const line = view.state.doc.lineAt(view.posAtDOM(box));
    view.dispatch({ changes: tickLine(line), userEvent: 'input.task' });
    return true;
  },
});

export function tasks(): InkFabPlugin {
  return {
    name: 'tasks',
    commands: [
      { name: 'Checklist', key: 'Mod-Shift-9', aliases: ['todo', 'task', 'checkbox'], run: toggleChecklist },
      { name: 'Tick task', key: 'Mod-Enter', aliases: ['done', 'check', 'complete'], run: tickTasks },
    ],
    extensions: [clickToToggle],
    nodes: [
      {
        node: 'TaskMarker',
        render: (node, ctx) => {
          const checked = /x/i.test(ctx.state.doc.sliceString(node.from, node.to));
          const out = [];
          const task = node.parent;
          if (checked && task && task.to > node.to + 1) {
            out.push(Decoration.mark({ class: 'cm-task-done' }).range(node.to + 1, task.to));
          }
          const line = ctx.state.doc.lineAt(node.from);
          if (!ctx.touches(line.from, line.to)) {
            out.push(
              Decoration.replace({
                widget: new TaskCheckboxWidget(checked),
              }).range(node.from, node.to)
            );
          }
          return out;
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
  cursor: pointer;
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
  border-right: 2px solid var(--accent-contrast);
  border-bottom: 2px solid var(--accent-contrast);
  transform: rotate(45deg);
}
.cm-task-done,
.cm-task-done * {
  text-decoration: line-through;
  color: var(--fg-muted);
}
`,
  };
}
