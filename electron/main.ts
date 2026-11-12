import { app, BrowserWindow, ipcMain, dialog, Menu, nativeImage, shell } from 'electron';
import type { IpcMainEvent, IpcMainInvokeEvent, Rectangle } from 'electron';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { readFileSync, watch, writeFileSync, type FSWatcher } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL;
const APP_INDEX_URL = pathToFileURL(path.join(__dirname, '../dist/index.html')).toString();
const IS_TEST = process.env.INKFAB_TEST === '1';

app.setName('InkFab');

if (IS_TEST && process.platform === 'darwin') {
  // Run as a background agent so no dock icon appears, the window never activates,
  // and focus is never stolen from whatever the user is working on.
  app.setActivationPolicy('accessory');
}

// Windows ------------------------------------------------------------------
// Every window is independent: its own folder, document tabs and dirty state.
// On macOS they share a tabbing identifier, so windows can live as native tabs
// of one another ("New Folder Tab", the tab bar's +, Window ▸ Merge All
// Windows) or be dragged out into windows of their own.

type WinState = {
  dirty: boolean;
  filePath: string | null;
  folder: string | null;
  /** False for the first window of a launch with no saved session: the
   * renderer then falls back to the folder it remembers itself. */
  fromSession: boolean;
  allowClose: boolean;
  promptOpen: boolean;
  watcher: FSWatcher | null;
  watchTimer: ReturnType<typeof setTimeout> | null;
};

const windows = new Map<BrowserWindow, WinState>(); // in creation order
let lastFocused: BrowserWindow | null = null;
let quitting = false;

const stateOf = (win: BrowserWindow) => windows.get(win);
const senderWindow = (e: IpcMainEvent | IpcMainInvokeEvent) => BrowserWindow.fromWebContents(e.sender);

/** The window menu commands act on. */
function targetWindow(): BrowserWindow | null {
  const focused = BrowserWindow.getFocusedWindow();
  if (focused && windows.has(focused)) return focused;
  if (lastFocused && !lastFocused.isDestroyed()) return lastFocused;
  return windows.keys().next().value ?? null;
}

const sendToTarget = (channel: string, ...args: unknown[]) =>
  targetWindow()?.webContents.send(channel, ...args);

// The tab/window title: the folder's name, else the document's.
function updateTitle(win: BrowserWindow) {
  const s = stateOf(win);
  if (!s) return;
  const name = s.folder ? path.basename(s.folder) : s.filePath ? path.basename(s.filePath) : 'InkFab';
  win.setTitle(name);
}

type UnsavedAction = 'open' | 'navigate' | 'close' | 'new' | 'close-tab';

function isAppUrl(url: string): boolean {
  if (VITE_DEV_SERVER_URL) return url.startsWith(VITE_DEV_SERVER_URL);
  return url === APP_INDEX_URL || url.startsWith(`${APP_INDEX_URL}#`);
}

function isSafeExternalUrl(url: string): boolean {
  try {
    const { protocol } = new URL(url);
    return protocol === 'http:' || protocol === 'https:' || protocol === 'mailto:';
  } catch {
    return false;
  }
}

async function promptToSaveChanges(
  win: BrowserWindow | null,
  action: UnsavedAction,
  filePath: string | null
) {
  if (!win) return 'cancel' as const;
  // Native dialogs would hang the Playwright suite; tests always discard.
  if (IS_TEST) return 'discard' as const;

  const fileName = filePath ? path.basename(filePath) : 'Untitled';
  const detailVerbs: Record<Exclude<UnsavedAction, 'close'>, string> = {
    open: 'open another file',
    navigate: 'follow this link',
    new: 'start a new document',
    'close-tab': 'close this tab',
  };
  const detail =
    action === 'close'
      ? `Save the changes you made to "${fileName}" before closing?`
      : `Your changes to "${fileName}" will be lost if you ${detailVerbs[action]}.`;

  const result = await dialog.showMessageBox(win, {
    type: 'warning',
    buttons: ['Save', 'Cancel', "Don't Save"],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
    normalizeAccessKeys: true,
    message: 'You have unsaved changes.',
    detail,
  });

  if (result.response === 0) return 'save' as const;
  if (result.response === 2) return 'discard' as const;
  return 'cancel' as const;
}

type WindowOptions = {
  folder?: string | null;
  bounds?: Rectangle;
  /** Open as a native tab of this window (macOS). */
  tabOf?: BrowserWindow;
  fromSession?: boolean;
};

