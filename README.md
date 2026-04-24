# InkFab

A quiet local markdown editor with live rendering. Everything beyond "edit text" is a plugin.

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the design — minimal core, plugin everything.

---

## Plugins — status

Status reflects whether a feature lives as a standalone file under `src/plugins/`. Features that still live inside `src/liveMarkdown.ts` are listed under **Roadmap**, not **Implemented**, even if they work in the app today.

### Implemented

| Plugin | File | Extension points |
|---|---|---|
| `openai-citations` | `src/plugins/openai-citations.ts` | `onOpen` |

### Roadmap

#### Tier 0 — extract from the monolith (parity with today's editor)
Everything here works in the app but still lives in `src/liveMarkdown.ts`. Porting them is the point of the plugin migration.

- [ ] `mark-hiding` — hide `**`/`_`/`` ` ``/`[]()` marks when caret is away
- [ ] `heading-anchors` — slugify headings, assign stable ids
- [ ] `toc` — `[[toc]]` → nav widget (depends on `heading-anchors`)
- [ ] `tables` — GFM tables rendered as HTML tables
- [ ] `tasks` — `- [ ]` / `- [x]` → checkbox widget
- [ ] `images` — inline image rendering with caption
- [ ] `horizontal-rule` — render `---` as a line
- [ ] `katex` — `$…$` / `$$…$$` math
- [ ] `mermaid` — ```` ```mermaid ``` ```` → diagram
- [ ] `highlight` — ```` ```ts ``` ```` → highlight.js output
- [ ] `footnotes` — `[^1]` → linked footnote block

#### Tier 1 — authoring quality-of-life
- [ ] `frontmatter` — YAML/TOML card; exposes parsed data to other plugins
- [ ] `wikilinks` — `[[Some Note]]` resolves relative to `filePath`
- [ ] `tags` — `#project/inkfab` → clickable chip
- [ ] `callouts` — `> [!note] Title` blocks with colored rails
- [ ] `smart-typography` — `--` → en-dash, `...` → ellipsis, curly quotes (on-save only)
- [ ] `word-count` — status-bar reading time
- [ ] `spellcheck` — browser or dictionary-backed

#### Tier 2 — richer rendering
- [ ] `diagrams-d2` / `plantuml` / `graphviz` — fenced-lang peers of mermaid
- [ ] `music-abc` — ABC notation → score via `abcjs`
- [ ] `chemistry` — SMILES / molfile → 2D structure
- [ ] `geo` — `geojson` / `kml` → embedded map
- [ ] `csv-table` — fenced `csv` → sortable table
- [ ] `embed` — YouTube / Vimeo / Spotify / Tweet URL → inline card
- [ ] `mermaid-themes` — theme from frontmatter
- [ ] `katex-macros` — user macros from frontmatter

#### Tier 3 — knowledge / graph
- [ ] `backlinks` — panel of notes linking here
- [ ] `transclusion` — `![[Note#Heading]]` inlines content
- [ ] `dataview-lite` — frontmatter queries → table
- [ ] `graph-view` — sidebar link graph

#### Tier 4 — interactive documents
- [ ] `live-js` — sandboxed fenced `js live` execution
- [ ] `excalidraw` — fenced Excalidraw JSON → editable canvas
- [ ] `charts` — fenced Vega-lite → rendered chart
- [ ] `spreadsheet` — formulas in table cells
- [ ] `forms` — radios, dropdowns, inputs that write back to the doc

#### Tier 5 — output / export
- [ ] `export-pdf` / `export-html`
- [ ] `prettier-format` — opinionated on-save format
- [ ] `prettier-toc` — regenerate `<!-- toc -->` on save
- [ ] `link-check` — warn on broken wikilinks / dead paths

---

## Scripts

```
npm run dev       # Vite + Electron dev
npm run dist      # Build signed-ish macOS app
npm test          # Playwright suite
```
