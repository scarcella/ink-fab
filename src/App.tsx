import { useCallback, useEffect, useRef, useState } from 'react';
import Editor from './Editor';
import logoUrl from '../assets/icon-source.png';
import { hasOpenAICitations, stripOpenAICitations } from './openaiCitations';

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

export default function App() {
  const [source, setSource] = useState(WELCOME);
  const [filePath, setFilePath] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [rawMode, setRawMode] = useState(false);
  const sourceRef = useRef(source);
  const filePathRef = useRef(filePath);
  const dirtyRef = useRef(dirty);
  sourceRef.current = source;
  filePathRef.current = filePath;
  dirtyRef.current = dirty;

  const syncDirty = useCallback((nextDirty: boolean) => {
    dirtyRef.current = nextDirty;
    setDirty(nextDirty);
    window.inkfab.setDirty(nextDirty);
  }, []);

  const syncFilePath = useCallback((nextFilePath: string | null) => {
    filePathRef.current = nextFilePath;
    setFilePath(nextFilePath);
    window.inkfab.setCurrentFile(nextFilePath);
  }, []);

  const openDocument = useCallback(
    (nextFilePath: string, content: string) => {
      const hadCitations = hasOpenAICitations(content);
      const cleaned = hadCitations ? stripOpenAICitations(content) : content;
      sourceRef.current = cleaned;
      setSource(cleaned);
      syncFilePath(nextFilePath);
      // Mark dirty if we cleaned anything — user's next save writes clean markdown.
      syncDirty(hadCitations);
    },
    [syncDirty, syncFilePath]
  );

  const onEditorChange = useCallback((v: string) => {
    sourceRef.current = v;
    setSource(v);
    if (!dirtyRef.current) {
      syncDirty(true);
    }
  }, [syncDirty]);

  const handleSave = useCallback(
    async (forceDialog = false) => {
      const target = forceDialog ? null : filePathRef.current;
      const saved = await window.inkfab.saveFile(target, sourceRef.current);
      if (!saved) return false;
      syncFilePath(saved);
      syncDirty(false);
      return true;
    },
    [syncDirty, syncFilePath]
  );

  const maybeSaveBeforeTransition = useCallback(
    async (action: 'open' | 'navigate') => {
      if (!dirtyRef.current) return true;

      const choice = await window.inkfab.confirmUnsavedChanges(action, filePathRef.current);
      if (choice === 'cancel') return false;
      if (choice === 'save') return handleSave(false);
      return true;
    },
    [handleSave]
  );

  const handleOpen = useCallback(async () => {
    if (!(await maybeSaveBeforeTransition('open'))) return;
    const res = await window.inkfab.openFile();
    if (!res) return;
    openDocument(res.filePath, res.content);
  }, [maybeSaveBeforeTransition, openDocument]);

  const handleOpenLinkedFile = useCallback(
    async (nextFilePath: string) => {
      if (!(await maybeSaveBeforeTransition('navigate'))) return;
      const content = await window.inkfab.readFile(nextFilePath);
      openDocument(nextFilePath, content);
    },
    [maybeSaveBeforeTransition, openDocument]
  );

  useEffect(() => {
    window.inkfab.setDirty(false);
    window.inkfab.setCurrentFile(null);
  }, []);

  useEffect(() => {
    return window.inkfab.onMenu((action) => {
      if (action === 'open') void handleOpen();
      else if (action === 'save') void handleSave(false);
      else if (action === 'save-as') void handleSave(true);
      else if (action === 'save-and-close') {
        void handleSave(false).then((saved) => window.inkfab.completeCloseAfterSave(saved));
      }
      else if (action === 'toggle-preview') setRawMode((v) => !v);
    });
  }, [handleOpen, handleSave]);

  const fileName = filePath ? filePath.split(/[\\/]/).pop() : 'Untitled';

  return (
    <div className={`app ${rawMode ? 'raw' : ''}`}>
      <header className="titlebar">
        <div className="titlebar-drag" />
        <div className="titlebar-left">
          <img src={logoUrl} alt="InkFab" className="logo" draggable={false} />
        </div>
        <div className="titlebar-center">
          <span className="title">{fileName}</span>
          {dirty && <span className="dot" title="Unsaved" />}
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
          value={source}
          filePath={filePath}
          onChange={onEditorChange}
          onOpenFile={handleOpenLinkedFile}
        />
      </main>
    </div>
  );
}