function createWindow({ folder = null, bounds, tabOf, fromSession = true }: WindowOptions = {}) {
  const iconPath = path.join(__dirname, '../build/icon.png');
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    ...(bounds ?? {}),
    titleBarStyle: 'hiddenInset',
    tabbingIdentifier: 'inkfab',
    backgroundColor: '#faf8f3',
    icon: nativeImage.createFromPath(iconPath),
    show: !IS_TEST,
    ...(IS_TEST ? { x: -4000, y: -4000 } : {}),
    skipTaskbar: IS_TEST,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  windows.set(win, {
    dirty: false,
    filePath: null,
    folder,
    fromSession,
    allowClose: false,
    promptOpen: false,
    watcher: null,
    watchTimer: null,
  });
  if (tabOf && !tabOf.isDestroyed() && process.platform === 'darwin') tabOf.addTabbedWindow(win);
  updateTitle(win);

  if (process.platform === 'darwin' && !IS_TEST) {
    try {
      app.dock?.setIcon(iconPath);
    } catch {}
  }

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL);
  } else {
    win.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  // We title windows ourselves (see updateTitle); ignore the page's <title>.
  win.on('page-title-updated', (e) => e.preventDefault());
  win.on('focus', () => (lastFocused = win));
  win.on('moved', saveSessionSoon);
  win.on('resized', saveSessionSoon);
  // The native tab bar's + button.
  win.on('new-window-for-tab', () => void newFolderTab(win));

  win.on('close', async (event) => {
    const s = stateOf(win);
    if (!s) return;
    if (s.allowClose) {
      s.allowClose = false;
      return;
    }

    if (!s.dirty) return;

    event.preventDefault();
    if (s.promptOpen) return;

    s.promptOpen = true;
    try {
      const choice = await promptToSaveChanges(win, 'close', s.filePath);
      if (choice === 'save') {
        win.webContents.send('menu:save-and-close');
        return;
      }

      if (choice === 'discard') {
        s.dirty = false;
        win.setDocumentEdited(false);
        s.allowClose = true;
        win.close();
      } else {
        quitting = false; // a cancelled close also cancels any quit in progress
      }
    } finally {
      s.promptOpen = false;
    }
  });

  win.on('closed', () => {
    stateOf(win)?.watcher?.close();
    windows.delete(win);
    if (lastFocused === win) lastFocused = null;
    saveSession();
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isSafeExternalUrl(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });

  win.webContents.on('will-navigate', (event, url) => {
    if (isAppUrl(url)) return;
    event.preventDefault();
    if (isSafeExternalUrl(url)) void shell.openExternal(url);
  });

  saveSessionSoon();
  return win;
}

async function chooseFolder(parent: BrowserWindow | null) {
  const options: Electron.OpenDialogOptions = { properties: ['openDirectory', 'createDirectory'] };
  const result = parent ? await dialog.showOpenDialog(parent, options) : await dialog.showOpenDialog(options);
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
}

// A new native tab showing a folder, asked for up front: a tab exists to hold
// a folder, so cancelling the picker opens nothing.
async function newFolderTab(parent: BrowserWindow | null) {
  const dir = await chooseFolder(parent);
  if (!dir) return;
  createWindow({ folder: dir, tabOf: parent ?? undefined });
}

// Session --------------------------------------------------------------------
// The open windows (folder, position, which ones share a tab group) are saved
// so a relaunch brings them back. Tabs of one group always share a frame, so
// identical bounds are how a group is recognised. Tests opt in with
// INKFAB_SESSION_FILE; otherwise they never read or write a session.

type SavedWindow = { folder: string | null; bounds: Rectangle; group: number };

const sessionFile = () =>
  process.env.INKFAB_SESSION_FILE || (IS_TEST ? null : path.join(app.getPath('userData'), 'session.json'));

function saveSession() {
  // Quitting closes every window; the snapshot taken in before-quit stands,
  // so those windows come back next launch.
  const file = sessionFile();
  if (!file || quitting) return;
  const groups = new Map<string, number>();
  const saved: SavedWindow[] = [];
  for (const [win, s] of windows) {
    if (win.isDestroyed()) continue;
    const bounds = win.getBounds();
    const key = `${bounds.x},${bounds.y},${bounds.width},${bounds.height}`;
    if (!groups.has(key)) groups.set(key, groups.size);
    saved.push({ folder: s.folder, bounds, group: groups.get(key)! });
  }
  try {
    writeFileSync(file, JSON.stringify({ windows: saved }, null, 2));
  } catch {
    // Unwritable userData: windows just won't be restored.
  }
}

let sessionTimer: ReturnType<typeof setTimeout> | null = null;
function saveSessionSoon() {
  if (sessionTimer) clearTimeout(sessionTimer);
  sessionTimer = setTimeout(saveSession, 300);
}

function restoreSession(): boolean {
  const file = sessionFile();
  if (!file) return false;
  let saved: SavedWindow[];
  try {
    saved = JSON.parse(readFileSync(file, 'utf8')).windows;
  } catch {
    return false;
  }
  if (!Array.isArray(saved) || saved.length === 0) return false;
  const firstOfGroup = new Map<number, BrowserWindow>();
  for (const w of saved) {
    const head = firstOfGroup.get(w.group);
    if (head) createWindow({ folder: w.folder, tabOf: head });
    else firstOfGroup.set(w.group, createWindow({ folder: w.folder, bounds: IS_TEST ? undefined : w.bounds }));
  }
  return true;
}

// Files ------------------------------------------------------------------------

ipcMain.handle('file:open', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: [{ name: 'Markdown', extensions: ['md', 'markdown', 'mdown', 'txt'] }],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  const filePath = result.filePaths[0];
  const content = await readFile(filePath, 'utf-8');
  return { filePath, content };
});

