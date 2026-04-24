# InkFab architecture — minimal core, plugin everything

## Guiding principle

**If you can remove a feature by deleting a file and one line of imports, the architecture is right.**

Today InkFab fails this test. `src/liveMarkdown.ts` is ~700 lines, and features like tables, Mermaid, highlight.js, math, TOC, and citation stripping are wired directly into a single `build()` function. Adding a feature means editing that file. Removing one means hunting through it.

This document proposes an architecture where the core knows how to edit markdown and dispatch decorations, and every actual rendering/transformation concern is a plugin. The goal is "a new contributor reads one plugin file to understand one feature."

---

## Honest audit of what's in the monolith today

Each of these is a candidate plugin — they have nothing to do with each other except happening to live in `liveMarkdown.ts`:

| Concern             | Entry point                                    | Lines |
|---------------------|------------------------------------------------|-------|
| Tables (GFM)        | `Table` node + custom cell splitter + widget   | ~140  |
| Task checkboxes     | `TaskMarker` node → widget                     | ~15   |
| Images              | `Image` node → widget                          | ~30   |
| Horizontal rule     | `HorizontalRule` node → line class + replace   | ~8    |
| Mark hiding         | `EmphasisMark`/`CodeMark`/`QuoteMark`/`LinkMark`| ~40   |
| KaTeX math          | Text scan for `$..$` and `$$..$$`              | ~35   |
| Heading anchors     | `ATXHeading*`/`SetextHeading*` → slug id       | ~25   |
| TOC                 | Text scan for `[[toc]]` → widget               | ~40   |
| Mermaid             | `FencedCode` (lang=`mermaid`) → widget         | ~40   |
| highlight.js        | `FencedCode` (known lang) → widget             | ~40   |
| Footnotes           | markdown-it plugin (only in table cell render) | ~2    |

Plus in `src/App.tsx`: OpenAI citation stripping on file open (~10 lines).
Plus in `src/Editor.tsx`: TOC anchor click handler, file/link click handler (~30 lines).

Everything hardcoded. To disable any one: hunt. To add a new one: extend `build()`.

---

## Proposed architecture

### The core

Only four things:

1. **Editor shell** (`src/Editor.tsx`) — CodeMirror setup, markdown language, stock keymap, file-dispatch click handler.
2. **App shell** (`src/App.tsx`) — window chrome, dirty state, file IPC, raw-mode toggle.
3. **Plugin runtime** (`src/plugins/runtime.ts`) — iterates the Lezer tree, dispatches to plugins, applies file-transform hooks, injects plugin styles. ~100 lines.
4. **Plugin registry** (`src/plugins/index.ts`) — the single array of enabled plugins. Edit this file to enable/disable/reorder.

Everything else is a plugin file under `src/plugins/<name>.ts`.

### Plugin shape

A plugin is a plain object. No base class, no lifecycle, fully tree-shakeable.

```ts
// src/plugins/types.ts
import type { Extension } from '@codemirror/state';
import type { Range, Decoration, WidgetType } from '@codemirror/view';
import type { SyntaxNode } from '@lezer/common';

export interface PluginContext {
  state: EditorState;
  filePath: string | null;
  touches: (from: number, to: number) => boolean;  // caret in range
  inCode: (pos: number) => boolean;                // pos inside a fenced/inline code span
}

export interface NodeRenderer {
  node: string;                                     // Lezer node name
  render: (node: SyntaxNode, ctx: PluginContext) => Range<Decoration>[] | null;
}

export interface ScanRenderer {
  pattern: RegExp;                                  // /g regex against the full doc text
  render: (m: RegExpExecArray, ctx: PluginContext) => Range<Decoration>[] | null;
}

export interface FencedLangRenderer {
  lang: string | string[];                          // 'mermaid', ['ts','tsx','js']
  toWidget: (body: string, ctx: PluginContext) => WidgetType;
}

export type Transform = (content: string, filePath: string) => string;

export interface InkFabPlugin {
  readonly name: string;
  readonly styles?: string;                         // scoped CSS, injected once
  readonly extensions?: Extension[];                // keymaps, tooltips, gutters
  readonly nodes?: NodeRenderer[];
  readonly scans?: ScanRenderer[];
  readonly fencedLangs?: FencedLangRenderer[];
  readonly onOpen?: Transform;                      // transform content at file-open
  readonly onSave?: Transform;                      // transform content at file-save
}
```

Plugins that need config export a **factory**:

```ts
export function mermaid(opts: { theme?: string } = {}): InkFabPlugin {
  mermaidLib.initialize({ theme: opts.theme ?? 'neutral', ... });
  return {
    name: 'mermaid',
    styles: `.cm-mermaid-block { ... }`,
    fencedLangs: [{ lang: 'mermaid', toWidget: (src) => new MermaidWidget(src) }],
  };
}
```

### The registry

