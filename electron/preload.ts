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

contextBridge.exposeInMainWorld('inkfab', {
  openFile: () =>
    ipcRenderer.invoke('file:open') as Promise<{ filePath: string; content: string } | null>,
  readFile: (filePath: string) => ipcRenderer.invoke('file:read', filePath) as Promise<string>,
  saveFile: (filePath: string | null, content: string) =>
    ipcRenderer.invoke('file:save', filePath, content) as Promise<string | null>,
  confirmUnsavedChanges: (
    action: 'open' | 'navigate' | 'new',
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
  completeCloseAfterSave: (saved: boolean) => {
    ipcRenderer.send('window:close-after-save', saved);
  },
  openExternal: (url: string) => ipcRenderer.invoke('app:open-external', url) as Promise<void>,
  openPath: (filePath: string) => ipcRenderer.invoke('app:open-path', filePath) as Promise<string>,
  resolveFileTarget,
  onMenu: (
    handler: (
      action: 'new' | 'open' | 'save' | 'save-as' | 'toggle-preview' | 'save-and-close'
    ) => void
  ) => {
    const map = {
      'menu:new': 'new',
      'menu:open': 'open',
      'menu:save': 'save',
      'menu:save-as': 'save-as',
      'menu:toggle-preview': 'toggle-preview',
      'menu:save-and-close': 'save-and-close',
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