ipcMain.handle('file:read', async (_e, filePath: string) => {
  return readFile(filePath, 'utf-8');
});

ipcMain.handle('file:save', async (_e, filePath: string | null, content: string) => {
  let target = filePath;
  if (!target) {
    const result = await dialog.showSaveDialog({
      filters: [{ name: 'Markdown', extensions: ['md'] }],
      defaultPath: 'untitled.md',
    });
    if (result.canceled || !result.filePath) return null;
    target = result.filePath;
  }
  await writeFile(target, content, 'utf-8');
  return target;
});

ipcMain.handle(
  'dialog:confirm-unsaved',
  async (e, action: Exclude<UnsavedAction, 'close'>, filePath: string | null) =>
    promptToSaveChanges(senderWindow(e), action, filePath)
);

ipcMain.handle('app:open-external', async (_e, url: string) => {
  await shell.openExternal(url);
});

ipcMain.handle('app:open-path', async (_e, targetPath: string) => shell.openPath(targetPath));

ipcMain.on('editor:set-dirty', (e, dirty: boolean) => {
  const win = senderWindow(e);
  const s = win && stateOf(win);
  if (!win || !s) return;
  s.dirty = dirty;
  win.setDocumentEdited(dirty);
});

ipcMain.on('editor:set-current-file', (e, filePath: string | null) => {
  const win = senderWindow(e);
  const s = win && stateOf(win);
  if (!win || !s) return;
  s.filePath = filePath;
  win.setRepresentedFilename(filePath ?? '');
  updateTitle(win);
});

ipcMain.on('window:close-after-save', (e, saved: boolean) => {
  const win = senderWindow(e);
  const s = win && stateOf(win);
  if (!saved || !win || !s) return;
  s.dirty = false;
  win.setDocumentEdited(false);
  s.allowClose = true;
  win.close();
});

// The folder a window starts with, read once by its preload.
ipcMain.on('window:initial-folder', (e) => {
  const win = senderWindow(e);
  const s = win && stateOf(win);
  e.returnValue = { folder: s?.folder ?? null, fromSession: s?.fromSession ?? false };
});

// Folder sidebar ----------------------------------------------------------
// The renderer owns which folder its window shows; main lists that folder's
// markdown files, watches it so the tree stays live, and remembers it for the
// session.

type FolderEntry = { name: string; path: string; children?: FolderEntry[] };

const MARKDOWN_FILE_RE = /\.(md|markdown|mdown|txt)$/i;
const SKIPPED_DIRS = new Set(['node_modules']);
const MAX_FOLDER_FILES = 5000;

// Markdown files only, dot-entries and node_modules skipped, folders that
// contain no markdown pruned. Folders sort before files, both by name.
async function listMarkdownTree(dir: string, budget = { files: MAX_FOLDER_FILES }) {
  const dirents = await readdir(dir, { withFileTypes: true }).catch(() => []);
  dirents.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  const folders: FolderEntry[] = [];
  const files: FolderEntry[] = [];
  for (const d of dirents) {
    if (budget.files <= 0) break;
    if (d.name.startsWith('.')) continue;
    const full = path.join(dir, d.name);
    if (d.isDirectory()) {
      if (SKIPPED_DIRS.has(d.name)) continue;
      const children = await listMarkdownTree(full, budget);
      if (children.length) folders.push({ name: d.name, path: full, children });
    } else if (d.isFile() && MARKDOWN_FILE_RE.test(d.name)) {
      budget.files--;
      files.push({ name: d.name, path: full });
    }
  }
  return [...folders, ...files];
}

function watchFolder(win: BrowserWindow, s: WinState, dir: string | null) {
  s.watcher?.close();
  s.watcher = null;
  if (s.folder !== dir) {
    s.folder = dir;
    if (!win.isDestroyed()) updateTitle(win);
    saveSessionSoon();
  }
  if (!dir) return;
  try {
    s.watcher = watch(dir, { recursive: true }, () => {
      // Saves and git checkouts arrive as bursts of events; coalesce them.
      if (s.watchTimer) clearTimeout(s.watchTimer);
      s.watchTimer = setTimeout(() => {
        if (!win.isDestroyed()) win.webContents.send('folder:changed');
      }, 200);
    });
    s.watcher.on('error', () => s.watcher?.close());
  } catch {
    // Unwatchable (permissions, network volume): the tree just won't auto-refresh.
  }
}

