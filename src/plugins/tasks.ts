import { Decoration, EditorView, WidgetType } from '@codemirror/view';
import type { ChangeSpec, Line } from '@codemirror/state';
import type { InkFabPlugin } from './types';
import { dispatchLineChanges, selectedLines } from './lib/commands';

// `- [ ]` / `- [x]` render as drawn checkboxes unless the caret is on the marker,
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

// A done task is a hand-written tick, not a box: one stroke with a short down-stroke
// and a long, slightly bowed up-stroke that overshoots the text height a
// little, like a tick written in a margin.
const TICK_SVG =
  '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" ' +
  'stroke-linecap="round" stroke-linejoin="round"><path d="M2.4 11.2 C3.2 10.9 4.4 11.6 5.4 13.2 ' +
  'L6.6 15.6 C8.2 11.6 11.4 6.4 15.2 3.2 C16.2 2.4 17.2 1.8 18.2 1.5"/></svg>';

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
    if (this.checked) el.innerHTML = TICK_SVG;
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
          // Raw `- [ ]` only while the caret is on the marker itself, like
          // bullets, so clicking into the text keeps the box. The space after
          // the box is hidden with it, so a caret at the start of the text
          // sits just past the marker rather than on it — except on an empty
          // task, where hiding it would leave no visible spot for the caret
          // and the browser would put it back before the box.
          const markFrom = node.parent?.prevSibling?.name === 'ListMark' ? node.parent.prevSibling.from : node.from;
          if (!ctx.touches(markFrom, node.to)) {
            const line = ctx.state.doc.lineAt(node.from);
            const space =
              ctx.state.doc.sliceString(node.to, node.to + 1) === ' ' && node.to + 1 < line.to ? 1 : 0;
            out.push(
              Decoration.replace({
                widget: new TaskCheckboxWidget(checked),
              }).range(node.from, node.to + space)
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
  border: 1.5px solid var(--fg);
  border-radius: 3px;
  margin-right: calc(6px + 0.25em); /* stands in for the hidden space */
  position: relative;
  top: 2px;
  background: transparent;
  cursor: pointer;
}
/* Done: no box, just a charcoal tick in the same footprint. */
.cm-task-box.checked {
  border-color: transparent;
  color: var(--fg);
  overflow: visible;
}
.cm-task-box.checked svg {
  position: absolute;
  left: -2px;
  top: -6px;
  width: 21px;
  height: 21px;
  transform: rotate(-4deg);
}
.cm-task-done,
.cm-task-done * {
  color: var(--fg-faint);
  text-decoration: line-through 1px var(--fg-faint);
}
`,
  };
}