```ts
// src/plugins/index.ts
import { markHiding } from './mark-hiding';
import { headingAnchors } from './heading-anchors';
import { toc } from './toc';
import { tables } from './tables';
import { tasks } from './tasks';
import { images } from './images';
import { horizontalRule } from './horizontal-rule';
import { katex } from './katex';
import { mermaid } from './mermaid';
import { highlight } from './highlight';
import { openaiCitations } from './openai-citations';

export const plugins = [
  markHiding(),
  headingAnchors(),   // must precede toc — toc reads heading ids
  toc(),
  tables(),
  tasks(),
  images(),
  horizontalRule(),
  katex(),
  mermaid({ theme: 'neutral' }),
  highlight(),
  openaiCitations(),
];
```

Add a plugin: add a file, add a line. Disable: comment a line. Fork: import your own list. That's the whole extension model.

### The runtime

```ts
// src/plugins/runtime.ts — sketch
export function createPluginExtension(plugins: InkFabPlugin[], filePath: string | null): Extension {
  plugins.forEach((p) => p.styles && injectStyleOnce(p.name, p.styles));

  const field = StateField.define<DecorationSet>({
    create: (s) => build(s, plugins, filePath),
    update: (v, tr) =>
      tr.docChanged || tr.selection ? build(tr.state, plugins, filePath) : v,
    provide: (f) => EditorView.decorations.from(f),
  });

  return [field, ...plugins.flatMap((p) => p.extensions ?? [])];
}

export const applyOpenTransforms = (s: string, path: string, ps: InkFabPlugin[]) =>
  ps.reduce((acc, p) => (p.onOpen ? p.onOpen(acc, path) : acc), s);

export const applySaveTransforms = (s: string, path: string, ps: InkFabPlugin[]) =>
  ps.reduce((acc, p) => (p.onSave ? p.onSave(acc, path) : acc), s);
```

The `build()` walker:

```ts
function build(state, plugins, filePath): DecorationSet {
  const ctx = makeContext(state, filePath);
  const decos: Range<Decoration>[] = [];
  const nodeIdx = indexNodes(plugins);          // Map<nodeName, NodeRenderer[]>
  const fencedIdx = indexFenced(plugins);       // Map<lang, FencedLangRenderer>

  syntaxTree(state).iterate({
    enter: (node) => {
      if (node.name === 'FencedCode' && !ctx.touches(node.from, node.to)) {
        const { lang, body } = parseFence(state, node);
        const handler = fencedIdx.get(lang);
        if (handler) {
          const widget = safely(() => handler.toWidget(body, ctx));
          if (widget) decos.push(
            Decoration.replace({ widget, block: true }).range(node.from, node.to)
          );
        }
      }
      for (const h of nodeIdx.get(node.name) ?? []) {
        const ranges = safely(() => h.render(node.node, ctx));
        if (ranges) decos.push(...ranges);
      }
    },
  });

  const text = state.doc.toString();
  for (const p of plugins) for (const scan of p.scans ?? []) {
    scan.pattern.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = scan.pattern.exec(text))) {
      if (ctx.inCode(m.index)) continue;
      if (ctx.touches(m.index, m.index + m[0].length)) continue;
      const ranges = safely(() => scan.render(m!, ctx));
      if (ranges) decos.push(...ranges);
    }
  }

  return Decoration.set(decos, true);
}
```

`safely()` wraps any plugin call in try/catch — one plugin's bug can't take the editor down.

### File transforms

`App.tsx` loses its hardcoded `stripOpenAICitations` import. It becomes:

```tsx
const openDocument = (filePath, raw) => {
  const content = applyOpenTransforms(raw, filePath, plugins);
  setSource(content);
  syncFilePath(filePath);
  syncDirty(content !== raw);   // if any plugin cleaned something, we're dirty
};

const handleSave = async (forceDialog) => {
  const toWrite = applySaveTransforms(sourceRef.current, filePathRef.current ?? '', plugins);
  const saved = await window.inkfab.saveFile(forceDialog ? null : filePathRef.current, toWrite);
  ...
};
```

OpenAI citation stripping is now just `openaiCitations()` in the registry. Want to disable it? Delete the line.

---

## Extension points — reference

| Extension point       | Use case                                    | Plugin field    |
|-----------------------|---------------------------------------------|-----------------|
| Node-match render     | Tables, images, tasks, H-rule, headings     | `nodes`         |
| Regex scan render     | `$..$` math, `[[toc]]`, frontmatter parse   | `scans`         |
| Fenced-lang render    | Mermaid, highlight.js, future PlantUML/D2   | `fencedLangs`   |
| On-open transform     | Citation strip, line-ending normalize       | `onOpen`        |
| On-save transform     | Prettier-style format, frontmatter update   | `onSave`        |
| CodeMirror extension  | Keymap, command, tooltip, gutter            | `extensions`    |
| Scoped CSS            | Widget styling                              | `styles`        |

If a plausible feature doesn't fit one of these, it's a signal to either reshape the feature or add a carefully-scoped new extension point. Adding one should feel expensive — the list should stay short.

