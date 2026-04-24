import { test, expect, _electron as electron, ElectronApplication, Page } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

let app: ElectronApplication;
let page: Page;

test.beforeAll(async () => {
  app = await electron.launch({
    args: [path.join(repoRoot, 'dist-electron/main.js')],
    cwd: repoRoot,
    env: { ...process.env, INKFAB_TEST: '1' },
  });
  page = await app.firstWindow();
  page.on('console', (msg) => console.log(`[renderer:${msg.type()}]`, msg.text()));
  page.on('pageerror', (err) => console.log('[renderer:error]', err.message));
  await page.waitForLoadState('domcontentloaded');
  await page.locator('.cm-editor').waitFor({ state: 'visible', timeout: 15_000 });
});

test.afterAll(async () => {
  await app?.close();
});

test('window opens with titlebar + editor', async () => {
  await expect(page.locator('.titlebar .title')).toHaveText('Untitled');
  await expect(page.locator('.cm-editor')).toBeVisible();
});

test('logo renders in the titlebar', async () => {
  const logo = page.locator('.titlebar .logo');
  await expect(logo).toBeVisible();
  const box = await logo.boundingBox();
  expect(box?.width).toBeGreaterThan(0);
  expect(box?.height).toBeGreaterThan(0);
});

test('welcome doc renders heading live (H1 styled, # hidden when unfocused)', async () => {
  const h1Line = page.locator('.cm-line.cm-h1').first();
  await expect(h1Line).toBeVisible();
  await expect(h1Line).toContainText('InkFab');
  // Editor is not focused on initial load — `#` should be hidden.
  const text = await h1Line.innerText();
  expect(text.trimStart().startsWith('#')).toBe(false);
});

test('focusing the H1 reveals the # mark', async () => {
  const h1Line = page.locator('.cm-line.cm-h1').first();
  await page.locator('.cm-content').click();
  await page.keyboard.press('Meta+ArrowUp');
  await page.keyboard.press('Meta+ArrowUp');
  await expect(h1Line).toContainText('#');
});

test('inline math renders as KaTeX widget', async () => {
  const inlineMath = page.locator('.cm-math-inline .katex').first();
  await expect(inlineMath).toBeVisible();
});

test('block math renders as KaTeX display widget', async () => {
  const blockMath = page.locator('.cm-math-block .katex-display, .cm-math-block .katex').first();
  await expect(blockMath).toBeVisible();
});

test('GFM table renders with code-span pipes intact', async () => {
  // The welcome doc contains `| Table | \`| a | b |\` | Yes |` — three cells,
  // with the pipes inside the code span preserved.
  const table = page.locator('.cm-table-block table').first();
  await expect(table).toBeVisible();

  const headers = table.locator('thead th');
  await expect(headers).toHaveText(['Feature', 'Syntax', 'Renders live']);

  const firstDataRow = table.locator('tbody tr').first();
  await expect(firstDataRow.locator('td')).toHaveCount(3);
  await expect(firstDataRow.locator('td').nth(0)).toHaveText('Table');
  await expect(firstDataRow.locator('td').nth(1).locator('code')).toHaveText('| a | b |');
  await expect(firstDataRow.locator('td').nth(2)).toHaveText('Yes');
});

test('headings get anchor ids from their slug', async () => {
  const h2 = page.locator('.cm-line.cm-h2#what-you-can-write');
  await expect(h2).toBeVisible();
});

test('[[toc]] renders a table of contents with anchor links', async () => {
  const toc = page.locator('.cm-toc-block');
  await expect(toc).toBeVisible();
  const links = toc.locator('a');
  expect(await links.count()).toBeGreaterThan(2);
  await expect(links.first()).toHaveAttribute('href', /^#/);
});

test('fenced code block gets highlight.js tokens', async () => {
  await page.locator('.cm-scroller').evaluate((el) => el.scrollTo({ top: el.scrollHeight }));
  const codeBlock = page.locator('.cm-code-block').first();
  await expect(codeBlock).toBeVisible();
  // highlight.js emits <span class="hljs-..."> nodes for tokens.
  await expect(codeBlock.locator('.hljs-keyword, .hljs-title, .hljs-function, .hljs-string').first()).toBeVisible();
});

test('mermaid fenced block renders as an SVG diagram', async () => {
  await page.locator('.cm-scroller').evaluate((el) => el.scrollTo({ top: el.scrollHeight }));
  const svg = page.locator('.cm-mermaid-block svg').first();
  await expect(svg).toBeVisible({ timeout: 10_000 });
});

test('horizontal rule line is styled', async () => {
  // CodeMirror's scroll parent is .cm-scroller — scroll it to bring the HR into the viewport.
  await page.locator('.cm-scroller').evaluate((el) => el.scrollTo({ top: el.scrollHeight }));
  const hr = page.locator('.cm-hr-line').first();
  await expect(hr).toBeVisible();
});

test('typing updates the document and marks dirty', async () => {
  // Select-all + delete to clear, then type a heading.
  await page.locator('.cm-content').click();
  await page.keyboard.press('Meta+A');
  await page.keyboard.press('Backspace');
  await page.keyboard.type('# Hello Playwright');

  // Move caret away so live rendering hides the `#`.
  await page.keyboard.press('Enter');
  await page.keyboard.type('body paragraph');

  const h1Line = page.locator('.cm-line.cm-h1').first();
  await expect(h1Line).toContainText('Hello Playwright');

  // Dirty dot appears.
  await expect(page.locator('.titlebar .dot')).toBeVisible();
});

test('raw toggle switches view mode', async () => {
  const rawBtn = page.locator('.mode-btn');
  await rawBtn.click();
  await expect(page.locator('.app.raw')).toBeVisible();
  await rawBtn.click();
  await expect(page.locator('.app.raw')).toHaveCount(0);
});
