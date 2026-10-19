# InkFab

A quiet local markdown editor with live rendering (GitHub-Flavored Markdown dialect). Everything beyond "edit text" is a plugin.

Three color themes — **paper** (default, warm old-paper), **light**, and **dark** — switchable from the titlebar button or View ▸ Theme, remembered across launches. A theme is just a CSS-variable block in `src/styles.css`; every plugin styles itself off those variables.

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the design — minimal core, plugin everything — and [`docs/PLUGINS.md`](docs/PLUGINS.md) for the plugin-author cookbook (your first plugin is ~20 lines).

---

## Plugins — status

Every feature is a standalone file under `src/plugins/`, registered in `src/plugins/index.ts`. Disable any of them by commenting out one registry line.

### Implemented

| Plugin | File | Extension points |
|---|---|---|
| `mark-hiding` | `src/plugins/mark-hiding.ts` | `nodes` |
| `headings` | `src/plugins/headings.ts` | `nodes`, `commands` (⌥⌘1–3), `styles` |
| `toc` | `src/plugins/toc.ts` | `scans`, `extensions`, `styles` |
| `blockquotes` | `src/plugins/blockquotes.ts` | `nodes`, `commands`, `styles` |
| `fenced-code` | `src/plugins/fenced-code.ts` | `nodes`, `commands`, `styles` |
| `highlight` | `src/plugins/highlight.ts` | `fencedLangs`, `styles` |
| `mermaid` | `src/plugins/mermaid.ts` | `fencedLangs`, `styles` |
| `tables` | `src/plugins/tables.ts` | `nodes`, `styles` |
| `tasks` | `src/plugins/tasks.ts` | `nodes`, `commands` (⇧⌘9 checklist, ⌘↵ tick), `extensions`, `styles` |
| `lists` | `src/plugins/lists.ts` | `nodes`, `styles` |
| `list-toggle` | `src/plugins/list-toggle.ts` | `commands` (⇧⌘7 numbered, ⇧⌘8 bullets), `extensions` (structure-aware Tab / ⇧Tab) |
| `images` | `src/plugins/images.ts` | `nodes`, `styles` |
| `links` | `src/plugins/links.ts` | `nodes`, `styles` |
| `horizontal-rule` | `src/plugins/horizontal-rule.ts` | `nodes`, `commands`, `styles` |
| `math` | `src/plugins/math.ts` | `scans`, `styles` |
| `openai-citations` | `src/plugins/openai-citations.ts` | `onOpen` |
| `slash-menu` | `src/plugins/slash-menu.ts` | `extensions` — `/` opens every plugin's `commands`, with their keys |

### Roadmap

#### Tier 1 — authoring quality-of-life
- [ ] `footnotes` — `[^1]` → linked footnote block (works inside table cells today via markdown-it)
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
