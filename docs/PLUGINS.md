# Writing an InkFab plugin

Everything InkFab renders — headings, tables, math, Mermaid, syntax
highlighting, even the `#`-hiding — is a plugin: one file under
`src/plugins/`, one line in `src/plugins/index.ts`. There is no build step, no
manifest, no base class. A plugin is a plain object.

To see any feature's full implementation, open its file. To remove a feature,
delete its file and its registry line. To add one, keep reading — the first
recipe is 20 lines and each recipe is a complete, working file.

## Your first plugin: highlight `==marks==`

Create `src/plugins/marks.ts`:

```ts
import { Decoration } from '@codemirror/view';
import type { InkFabPlugin } from './types';

export function marks(): InkFabPlugin {
  return {
    name: 'marks',
    scans: [
      {
        pattern: /==([^=\n]+)==/g,
        render: (m) => [
          Decoration.mark({ class: 'cm-marks-hl' }).range(
            m.index,
            m.index + m[0].length
          ),
        ],
      },
    ],
    styles: `
.cm-marks-hl { background: rgba(250, 204, 21, 0.35); border-radius: 3px; }
`,
  };
}
```

Register it in `src/plugins/index.ts`:

```ts
import { marks } from './marks';

export const plugins: InkFabPlugin[] = [
  // ...existing plugins...
  marks(),
];
```

Run `npm run dev`. Type `==like this==`. Done.

The runtime already handled the fiddly parts for you: your pattern was skipped
inside code blocks, skipped while the caret touches the match, and if your
`render` throws, the error is logged and the editor keeps running.

## The plugin shape

```ts
export interface InkFabPlugin {
  readonly name: string;              // unique; also your CSS class prefix
  readonly styles?: string;           // CSS, injected once at startup
  readonly extensions?: Extension[];  // raw CodeMirror extensions (keymaps, handlers…)
  readonly nodes?: NodeRenderer[];    // decorate markdown syntax-tree nodes
  readonly scans?: ScanRenderer[];    // decorate regex matches in the raw text
  readonly fencedLangs?: FencedLangRenderer[]; // replace ```lang blocks with widgets
  readonly commands?: Command[];      // actions with a key, listed in the / menu
  readonly onOpen?: Transform;        // rewrite file content when a file opens
  readonly onSave?: Transform;        // rewrite file content before it's written
}
```

Plugins are factory functions (`marks()`, `mermaid({ theme: 'dark' })`) so
configuration is just arguments at the registry site.

Every renderer receives a `PluginContext`:

```ts
interface PluginContext {
  state: EditorState;                        // the current document
  filePath: string | null;                   // the open file, for resolving relative paths
  touches: (from, to) => boolean;            // is the caret inside this range (and editor focused)?
  inCode: (pos) => boolean;                  // is this position inside a code span/block?
}
```

`touches` is the heart of the live-editing feel: render the pretty version
when the caret is elsewhere, fall back to raw source when the user is editing
that range. Node and fenced renderers decide themselves (check
`ctx.touches(...)` and return `null` to decline); scan renderers get both
checks applied automatically before `render` is called.

## Recipes

### Render a fenced language (like Mermaid)

```ts
import { WidgetType } from '@codemirror/view';
import type { InkFabPlugin } from './types';
import { blockShell } from './lib/block-shell';

class CsvWidget extends WidgetType {
  constructor(readonly source: string) { super(); }
  eq(other: CsvWidget) { return other.source === this.source; } // skip DOM rebuilds
  toDOM() {
    const table = document.createElement('table');
    table.className = 'cm-csv-table';
    for (const line of this.source.split('\n')) {
      const tr = table.insertRow();
      for (const cell of line.split(',')) tr.insertCell().textContent = cell.trim();
    }
    return blockShell(table); // see "Rules of the road" — never margin
  }
}

