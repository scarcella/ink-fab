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
  if (page && !page.isClosed()) {
    await page.evaluate(() => window.inkfab.setDirty(false));
  }
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

test('click places the cursor on the clicked line', async () => {
  // Headings carry large vertical spacing; if that spacing is implemented as
  // margin, CodeMirror's height map ignores it and clicks map to a line below
  // the one under the pointer.
  await page.locator('.cm-content').click();
  await page.keyboard.press('Meta+A');
  await page.keyboard.type(
    '# Section One\n\nalpha bravo charlie\ndelta echo foxtrot\ngolf hotel india\n\n## Section Two\n\nnovember oscar papa'
  );

  const target = page.locator('.cm-line', { hasText: 'delta echo foxtrot' });
  await target.click();
  await page.keyboard.type('ZULU');
  await expect(target).toContainText('ZULU');
});

test('arrow keys move the cursor one line at a time', async () => {
  // Vertical motion uses the same geometry as click mapping; with margin-based
  // spacing it jumped whole regions instead of single lines.
  await page.locator('.cm-content').click();
  await page.keyboard.press('Meta+A');
  await page.keyboard.type('# Title\n\none one\ntwo two\nthree three\nfour four');

  await page.locator('.cm-line', { hasText: 'one one' }).click();
  await page.keyboard.press('Meta+ArrowLeft');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.type('MID');
  await expect(page.locator('.cm-line', { hasText: 'three three' })).toContainText('MID');
});

test('arrow up crosses a heading line by line', async () => {
  await page.locator('.cm-content').click();
  await page.keyboard.press('Meta+A');
  await page.keyboard.type('# Title\n\none one\ntwo two');

  await page.locator('.cm-line', { hasText: 'one one' }).click();
  await page.keyboard.press('Meta+ArrowLeft');
  await page.keyboard.press('ArrowUp'); // blank line
  await page.keyboard.press('ArrowUp'); // heading line
  await page.keyboard.type('TOP');
  // The exact column depends on whether the hidden `# ` marks were revealed
  // at the moment of the move; what matters is the marker landed on the
  // heading line, one line per keypress.
  await expect(page.locator('.cm-line', { hasText: 'Title' })).toContainText('TOP');
  await expect(page.locator('.cm-line', { hasText: 'one one' })).not.toContainText('TOP');
});

test('loading a document leaves the editor unfocused (no stray caret)', async () => {
  await page.locator('.cm-content').click();
  await expect(page.locator('.cm-editor.cm-focused')).toBeVisible();

  // Trigger File > New through the menu IPC so DOM focus isn't disturbed by
  // clicking a button; the unsaved-changes prompt auto-discards under test.
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.webContents.send('menu:new');
  });

  await expect(page.locator('.cm-editor.cm-focused')).toHaveCount(0);
});

test('raw toggle switches view mode', async () => {
  await page.locator('.cm-content').click();
  await page.keyboard.press('Meta+A');
  await page.keyboard.type('| A | B |\n| --- | --- |\n| one | two |\n\noutside');
  await expect(page.locator('.cm-table-block table').first()).toBeVisible();

  const rawBtn = page.locator('button[title^="Toggle raw source"]');
  await rawBtn.click();
  await expect(page.locator('.app.raw')).toBeVisible();
  await expect(page.locator('.cm-table-block table')).toHaveCount(0);
  await expect(page.locator('.cm-content')).toContainText('| A | B |');

  await rawBtn.click();
  await expect(page.locator('.app.raw')).toHaveCount(0);
  await expect(page.locator('.cm-table-block table').first()).toBeVisible();
});

test('plus button opens a new tab and switches to it', async () => {
  const tabCountBefore = await page.locator('.tab').count();
  await page.locator('.tab-add').click();
  await expect(page.locator('.tab')).toHaveCount(tabCountBefore + 1);
  // The new tab is active and empty — the previous tab's table is gone.
  await expect(page.locator('.cm-content')).not.toContainText('| A | B |');

  await page.locator('.cm-content').click();
  await page.keyboard.type('tab three content');
  await expect(page.locator('.cm-content')).toContainText('tab three content');
});

