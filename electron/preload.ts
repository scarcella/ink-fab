import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { contextBridge, ipcRenderer } from 'electron';

const WINDOWS_ABSOLUTE_PATH_RE = /^[A-Za-z]:[\\/]/;
const URL_SCHEME_RE = /^[A-Za-z][A-Za-z\d+\-.]*:/;

function resolveFileTarget(baseFilePath: string, target: string) {
  if (!baseFilePath || !target || target.startsWith('#')) return null;

  const isWindowsAbsolutePath = WINDOWS_ABSOLUTE_PATH_RE.test(target);
  if (!isWindowsAbsolutePath && (URL_SCHEME_RE.test(target) || target.startsWith('//'))) {
    return null;
  }

  const [rawPath, hash = ''] = target.split('#', 2);
  if (!rawPath) return null;

  const filePath = path.isAbsolute(rawPath)
    ? rawPath
    : path.resolve(path.dirname(baseFilePath), rawPath);

  return {
    filePath,
    fileUrl: `${pathToFileURL(filePath).toString()}${hash ? `#${hash}` : ''}`,
  };
}

type FolderEntry = { name: string; path: string; children?: FolderEntry[] };

contextBridge.exposeInMainWorld('inkfab', {
  openFile: () =>
    ipcRenderer.invoke('file:open') as Promise<{ filePath: string; content: string } | null>,
  readFile: (filePath: string) => ipcRenderer.invoke('file:read', filePath) as Promise<string>,
  saveFile: (filePath: string | null, content: string) =>
    ipcRenderer.invoke('file:save', filePath, content) as Promise<string | null>,
  confirmUnsavedChanges: (
    action: 'open' | 'navigate' | 'new' | 'close-tab',
    filePath: string | null
  ) =>
    ipcRenderer.invoke('dialog:confirm-unsaved', action, filePath) as Promise<
      'save' | 'discard' | 'cancel'
    >,
  setDirty: (dirty: boolean) => {
    ipcRenderer.send('editor:set-dirty', dirty);
  },
  setCurrentFile: (filePath: string | null) => {
    ipcRenderer.send('editor:set-current-file', filePath);
  },
  setTheme: (theme: string) => {
    ipcRenderer.send('editor:set-theme', theme);
  },
  onSetTheme: (handler: (theme: 'paper' | 'light' | 'dark') => void) => {
    const fn = (_e: Electron.IpcRendererEvent, theme: 'paper' | 'light' | 'dark') =>
      handler(theme);
    ipcRenderer.on('menu:set-theme', fn);
    return () => ipcRenderer.removeListener('menu:set-theme', fn);
  },
  completeCloseAfterSave: (saved: boolean) => {
    ipcRenderer.send('window:close-after-save', saved);
  },
  openExternal: (url: string) => ipcRenderer.invoke('app:open-external', url) as Promise<void>,
  openPath: (filePath: string) => ipcRenderer.invoke('app:open-path', filePath) as Promise<string>,
  resolveFileTarget,
  pickFolder: () => ipcRenderer.invoke('folder:pick') as Promise<void>,
  listFolder: (dir: string) =>
    ipcRenderer.invoke('folder:list', dir) as Promise<FolderEntry[] | null>,
  closeFolder: () => {
    ipcRenderer.send('folder:close');
  },
  onFolderOpened: (handler: (dir: string) => void) => {
    const fn = (_e: Electron.IpcRendererEvent, dir: string) => handler(dir);
    ipcRenderer.on('folder:opened', fn);
    return () => ipcRenderer.removeListener('folder:opened', fn);
  },
  onFolderChanged: (handler: () => void) => {
    const fn = () => handler();
    ipcRenderer.on('folder:changed', fn);
    return () => ipcRenderer.removeListener('folder:changed', fn);
  },
  onMenu: (
    handler: (
      action:
        | 'new'
        | 'open'
        | 'save'
        | 'save-as'
        | 'close-tab'
        | 'toggle-preview'
        | 'save-and-close'
        | 'toggle-sidebar'
        | 'close-folder'
    ) => void
  ) => {
    const map = {
      'menu:new': 'new',
      'menu:open': 'open',
      'menu:save': 'save',
      'menu:save-as': 'save-as',
      'menu:close-tab': 'close-tab',
      'menu:toggle-preview': 'toggle-preview',
      'menu:save-and-close': 'save-and-close',
      'menu:toggle-sidebar': 'toggle-sidebar',
      'menu:close-folder': 'close-folder',
    } as const;
    const listeners: Array<[string, () => void]> = [];
    for (const [channel, action] of Object.entries(map)) {
      const fn = () => handler(action as any);
      ipcRenderer.on(channel, fn);
      listeners.push([channel, fn]);
    }
    return () => listeners.forEach(([c, f]) => ipcRenderer.removeListener(c, f));
  },
});