export function csv(): InkFabPlugin {
  return {
    name: 'csv',
    fencedLangs: [
      {
        lang: 'csv', // or ['csv', 'tsv'], or a predicate: (lang) => ...
        toWidget: (body) => (body.trim() ? new CsvWidget(body) : null),
      },
    ],
    styles: `.cm-csv-table { border-collapse: collapse; } /* … */`,
  };
}
```

Exact `lang` strings always win over predicates, so a specific plugin (Mermaid
owns `mermaid`) beats an open-ended one (highlight.js claims "anything I
know") no matter the registry order. Return `null` from `toWidget` to decline
— the fence stays as styled source lines.

### Decorate a syntax-tree node (like tables, tasks, images)

Node renderers match Lezer node names from `@lezer/markdown` — `Table`,
`TaskMarker`, `Image`, `Link`, `Blockquote`, `ATXHeading1`…`6`,
`HorizontalRule`, `FencedCode`, `EmphasisMark`, and so on.

```ts
export function tasks(): InkFabPlugin {
  return {
    name: 'tasks',
    nodes: [
      {
        node: 'TaskMarker',
        render: (node, ctx) => {
          const line = ctx.state.doc.lineAt(node.from);
          if (ctx.touches(line.from, line.to)) return null; // raw while editing
          const checked = /x/i.test(ctx.state.doc.sliceString(node.from, node.to));
          return [
            Decoration.replace({ widget: new TaskCheckboxWidget(checked) })
              .range(node.from, node.to),
          ];
        },
      },
    ],
  };
}
```

To discover node names, log the tree while typing:
`syntaxTree(state).iterate({ enter: (n) => console.log(n.name, n.from, n.to) })`.

### Transform file content on open or save

```ts
export function trimTrailingWhitespace(): InkFabPlugin {
  return {
    name: 'trim-trailing-whitespace',
    onSave: (content) => content.replace(/[ \t]+$/gm, ''),
  };
}
```

`onOpen` runs when a file is opened (if it changes the content, the document
opens dirty so the user knows a save will rewrite it). `onSave` runs on the
text just before it hits disk. Both are pure `(content, filePath) => content`
functions — trivially unit-testable. `openai-citations.ts` is a real example.

### Add a command (a key, and an entry in the / menu)

A command is something the user does: make a heading, tick a task. Declare
it in `commands` and the runtime binds its key and lists it in the `/` menu
with that key shown beside it, which is how people learn the shortcut.

```ts
export function bold(): InkFabPlugin {
  return {
    name: 'bold',
    commands: [
      {
        name: 'Bold',              // what the / menu shows
        key: 'Mod-b',              // optional; omit for menu-only commands
        aliases: ['strong'],       // optional extra words /-filtering matches
        run: (view) => {
          const { from, to } = view.state.selection.main;
          if (from === to) return false;
          view.dispatch({
            changes: [
              { from, insert: '**' },
              { from: to, insert: '**' },
            ],
          });
          return true;
        },
      },
    ],
  };
}
```

When chosen from the menu, the typed `/query` is deleted first, then `run`
is called, so commands that act on "the current line" just work.
`lib/commands.ts` has helpers for line commands: `selectedLines` and
`toggleBlockPrefix('> ')` (that one is the whole Quote command).

### Add a keymap, click handler, or any CodeMirror extension

The `extensions` field passes anything through to CodeMirror. Use it for
behaviour that isn't a named action: the toc plugin uses it for
scroll-to-heading clicks, the tasks plugin for clicking a checkbox, and
list-toggle for Tab / Shift-Tab, which only act on list items.

### Share data between plugins

Don't build an event bus. `EditorState` is immutable, so a `WeakMap<EditorState, T>`
memo gives every plugin the same computed value for free. `lib/headings.ts`
does this: the headings plugin and the toc plugin both call
`collectHeadings(state)`; whoever asks first pays the tree walk, and anchor
ids can never drift from toc entries.

## Rules of the road

- **Prefix your CSS classes with `cm-<plugin-name>-`.** Scoping is by
  convention; there is no shadow DOM.
- **Never put vertical `margin` on lines or block widgets.** CodeMirror's
  height map measures without margins, and margins silently corrupt click
  positioning and arrow-key motion (this was a real shipped bug). Use padding,
  or wrap bordered cards in `blockShell()` from `lib/block-shell.ts`, which
  provides the spacing as padding on an outer div.
- **Implement `eq()` on widgets.** Decorations rebuild on every keystroke and
  selection move; `eq` returning true is what stops your DOM from being
  recreated each time.
- **Renders must be fast and synchronous.** Every renderer runs on each
  rebuild. Kick off async work from `toDOM()` and fill the element in later —
  see mermaid.ts for the pattern (placeholder → rendered SVG).
- **Failures are contained but not free.** The runtime wraps every plugin call
  in a try/catch and logs to the console — a broken plugin loses its own
  rendering, never the document. Still: return `null` for "not applicable"
  rather than throwing.
- **One block-replace decoration per range.** If two plugins both try to
  block-replace the same text, CodeMirror throws (the runtime catches it, but
  one of them silently loses). Specific beats generic: claim narrowly.
- **Color only through theme variables.** The app has three themes (paper,
  light, dark) selected by `data-theme` on `<html>`; a theme is nothing but a
  variable block in `styles.css`. Use `var(--fg)`, `var(--bg-sunken)`,
  `var(--accent)`, `var(--border-soft)`, … — never hex literals — and derive
  tints with `color-mix(in srgb, var(--accent) 25%, transparent)`. If your
  widget bakes colors into its DOM instead of using CSS (mermaid does), store
  the active theme on the widget and compare it in `eq()`: the editor rebuilds
  decorations on theme switch, and a failing `eq` is what triggers your
  re-render.

## Testing

E2e tests drive the real Electron app (`tests/inkfab.spec.ts`); each feature
gets a test that types markdown and asserts on the rendered DOM:

```ts
test('==marks== render highlighted', async () => {
  await page.locator('.cm-content').click();
  await page.keyboard.press('Meta+A');
  await page.keyboard.type('some ==hot== text\n\nmove caret away');
  await expect(page.locator('.cm-marks-hl')).toContainText('hot');
});
```

Run with `npm test`. Transforms (`onOpen`/`onSave`) are pure functions — test
them directly without the harness if you prefer.
