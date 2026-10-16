import { useEffect, useState } from 'react';
import type { FolderEntry } from './global';

type Props = {
  folder: string | null;
  tree: FolderEntry[];
  activePath: string | null;
  onOpenFile: (filePath: string) => void;
};

const baseName = (p: string) => p.split(/[\\/]/).filter(Boolean).pop() ?? p;
const stripExt = (name: string) => name.replace(/\.(md|markdown|mdown)$/i, '');

// Folder paths on the way down to `target`, so the active file can be revealed.
function ancestorsOf(entries: FolderEntry[], target: string): string[] | null {
  for (const e of entries) {
    if (e.path === target) return [];
    if (e.children) {
      const below = ancestorsOf(e.children, target);
      if (below) return [e.path, ...below];
    }
  }
  return null;
}

export default function Sidebar({ folder, tree, activePath, onOpenFile }: Props) {
  // Folders start collapsed; the set holds the ones the user has expanded.
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    const dirs = activePath ? ancestorsOf(tree, activePath) : null;
    if (!dirs?.length) return;
    setExpanded((prev) => (dirs.every((d) => prev.has(d)) ? prev : new Set([...prev, ...dirs])));
  }, [tree, activePath]);

  const toggle = (dir: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(dir)) next.delete(dir);
      else next.add(dir);
      return next;
    });

  if (!folder) {
    return (
      <aside className="sidebar">
        <div className="sidebar-empty">
          <p>No folder open.</p>
          <button className="sidebar-open" onClick={() => void window.inkfab.pickFolder()}>
            Open Folder…
          </button>
          <span className="sidebar-hint">⇧⌘O</span>
        </div>
      </aside>
    );
  }

  const renderEntries = (entries: FolderEntry[], depth: number) =>
    entries.map((entry) => {
      const indent = { paddingLeft: 12 + depth * 14 };
      if (entry.children) {
        const open = expanded.has(entry.path);
        return (
          <div key={entry.path} role="treeitem" aria-expanded={open}>
            <button
              className="sidebar-row sidebar-dir"
              style={indent}
              title={entry.path}
              onClick={() => toggle(entry.path)}
            >
              <span className={`sidebar-caret ${open ? 'open' : ''}`} aria-hidden>
                ›
              </span>
              <span className="sidebar-name">{entry.name}</span>
            </button>
            {open && <div role="group">{renderEntries(entry.children, depth + 1)}</div>}
          </div>
        );
      }
      return (
        <button
          key={entry.path}
          role="treeitem"
          className={`sidebar-row sidebar-file ${entry.path === activePath ? 'active' : ''}`}
          style={indent}
          title={entry.path}
          onClick={() => onOpenFile(entry.path)}
        >
          <span className="sidebar-name">{stripExt(entry.name)}</span>
        </button>
      );
    });

  return (
    <aside className="sidebar">
      <div className="sidebar-header" title={folder}>
        {baseName(folder)}
      </div>
      <div className="sidebar-tree" role="tree">
        {tree.length ? (
          renderEntries(tree, 0)
        ) : (
          <p className="sidebar-none">No markdown files here.</p>
        )}
      </div>
    </aside>
  );
}
