import { useCallback, useEffect, useRef, useState } from 'react';
import Editor from './Editor';
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
  const [activeId, setActiveId] = useState(initialTab.id);
  const [rawMode, setRawMode] = useState(false);

  const tabsRef = useRef(tabs);
  const activeIdRef = useRef(activeId);
  tabsRef.current = tabs;
  activeIdRef.current = activeId;

  const active = tabs.find((t) => t.id === activeId) ?? tabs[0];

  // Ref is updated eagerly so sequential async flows (save-all, close) see
  // their own writes before React re-renders.
  const setTabsNow = useCallback((next: TabState[]) => {
    tabsRef.current = next;
    setTabs(next);
  }, []);

  const updateTab = useCallback(
    (id: number, patch: Partial<TabState>) => {
      setTabsNow(
        tabsRef.current.map((t) => (t.id === id ? { ...t, ...patch } : t))
      );
    },
    [setTabsNow]
  );

  useEffect(() => {
    window.inkfab.setDirty(tabs.some((t) => t.dirty));
  }, [tabs]);

  useEffect(() => {
    window.inkfab.setCurrentFile(active.filePath);
  }, [active.filePath]);

  const onEditorChange = useCallback(
    (v: string) => {
      updateTab(activeIdRef.current, { source: v, dirty: true });
    },
    [updateTab]
  );

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
    (forceDialog = false) => saveTab(activeIdRef.current, forceDialog),
    [saveTab]
  );

  const handleNew = useCallback(() => {
    const tab = makeTab();
    setTabsNow([...tabsRef.current, tab]);
    setActiveId(tab.id);
  }, [setTabsNow]);

  const openInTab = useCallback(
    (filePath: string, content: string) => {
      const existing = tabsRef.current.find((t) => t.filePath === filePath);
      if (existing) {
        setActiveId(existing.id);
        return;
      }
      const cleaned = applyOpenTransforms(content, filePath, plugins);
      const tab = makeTab({ filePath, source: cleaned, dirty: cleaned !== content });
      setTabsNow([...tabsRef.current, tab]);
      setActiveId(tab.id);
    },
    [setTabsNow]
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
        setActiveId(existing.id);
        return;
      }
      const content = await window.inkfab.readFile(nextFilePath);
      openInTab(nextFilePath, content);
    },
    [openInTab]
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
      if (activeIdRef.current === id) {
        setActiveId(next[Math.min(Math.max(idx, 0), next.length - 1)].id);
      }
    },
    [saveTab, setTabsNow]
  );

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
      else if (action === 'close-tab') void closeTab(activeIdRef.current);
      else if (action === 'save-and-close') void saveAllAndClose();
      else if (action === 'toggle-preview') setRawMode((v) => !v);
    });
  }, [handleNew, handleOpen, handleSave, closeTab, saveAllAndClose]);

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
                className={`tab ${t.id === activeId ? 'active' : ''}`}
                onClick={() => setActiveId(t.id)}
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
            className={`mode-btn ${rawMode ? 'active' : ''}`}
            onClick={() => setRawMode((v) => !v)}
            title="Toggle raw source (⌘/)"
          >
            {rawMode ? 'live' : 'raw'}
          </button>
        </div>
      </header>
      <main className="workspace">
        <Editor
          key={active.id}
          value={active.source}
          filePath={active.filePath}
          rawMode={rawMode}
          onChange={onEditorChange}
          onOpenFile={handleOpenLinkedFile}
        />
      </main>
    </div>
  );
}
