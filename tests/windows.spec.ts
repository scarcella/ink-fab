import { test, expect, _electron as electron, ElectronApplication, Page } from '@playwright/test';
import path from 'node:path';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

// Multiple windows / native folder tabs, and restoring them on relaunch. Each
// test launches its own app against a throwaway session file.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

let tmp: string;
let dirA: string;
let dirB: string;
let sessionFile: string;

const launch = () =>
  electron.launch({
    args: [path.join(repoRoot, 'dist-electron/main.js')],
    cwd: repoRoot,
    env: { ...process.env, INKFAB_TEST: '1', INKFAB_SESSION_FILE: sessionFile },
  });

async function windowPages(app: ElectronApplication, count: number) {
  await expect.poll(() => app.windows().length).toBe(count);
  const pages = app.windows();
  for (const p of pages) await p.locator('.cm-editor').waitFor();
  return pages;
}

const sidebarFolder = (p: Page) => p.locator('.sidebar .sidebar-header').textContent();

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), 'inkfab-windows-'));
  dirA = path.join(tmp, 'alpha');
  dirB = path.join(tmp, 'beta');
  sessionFile = path.join(tmp, 'session.json');
  for (const [dir, file] of [[dirA, 'a.md'], [dirB, 'b.md']]) {
    await mkdir(dir);
    await writeFile(path.join(dir, file), `# ${file}`);
  }
});

test.afterAll(async () => {
  await rm(tmp, { recursive: true, force: true });
});

test('each window or folder tab has its own folder, tree and title', async () => {
  const app = await launch();
  try {
    const [first] = await windowPages(app, 1);
    await app.evaluate(({ BrowserWindow }, d) => {
      BrowserWindow.getAllWindows()[0].webContents.send('folder:opened', d);
    }, dirA);
    await expect(first.locator('.sidebar .sidebar-header')).toHaveText('alpha');

    // What File ▸ New Folder Tab… does once its folder picker resolves.
    await app.evaluate((_e, d) => (globalThis as any).__inkfabTest.createWindow(d, 0), dirB);
    const [, second] = await windowPages(app, 2);
    await expect(second.locator('.sidebar .sidebar-header')).toHaveText('beta');
    await expect(first.locator('.sidebar .sidebar-header')).toHaveText('alpha');

    // Native tabs are labelled by folder.
    const titles = await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().map((w) => w.getTitle())
    );
    expect(titles.sort()).toEqual(['alpha', 'beta']);

    // Each tree follows only its own folder.
    await writeFile(path.join(dirB, 'later.md'), 'new');
    await expect(second.locator('.sidebar-file', { hasText: 'later' })).toBeVisible();
    await expect(first.locator('.sidebar-file', { hasText: 'later' })).toHaveCount(0);

    // Theme is app-wide: switching it in one window switches the others.
    const themeBtn = first.locator('button[title^="Color theme"]');
    const start = await themeBtn.textContent();
    await themeBtn.click();
    const next = await themeBtn.textContent();
    await expect(second.locator('html')).toHaveAttribute('data-theme', next!);
    while ((await themeBtn.textContent()) !== start) await themeBtn.click(); // leave it as found

    // The session records both windows with their folders.
    await expect
      .poll(async () => {
        try {
          return JSON.parse(await readFile(sessionFile, 'utf8')).windows.map((w: any) => w.folder);
        } catch {
          return null;
        }
      })
      .toEqual([dirA, dirB]);
  } finally {
    await app.close();
  }
});

test('relaunching restores every window with its folder', async () => {
  const app = await launch();
  try {
    const pages = await windowPages(app, 2);
    for (const p of pages) await p.locator('.sidebar .sidebar-header').waitFor();
    const folders = await Promise.all(pages.map(sidebarFolder));
    expect(folders.sort()).toEqual(['alpha', 'beta']);
  } finally {
    await app.close();
  }
});