test('switching tabs swaps documents', async () => {
  const tabs = page.locator('.tab');
  await tabs.nth(0).click();
  await expect(page.locator('.cm-content')).toContainText('one one');
  await tabs.last().click();
  await expect(page.locator('.cm-content')).toContainText('tab three content');
});

test('closing the active tab activates a neighbor', async () => {
  const tabCountBefore = await page.locator('.tab').count();
  // Dirty tab close prompts; the prompt auto-discards under INKFAB_TEST.
  await page.locator('.tab').last().locator('.tab-close').click();
  await expect(page.locator('.tab')).toHaveCount(tabCountBefore - 1);
  await expect(page.locator('.cm-content')).toContainText('outside');
});

test('closing the last tab leaves a fresh empty document', async () => {
  await page.locator('.tab.active .tab-close').click();
  await expect(page.locator('.tab')).toHaveCount(1);
  await expect(page.locator('.cm-content')).toContainText('one one');

  await page.locator('.tab .tab-close').click();
  await expect(page.locator('.tab')).toHaveCount(1);
  await expect(page.locator('.tab .title')).toHaveText('Untitled');
  await expect(page.locator('.cm-content')).not.toContainText('one one');
});

test('theme button cycles paper → light → dark and restyles the app', async () => {
  const themeBtn = page.locator('button[title^="Color theme"]');
  await expect(themeBtn).toHaveText('paper');

  const bgOf = () =>
    page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  const paperBg = await bgOf();

  await themeBtn.click();
  await expect(themeBtn).toHaveText('light');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  expect(await bgOf()).toBe('rgb(255, 255, 255)');

  await themeBtn.click();
  await expect(themeBtn).toHaveText('dark');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  expect(await bgOf()).toBe('rgb(25, 24, 23)');

  // The choice is persisted, and one more click wraps back to paper.
  expect(await page.evaluate(() => localStorage.getItem('inkfab:theme'))).toBe('dark');
  await themeBtn.click();
  await expect(themeBtn).toHaveText('paper');
  expect(await bgOf()).toBe(paperBg);
});

test('bullet markers render as real bullets, cycling with depth', async () => {
  await page.locator('.cm-content').click();
  await page.keyboard.press('Meta+A');
  // Enter auto-continues the "- " marker, Tab indents into a nested list.
  await page.keyboard.type('- one\n');
  await page.keyboard.type('two\n');
  await page.keyboard.press('Tab');
  await page.keyboard.type('three');

  // Caret sits at the end of "three" — off every marker — so all render.
  const bullets = page.locator('.cm-list-bullet');
  await expect(bullets).toHaveCount(3);
  await expect(bullets.nth(0)).toHaveText('•');
  await expect(bullets.nth(2)).toHaveText('◦');

  // Item text is full-ink (t.list must not mute it) and each nesting level
  // indents further via line padding.
  const { colors, pads } = await page.evaluate(() => {
    const find = (t: string) =>
      [...document.querySelectorAll('.cm-line')].find((l) =>
        l.textContent?.includes(t)
      ) as HTMLElement;
    const mutedSpan = (t: string) =>
      [...find(t).querySelectorAll('span:not(.cm-list-bullet)')].some(
        (s) => getComputedStyle(s).color !== getComputedStyle(find(t)).color
      );
    return {
      colors: [mutedSpan('one'), mutedSpan('two'), mutedSpan('three')],
      pads: ['one', 'two', 'three'].map((t) =>
        parseFloat(getComputedStyle(find(t)).paddingLeft)
      ),
    };
  });
  expect(colors).toEqual([false, false, false]);
  // "one" and "two" are siblings; "three" is nested one level deeper.
  expect(pads[0]).toBeGreaterThan(0);
  expect(pads[1]).toBe(pads[0]);
  expect(pads[2]).toBeGreaterThan(pads[1]);
});

test('task items show only the checkbox, no dash', async () => {
  await page.locator('.cm-content').click();
  await page.keyboard.press('Meta+A');
  // The double Enter clears the auto-continued "- [ ] " marker line.
  await page.keyboard.type('- [ ] todo\n\nafter');

  await expect(page.locator('.cm-task-box')).toHaveCount(1);
  await expect(page.locator('.cm-line', { hasText: 'todo' })).toHaveText('todo');
});
