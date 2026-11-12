import { useCallback, useEffect, useRef, useState } from 'react';
import Editor from './Editor';
import Sidebar from './Sidebar';
import type { FolderEntry } from './global';
import logoUrl from '../assets/icon-source.png';
import {
  applyOpenTransforms,
  applySaveTransforms,
  plugins,
} from './plugins';

const WELCOME = `# InkFab

A *quiet* local markdown editor with **live** rendering.

Type inline. Headings, emphasis, and [links](https://example.com) style themselves as you move away; the raw marks reappear only when the caret returns.

[[toc]]

## What you can write

- Lists, as you'd expect
- > Blockquotes, set aside in a softer voice
- \`inline code\` with a warm accent
- Footnotes [^1], task boxes, tables

| Feature | Syntax | Renders live |
| --- | --- | --- |
| Table | \`| a | b |\` | Yes |
| Task | \`- [x] done\` | Yes |

[^1]: Rendered by markdown-it under the hood — or by CodeMirror decorations in the live view.

## Math, rendered in place

Pythagoras, $a^2 + b^2 = c^2$, sitting comfortably in prose.

$$
\\int_{-\\infty}^{\\infty} e^{-x^2}\\,dx = \\sqrt{\\pi}
$$

## Code, when you need it

\`\`\`ts
function greet(name: string) {
  return \`hello, \${name}\`;
}
\`\`\`

## Diagrams with Mermaid

\`\`\`mermaid
flowchart LR
  A[Write] --> B[Render]
  B --> C{Looks good?}
  C -- yes --> D[Ship]
  C -- no --> A
\`\`\`

---

⌘O to open a file. ⌘S to save. ⌘/ to peek at the raw source.
`;

export type Theme = 'paper' | 'light' | 'dark';
const THEMES: Theme[] = ['paper', 'light', 'dark'];

const loadTheme = (): Theme => {
  const stored = localStorage.getItem('inkfab:theme');
  return THEMES.includes(stored as Theme) ? (stored as Theme) : 'paper';
};

const readStored = (key: string) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
const writeStored = (key: string, value: string | null) => {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {}
};

// Each window has its own folder, which main remembers per window across
// launches. Only a launch with no saved windows falls back to the folder last
// opened anywhere, so the first window still reopens where you left off.
const initialFolder = () => {
  const { folder, fromSession } = window.inkfab.initialFolder;
  return fromSession ? folder : readStored('inkfab:folder');
};

type TabState = {
  id: number;
  filePath: string | null;
  source: string;
  dirty: boolean;
};

let nextTabId = 1;
const makeTab = (partial: Partial<TabState> = {}): TabState => ({
  id: nextTabId++,
  filePath: null,
  source: '',
  dirty: false,
  ...partial,
});

const initialTab = makeTab({ source: WELCOME });

const tabName = (tab: TabState) =>
  tab.filePath ? tab.filePath.split(/[\\/]/).pop() : 'Untitled';

