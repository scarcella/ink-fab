import { app, BrowserWindow, ipcMain, dialog, Menu, nativeImage, shell } from 'electron';
import { readFile, writeFile } from 'node:fs/promises';
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

let mainWindow: BrowserWindow | null = null;
let isDocumentDirty = false;
let currentFilePath: string | null = null;
let allowWindowClose = false;
let isClosePromptOpen = false;

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

async function promptToSaveChanges(action: UnsavedAction, filePath: string | null) {
  if (!mainWindow) return 'cancel' as const;
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

  const result = await dialog.showMessageBox(mainWindow, {
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

function createWindow() {
  const iconPath = path.join(__dirname, '../build/icon.png');
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#faf8f3',
    icon: nativeImage.createFromPath(iconPath),
    show: !IS_TEST,
    x: IS_TEST ? -4000 : undefined,
    y: IS_TEST ? -4000 : undefined,
    skipTaskbar: IS_TEST,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  if (process.platform === 'darwin' && !IS_TEST) {
    try {
      app.dock?.setIcon(iconPath);
    } catch {}
  }

  if (VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  mainWindow.on('close', async (event) => {
    if (allowWindowClose) {
      allowWindowClose = false;
      return;
    }

    if (!isDocumentDirty) return;

    event.preventDefault();
    if (isClosePromptOpen) return;

    isClosePromptOpen = true;
    try {
      const choice = await promptToSaveChanges('close', currentFilePath);
      if (choice === 'save') {
        mainWindow?.webContents.send('menu:save-and-close');
        return;
      }

      if (choice === 'discard' && mainWindow) {
        isDocumentDirty = false;
        mainWindow.setDocumentEdited(false);
        allowWindowClose = true;
        mainWindow.close();
      }
    } finally {
      isClosePromptOpen = false;
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isSafeExternalUrl(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (isAppUrl(url)) return;
    event.preventDefault();
    if (isSafeExternalUrl(url)) void shell.openExternal(url);
  });
}

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
  async (_e, action: Exclude<UnsavedAction, 'close'>, filePath: string | null) =>
    promptToSaveChanges(action, filePath)
);

ipcMain.handle('app:open-external', async (_e, url: string) => {
  await shell.openExternal(url);
});

ipcMain.handle('app:open-path', async (_e, targetPath: string) => shell.openPath(targetPath));

ipcMain.on('editor:set-dirty', (_e, dirty: boolean) => {
  isDocumentDirty = dirty;
  mainWindow?.setDocumentEdited(dirty);
});

ipcMain.on('editor:set-current-file', (_e, filePath: string | null) => {
  currentFilePath = filePath;
  mainWindow?.setRepresentedFilename(filePath ?? '');
});

ipcMain.on('window:close-after-save', (_e, saved: boolean) => {
  if (!saved || !mainWindow) return;
  isDocumentDirty = false;
  mainWindow.setDocumentEdited(false);
  allowWindowClose = true;
  mainWindow.close();
});

// Mirrors the renderer's persisted theme so the View ▸ Theme radios stay
// checked correctly; the renderer is the source of truth.
let currentTheme = 'paper';

ipcMain.on('editor:set-theme', (_e, theme: string) => {
  if (theme === currentTheme) return;
  currentTheme = theme;
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
          click: () => mainWindow?.webContents.send('menu:new'),
        },
        {
          label: 'Open…',
          accelerator: 'CmdOrCtrl+O',
          click: () => mainWindow?.webContents.send('menu:open'),
        },
        {
          label: 'Save',
          accelerator: 'CmdOrCtrl+S',
          click: () => mainWindow?.webContents.send('menu:save'),
        },
        {
          label: 'Save As…',
          accelerator: 'Shift+CmdOrCtrl+S',
          click: () => mainWindow?.webContents.send('menu:save-as'),
        },
        { type: 'separator' },
        {
          label: 'Close Tab',
          accelerator: 'CmdOrCtrl+W',
          click: () => mainWindow?.webContents.send('menu:close-tab'),
        },
        { role: 'close', label: 'Close Window', accelerator: 'Shift+CmdOrCtrl+W' },
      ],
    },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        {
          label: 'Toggle Preview',
          accelerator: 'CmdOrCtrl+/',
          click: () => mainWindow?.webContents.send('menu:toggle-preview'),
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
            click: () => mainWindow?.webContents.send('menu:set-theme', theme),
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

app.whenReady().then(() => {
  createWindow();
  buildMenu();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