---

## Migration plan

One plugin per PR. Each slice stays green on `npm test`.

1. **Scaffolding.** Create `types.ts`, `runtime.ts`, `index.ts` with `plugins = []`. No behavior change. Ship.
2. **Pilot: `openaiCitations`.** Transform-only, no rendering, easiest. One test already covers it.
3. **Widget plugins, one at a time, in this order (dependencies flow downward):**
   mark-hiding → heading-anchors → toc → tables → tasks → images → horizontal-rule → katex → mermaid → highlight → footnotes.
4. **Delete the monolith.** `liveMarkdown.ts` shrinks each PR. At the end, it's gone — only `plugins/*.ts` remain.
5. **Plugin author doc.** 2-page cookbook: "Add a fenced-lang renderer," "Add a scan pass," "Add an on-save transform."

No big rewrite. Every PR is reversible.

### Before/after, the pilot

**Before** (`App.tsx`):
```tsx
import { hasOpenAICitations, stripOpenAICitations } from './openaiCitations';

const openDocument = useCallback((nextFilePath, content) => {
  const hadCitations = hasOpenAICitations(content);
  const cleaned = hadCitations ? stripOpenAICitations(content) : content;
  setSource(cleaned);
  syncFilePath(nextFilePath);
  syncDirty(hadCitations);
}, [...]);
```

**After** (`App.tsx`):
```tsx
import { applyOpenTransforms } from './plugins/runtime';
import { plugins } from './plugins';

const openDocument = useCallback((nextFilePath, content) => {
  const cleaned = applyOpenTransforms(content, nextFilePath, plugins);
  setSource(cleaned);
  syncFilePath(nextFilePath);
  syncDirty(cleaned !== content);
}, [...]);
```

`openaiCitations.ts` becomes `plugins/openai-citations.ts`:
```ts
import type { InkFabPlugin } from './types';
import { stripOpenAICitations } from '../util/openai-citations';

export function openaiCitations(): InkFabPlugin {
  return {
    name: 'openai-citations',
    onOpen: (content) => stripOpenAICitations(content),
  };
}
```

That's the entire shape. Every future plugin is a variant of this file.

---

## Failure modes & guardrails

- **Plugin throws** → `safely()` catches, logs to console, drops the decoration. Editor keeps running.
- **Plugin order matters** (TOC reads heading ids; `markHiding` runs before others assume marks are gone) → registry file is the source of truth for order. Document these in comments at the registry site, not in plugin internals.
- **Two plugins claim the same range** → both contribute decorations. If both are block-replace, CodeMirror throws. One plugin must cede. Don't build a priority system; document the rule and rely on plugin authors to guard.
- **Plugin ships bad CSS** → each plugin owns a unique class prefix (`.cm-<name>-...`). Scoped by convention, not enforcement.
- **Plugin performance** → each `render` runs on every decoration rebuild. Keep per-node work O(1). Optional `runtime.ts` debug flag prints per-plugin timings.

---

## What "minimal" buys you

1. **Bundle size.** `highlight.js` is ~500KB. It's paid only if `highlight()` is in the registry. Same for Mermaid.
2. **Mental model.** "Where does Mermaid live?" → `plugins/mermaid.ts`. Not "scan `liveMarkdown.ts` for the word mermaid."
3. **Forks.** Anyone can fork and swap the registry without touching the editor.
4. **Testability.** Transform/scan plugins are pure functions, unit-testable without Electron or CodeMirror.
5. **Discipline.** If you catch yourself adding a branch to `build()`, you know you're violating the design.

## What it costs you

- **One more indirection.** Reading Mermaid means opening `plugins/mermaid.ts` + `plugins/runtime.ts` side by side.
- **A soft API contract.** `NodeRenderer` / `ScanRenderer` / `FencedLangRenderer` shapes become public-ish. Changing them is a real change. Keep them tiny.
- **More files.** ~12 plugin files instead of one monolith. Net lines-of-code probably lower. Each file is <100 lines.

---

## Explicitly not in v1

- **Runtime-loaded user plugins** (`~/.inkfab/plugins/`). Needs sandboxing, trust prompts, API stability contracts. Skip until the internal design is stable.
- **Plugin settings UI.** Config is factory arguments in the registry. A settings panel is a later concern.
- **Inter-plugin event bus.** If two plugins cooperate (TOC reads heading anchors), they do it via CodeMirror state — not a custom pub/sub.
- **Plugin marketplace / remote registry.** One repo, one registry file.

When these become real needs, the plugin shape above is already close to what you'd expose externally — so adding them later is additive, not a rewrite.

---

## Next step

If you greenlight this:

1. Scaffold `src/plugins/{types,runtime,index}.ts` with `plugins = []`. ~120 lines, no behavior change.
2. Port `openaiCitations` as the pilot. ~50 lines, one test, one PR.
3. If it feels right, continue through the list.