export default function App() {
  const [tabs, setTabs] = useState<TabState[]>([initialTab]);
  // Split view: one or two panes, each showing a tab (null = an empty half
  // waiting for a file). The focused pane's tab is the "active" one that
  // saving, the sidebar and ⌘O act on.
  const [panes, setPanes] = useState<(number | null)[]>([initialTab.id]);
  const [focusedPane, setFocusedPane] = useState(0);
  const [draggingTab, setDraggingTab] = useState<number | null>(null);
  const [dropSide, setDropSide] = useState<number | null>(null);
  const activeId = panes[focusedPane] ?? null;
  const [rawMode, setRawMode] = useState(false);
  const [theme, setTheme] = useState<Theme>(loadTheme);
  const [folder, setFolder] = useState<string | null>(initialFolder);
  const [tree, setTree] = useState<FolderEntry[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState(() => folder !== null);

  const tabsRef = useRef(tabs);
  const panesRef = useRef(panes);
  const focusedRef = useRef(focusedPane);
  const activeIdRef = useRef(activeId);
  tabsRef.current = tabs;
  panesRef.current = panes;
  focusedRef.current = focusedPane;
  activeIdRef.current = activeId;

  const active = tabs.find((t) => t.id === activeId) ?? null;

  // Ref is updated eagerly so sequential async flows (save-all, close) see
  // their own writes before React re-renders.
  const setTabsNow = useCallback((next: TabState[]) => {
    tabsRef.current = next;
    setTabs(next);
  }, []);

  const setPanesNow = useCallback((next: (number | null)[], focus = focusedRef.current) => {
    const f = Math.min(focus, next.length - 1);
    panesRef.current = next;
    focusedRef.current = f;
    activeIdRef.current = next[f] ?? null;
    setPanes(next);
    setFocusedPane(f);
  }, []);

  // Shows a tab in the focused pane. A tab already showing in the other pane
  // is focused there instead, so a document is never open in both halves.
  const showTab = useCallback(
    (id: number) => {
      const current = panesRef.current;
      const at = current.indexOf(id);
      if (at !== -1) setPanesNow(current, at);
      else setPanesNow(current.map((p, i) => (i === focusedRef.current ? id : p)));
    },
    [setPanesNow]
  );

  const toggleSplit = useCallback(() => {
    const current = panesRef.current;
    if (current.length === 1) {
      setPanesNow([current[0], null], 1); // the new half waits for a file
      return;
    }
    // Unsplit keeps the focused half's document (or the other, if it's empty).
    const keep = current[focusedRef.current] ?? current[1 - focusedRef.current];
    setPanesNow([keep], 0);
  }, [setPanesNow]);

  // A tab dropped on the left (0) or right (1) half of the editor area.
  const dropTab = useCallback(
    (id: number, side: number) => {
      const current = panesRef.current;
      if (current.length === 2) {
        const next = [...current];
        const from = next.indexOf(id);
        if (from !== -1 && from !== side) next[from] = next[side]; // swap halves
        next[side] = id;
        setPanesNow(next, side);
        return;
      }
      // Splitting: the dropped tab takes its half, the current one the other.
      // Dragging the tab that's already showing leaves the other half for its
      // neighbour, or empty when there isn't one.
      let other = current[0];
      if (other === id) {
        const all = tabsRef.current;
        const idx = all.findIndex((t) => t.id === id);
        other = (all[idx + 1] ?? all[idx - 1])?.id ?? null;
      }
      setPanesNow(side === 1 ? [other, id] : [id, other], side);
    },
    [setPanesNow]
  );

  const updateTab = useCallback(
    (id: number, patch: Partial<TabState>) => {
      setTabsNow(
        tabsRef.current.map((t) => (t.id === id ? { ...t, ...patch } : t))
      );
    },
    [setTabsNow]
  );

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('inkfab:theme', theme);
    window.inkfab.setTheme(theme); // keeps the View ▸ Theme radios in sync
  }, [theme]);

  useEffect(() => window.inkfab.onSetTheme(setTheme), []);

  // A folder that has since been deleted or moved is quietly forgotten.
  useEffect(() => {
    writeStored('inkfab:folder', folder);
    if (!folder) {
      setTree([]);
      window.inkfab.closeFolder();
      return;
    }
    let cancelled = false;
    const refresh = async () => {
      const next = await window.inkfab.listFolder(folder);
      if (cancelled) return;
      if (next === null) setFolder(null);
      else setTree(next);
    };
    void refresh();
    const offChanged = window.inkfab.onFolderChanged(() => void refresh());
    return () => {
      cancelled = true;
      offChanged();
    };
  }, [folder]);

  useEffect(
    () =>
      window.inkfab.onFolderOpened((dir) => {
        setFolder(dir);
        setSidebarOpen(true);
      }),
    []
  );

  useEffect(() => {
    window.inkfab.setDirty(tabs.some((t) => t.dirty));
  }, [tabs]);

  const activeFilePath = active?.filePath ?? null;
  useEffect(() => {
    window.inkfab.setCurrentFile(activeFilePath);
  }, [activeFilePath]);

  const saveTab = useCallback(
    async (id: number, forceDialog = false) => {
      const tab = tabsRef.current.find((t) => t.id === id);
      if (!tab) return false;
      const target = forceDialog ? null : tab.filePath;
      const toWrite = applySaveTransforms(tab.source, tab.filePath ?? '', plugins);
      const saved = await window.inkfab.saveFile(target, toWrite);
      if (!saved) return false;
      updateTab(id, { filePath: saved, dirty: false });
      return true;
    },
    [updateTab]
  );

  const handleSave = useCallback(
    async (forceDialog = false) => {
      const id = activeIdRef.current;
      return id === null ? false : saveTab(id, forceDialog);
    },
    [saveTab]
  );

  const handleNew = useCallback(() => {
    const tab = makeTab();
    setTabsNow([...tabsRef.current, tab]);
    showTab(tab.id);
  }, [setTabsNow, showTab]);

  const openInTab = useCallback(
    (filePath: string, content: string) => {
      const existing = tabsRef.current.find((t) => t.filePath === filePath);
      if (existing) {
        showTab(existing.id);
        return;
      }
      const cleaned = applyOpenTransforms(content, filePath, plugins);
      const tab = makeTab({ filePath, source: cleaned, dirty: cleaned !== content });
      setTabsNow([...tabsRef.current, tab]);
      showTab(tab.id);
    },
    [setTabsNow, showTab]
  );

  const handleOpen = useCallback(async () => {
    const res = await window.inkfab.openFile();
    if (!res) return;
    openInTab(res.filePath, res.content);
  }, [openInTab]);

  const handleOpenLinkedFile = useCallback(
    async (nextFilePath: string) => {
      const existing = tabsRef.current.find((t) => t.filePath === nextFilePath);
      if (existing) {
        showTab(existing.id);
        return;
      }
      const content = await window.inkfab.readFile(nextFilePath);
      openInTab(nextFilePath, content);
    },
    [openInTab, showTab]
  );

  const closeTab = useCallback(
    async (id: number) => {
      const tab = tabsRef.current.find((t) => t.id === id);
      if (!tab) return;
      if (tab.dirty) {
        const choice = await window.inkfab.confirmUnsavedChanges('close-tab', tab.filePath);
        if (choice === 'cancel') return;
        if (choice === 'save' && !(await saveTab(id))) return;
      }
      const idx = tabsRef.current.findIndex((t) => t.id === id);
      const remaining = tabsRef.current.filter((t) => t.id !== id);
      const next = remaining.length ? remaining : [makeTab()];
      setTabsNow(next);

      // A pane showing the closed tab moves to the nearest tab not already
      // in the other pane; in a split with none left, that half closes.
      const current = panesRef.current;
      const at = current.indexOf(id);
      if (at === -1) return;
      const free = next
        .map((t, i) => ({ id: t.id, dist: Math.abs(i - idx) }))
        .filter((t) => !current.includes(t.id))
        .sort((a, b) => a.dist - b.dist);
      if (free.length) {
        setPanesNow(current.map((p, i) => (i === at ? free[0].id : p)));
      } else {
        setPanesNow(current.filter((_, i) => i !== at), 0);
      }
    },
    [saveTab, setTabsNow, setPanesNow]
  );

  // ⌘W: close the focused tab; on an empty half, close the split instead.
  const closeFocused = useCallback(() => {
    const id = activeIdRef.current;
    if (id !== null) void closeTab(id);
    else if (panesRef.current.length === 2) toggleSplit();
  }, [closeTab, toggleSplit]);

  const saveAllAndClose = useCallback(async () => {
    let ok = true;
    for (const tab of [...tabsRef.current]) {
      if (!tab.dirty) continue;
      if (!(await saveTab(tab.id))) {
        ok = false;
        break;
      }
    }
    window.inkfab.completeCloseAfterSave(ok);
  }, [saveTab]);

  useEffect(() => {
    return window.inkfab.onMenu((action) => {
      if (action === 'new') handleNew();
      else if (action === 'open') void handleOpen();
      else if (action === 'save') void handleSave(false);
      else if (action === 'save-as') void handleSave(true);
      else if (action === 'close-tab') closeFocused();
      else if (action === 'save-and-close') void saveAllAndClose();
      else if (action === 'toggle-preview') setRawMode((v) => !v);
      else if (action === 'toggle-sidebar') setSidebarOpen((v) => !v);
      else if (action === 'close-folder') setFolder(null);
      else if (action === 'toggle-split') toggleSplit();
    });
  }, [handleNew, handleOpen, handleSave, closeFocused, saveAllAndClose, toggleSplit]);

  return (
    <div className={`app ${rawMode ? 'raw' : ''}`}>
      <header className="titlebar">
        <div className="titlebar-drag" />
        <div className="titlebar-left">
          <img src={logoUrl} alt="InkFab" className="logo" draggable={false} />
        </div>
        <div className="titlebar-center">
          <div className="tabs">
            {tabs.map((t) => (
              <div
                key={t.id}
                className={`tab ${t.id === activeId ? 'active' : panes.includes(t.id) ? 'shown' : ''}`}
                onClick={() => showTab(t.id)}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData('application/x-inkfab-tab', String(t.id));
                  e.dataTransfer.effectAllowed = 'move';
                  setDraggingTab(t.id);
                }}
                onDragEnd={() => {
                  setDraggingTab(null);
                  setDropSide(null);
                }}
              >
                <span className="title">{tabName(t)}</span>
                {t.dirty && <span className="dot" title="Unsaved" />}
                <button
                  className="tab-close"
                  title="Close tab (⌘W)"
                  onClick={(e) => {
                    e.stopPropagation();
                    void closeTab(t.id);
                  }}
                >
                  ×
                </button>
              </div>
            ))}
            <button
              className="tab-add"
              title="New document (⌘N)"
              onClick={() => handleNew()}
            >
              +
            </button>
          </div>
        </div>
        <div className="titlebar-actions">
          <button
            className="mode-btn"
            onClick={() =>
              setTheme((t) => THEMES[(THEMES.indexOf(t) + 1) % THEMES.length])
            }
            title="Color theme (click to cycle)"
          >
            {theme}
          </button>
          <button
            className={`mode-btn ${sidebarOpen ? 'active' : ''}`}
            onClick={() => setSidebarOpen((v) => !v)}
            title="Toggle sidebar (⌘\)"
          >
            files
          </button>
          <button
            className={`mode-btn ${panes.length > 1 ? 'active' : ''}`}
            onClick={toggleSplit}
            title="Split editor (⌥⌘\) — or drag a tab onto the editor"
          >
            split
          </button>
          <button
            className={`mode-btn ${rawMode ? 'active' : ''}`}
            onClick={() => setRawMode((v) => !v)}
            title="Toggle raw source (⌘/)"
          >
            {rawMode ? 'live' : 'raw'}
          </button>
        </div>
      </header>
      <main className="workspace">
        {sidebarOpen && (
          <Sidebar
            key={folder ?? ''}
            folder={folder}
            tree={tree}
            activePath={activeFilePath}
            onOpenFile={(p) => void handleOpenLinkedFile(p)}
          />
        )}
        <div className={`panes ${panes.length > 1 ? 'split' : ''}`}>
          {panes.map((id, i) => {
            const tab = tabs.find((t) => t.id === id);
            return (
              <section
                key={i}
                className={`pane ${i === focusedPane ? 'focused' : ''}`}
                onMouseDownCapture={() => {
                  if (focusedRef.current !== i) setPanesNow(panesRef.current, i);
                }}
              >
                {tab ? (
                  <Editor
                    key={tab.id}
                    value={tab.source}
                    filePath={tab.filePath}
                    rawMode={rawMode}
                    theme={theme}
                    onChange={(v) => updateTab(tab.id, { source: v, dirty: true })}
                    onOpenFile={handleOpenLinkedFile}
                  />
                ) : (
                  <div className="pane-empty">
                    Open a file from the sidebar or with ⌘O, or drag a tab here.
                  </div>
                )}
              </section>
            );
          })}
          {draggingTab !== null && (
            // Drop targets for a dragged tab: the left and right halves.
            <div className="drop-zones">
              {[0, 1].map((side) => (
                <div
                  key={side}
                  className={`drop-zone ${dropSide === side ? 'over' : ''}`}
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'move';
                    if (dropSide !== side) setDropSide(side);
                  }}
                  onDragLeave={() => setDropSide((s) => (s === side ? null : s))}
                  onDrop={(e) => {
                    e.preventDefault();
                    const id = Number(e.dataTransfer.getData('application/x-inkfab-tab'));
                    setDraggingTab(null);
                    setDropSide(null);
                    if (id) dropTab(id, side);
                  }}
                />
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