async function pickFolder(win: BrowserWindow | null) {
  const dir = await chooseFolder(win);
  if (!dir) return;
  (win ?? createWindow()).webContents.send('folder:opened', dir);
}

ipcMain.handle('folder:pick', (e) => pickFolder(senderWindow(e)));

// Returns null when the folder is gone, so the renderer can forget it.
ipcMain.handle('folder:list', async (e, dir: string) => {
  const win = senderWindow(e);
  const s = win && stateOf(win);
  try {
    await readdir(dir);
  } catch {
    if (win && s) watchFolder(win, s, null);
    return null;
  }
  if (win && s && (s.folder !== dir || !s.watcher)) watchFolder(win, s, dir);
  return listMarkdownTree(dir);
});

ipcMain.on('folder:close', (e) => {
  const win = senderWindow(e);
  const s = win && stateOf(win);
  if (win && s) watchFolder(win, s, null);
});

// Theme is app-wide: a change in one window is passed on to the others.
// Main mirrors it so the View ▸ Theme radios stay checked correctly; the
// renderer is the source of truth.
let currentTheme = 'paper';

ipcMain.on('editor:set-theme', (e, theme: string) => {
  if (theme === currentTheme) return;
  currentTheme = theme;
  for (const win of windows.keys()) {
    if (win.webContents !== e.sender) win.webContents.send('menu:set-theme', theme);
  }
  buildMenu();
});

function buildMenu() {
  const template: Electron.MenuItemConstructorOptions[] = [
    { role: 'appMenu' },
    {
      label: 'File',
      submenu: [
        {
          label: 'New',
          accelerator: 'CmdOrCtrl+N',
          click: () => sendToTarget('menu:new'),
        },
        {
          id: 'new-folder-tab',
          label: 'New Folder Tab…',
          accelerator: 'CmdOrCtrl+T',
          click: () => void newFolderTab(targetWindow()),
        },
        {
          id: 'new-window',
          label: 'New Window',
          accelerator: 'Shift+CmdOrCtrl+N',
          click: () => createWindow(),
        },
        { type: 'separator' },
        {
          label: 'Open…',
          accelerator: 'CmdOrCtrl+O',
          click: () => sendToTarget('menu:open'),
        },
        {
          label: 'Open Folder…',
          accelerator: 'Shift+CmdOrCtrl+O',
          click: () => void pickFolder(targetWindow()),
        },
        {
          label: 'Close Folder',
          click: () => sendToTarget('menu:close-folder'),
        },
        { type: 'separator' },
        {
          label: 'Save',
          accelerator: 'CmdOrCtrl+S',
          click: () => sendToTarget('menu:save'),
        },
        {
          label: 'Save As…',
          accelerator: 'Shift+CmdOrCtrl+S',
          click: () => sendToTarget('menu:save-as'),
        },
        { type: 'separator' },
        {
          label: 'Close Tab',
          accelerator: 'CmdOrCtrl+W',
          click: () => sendToTarget('menu:close-tab'),
        },
        { role: 'close', label: 'Close Window', accelerator: 'Shift+CmdOrCtrl+W' },
      ],
    },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        {
          label: 'Toggle Sidebar',
          accelerator: 'CmdOrCtrl+\\',
          click: () => sendToTarget('menu:toggle-sidebar'),
        },
        {
          label: 'Toggle Preview',
          accelerator: 'CmdOrCtrl+/',
          click: () => sendToTarget('menu:toggle-preview'),
        },
        {
          label: 'Theme',
          submenu: (
            [
              ['paper', 'Paper'],
              ['light', 'Light'],
              ['dark', 'Dark'],
            ] as const
          ).map(([theme, label]) => ({
            label,
            type: 'radio' as const,
            checked: currentTheme === theme,
            click: () => sendToTarget('menu:set-theme', theme),
          })),
        },
        { type: 'separator' },
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { role: 'togglefullscreen' },
      ],
    },
    { role: 'windowMenu' },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

if (IS_TEST) {
  // Lets the suite open windows and folder tabs without native dialogs.
  (globalThis as any).__inkfabTest = {
    createWindow: (folder: string | null = null, tabOfIndex?: number) =>
      createWindow({
        folder,
        tabOf: tabOfIndex === undefined ? undefined : [...windows.keys()][tabOfIndex],
      }),
  };
}

app.on('before-quit', () => {
  saveSession();
  quitting = true;
});

app.whenReady().then(() => {
  if (!restoreSession()) createWindow({ fromSession: false });
  buildMenu();
  app.on('activate', () => {
    if (windows.size === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
