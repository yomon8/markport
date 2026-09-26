import { test, expect } from '@playwright/test';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, mkdir, rename, writeFile, unlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:net';

let directory: string;
let port: number;
let serverProcess: ChildProcess;

async function freePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') return reject(new Error('port unavailable'));
      server.close(() => resolvePort(address.port));
    });
  });
}

async function startServer(): Promise<void> {
  serverProcess = spawn(resolve('../dist/markport'), [directory, '--port', String(port)], { stdio: 'ignore' });
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(`http://127.0.0.1:${port}/api/tree`)).ok) return; } catch { /* Starting. */ }
    await new Promise((done) => setTimeout(done, 50));
  }
  throw new Error('server did not start');
}

async function stopServer(): Promise<void> {
  if (!serverProcess || serverProcess.exitCode !== null || serverProcess.signalCode !== null) return;
  const exited = new Promise((done) => serverProcess.once('exit', done));
  serverProcess.kill('SIGTERM');
  await exited;
}

test.beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'markport-e2e-'));
  port = await freePort();
  await writeFile(join(directory, 'README.md'), '# Demo\n\n[Jump](#section)\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n- [x] done\n\n[Python](sample.py)\n\n![Image](image.svg)\n\n## Section\n\n```mermaid\nflowchart LR\n  A --> B\n```\n');
  await writeFile(join(directory, 'sample.py'), 'print("first")\n');
  await writeFile(join(directory, 'image.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="30"><rect width="40" height="30" fill="blue"/></svg>');
  await writeFile(join(directory, 'image.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/c4sAAAAASUVORK5CYII=', 'base64'));
  await mkdir(join(directory, 'docs'));
  await writeFile(join(directory, 'docs', 'style.css'), 'h1 { color: rgb(10, 20, 30) }');
  await writeFile(join(directory, 'docs', 'first.html'), '<!doctype html><html><head><link rel="stylesheet" href="style.css"><link rel="stylesheet" href="https://cdn.example.test/external.css"></head><body><h1>HTML preview</h1><img src="../image.png"><img src="https://cdn.example.test/external.png"><script>window.previewScriptRan = true</script><a href="second.htm">Next HTML</a></body></html>');
  await writeFile(join(directory, 'docs', 'second.htm'), '<!doctype html><html><body><h1>Second HTML</h1></body></html>');
  await writeFile(join(directory, 'docs', 'transparent.html'), '<!doctype html><html><body style="background:transparent"><h1>Transparent HTML</h1></body></html>');
  await writeFile(join(directory, 'docs', 'colored.html'), '<!doctype html><html><body style="background:#ff8080"><h1>Colored HTML</h1></body></html>');
  await writeFile(join(directory, 'docs', 'interactive.js'), 'document.body.dataset.localScript = "ready";');
  await writeFile(join(directory, 'docs', 'interactive.mjs'), 'document.body.dataset.moduleScript = "ready";');
  await writeFile(join(directory, 'docs', 'interactive.html'), `<!doctype html><html><head></head><body>
    <nav><button type="button" data-mode="all" aria-pressed="true">All</button><button type="button" data-mode="public" aria-pressed="false">Public</button><button type="button" data-mode="internal" aria-pressed="false">Internal</button><button type="button" id="print">Print</button></nav>
    <div data-flow="public internal"></div><div data-flow="internal"></div><a href="second.htm">Next HTML</a>
    <script src="interactive.js"></script><script type="module" src="interactive.mjs"></script><script src="https://cdn.example.test/external.js"></script><script>
      document.body.dataset.parentAccess = String((function(){try{return !!parent.document.body}catch{return false}})());
      fetch('/api/tree').then(() => document.body.dataset.networkAccess = 'allowed', () => document.body.dataset.networkAccess = 'blocked');
      for (const button of document.querySelectorAll('[data-mode]')) button.addEventListener('click', () => {
        for (const item of document.querySelectorAll('[data-mode]')) item.setAttribute('aria-pressed', String(item === button));
        for (const path of document.querySelectorAll('[data-flow]')) path.classList.toggle('dim', button.dataset.mode !== 'all' && !path.dataset.flow.split(' ').includes(button.dataset.mode));
      });
      document.querySelector('#print').addEventListener('click', () => window.print());
    </script></body></html>`);
  await startServer();
});

test.afterAll(async () => {
  await stopServer();
  if (directory) await rm(directory, { recursive: true, force: true });
});

test('shows English controls with a Japanese browser locale', async ({ browser }) => {
  const context = await browser.newContext({ locale: 'ja-JP' });
  try {
    const page = await context.newPage();
    await page.goto(`http://127.0.0.1:${port}/?path=README.md`);
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.getByRole('button', { name: 'Refresh' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Files' })).toBeVisible();
    await expect(page.locator('#file-title').getByRole('button', { name: 'Source' })).toBeVisible();
  } finally {
    await context.close();
  }
});

test('keeps global shortcuts out of Markdown and editable text', async ({ page }) => {
  await page.goto(`http://127.0.0.1:${port}/`);
  await page.getByRole('button', { name: 'Paste Markdown' }).click();
  const editor = page.getByLabel('Markdown Text');
  await editor.click();
  await page.keyboard.type('docs/file.md https://example.test/a');
  await expect(editor).toHaveValue('docs/file.md https://example.test/a');
  await expect(editor).toBeFocused();
  await page.keyboard.press('Control+k');
  await page.keyboard.press('Control+b');
  await expect(editor).toBeFocused();
  const editable = page.locator('#content').evaluate((content) => {
    const node = document.createElement('div'); node.contentEditable = 'true'; node.id = 'shortcut-editable'; content.append(node);
  });
  await editable;
  await page.locator('#shortcut-editable').focus();
  await page.keyboard.type('a/b');
  await expect(page.locator('#shortcut-editable')).toHaveText('a/b');
  await expect(page.locator('#shortcut-editable')).toBeFocused();
  await page.locator('#file-title').click();
  await page.keyboard.press('/');
  await expect(page.getByRole('searchbox', { name: 'Search files' })).toBeFocused();
  await page.locator('#file-title').click();
  await page.keyboard.press('Control+k');
  await expect(page.getByRole('searchbox', { name: 'Search files' })).toBeFocused();
});

test('theme colors follow the selected theme and HTML keeps document colors', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('markport-theme', 'light'));
  await page.goto(`http://127.0.0.1:${port}/?path=README.md`);
  const colors = async () => page.evaluate(() => {
    const css = getComputedStyle(document.documentElement);
    return ['--mark-bg', '--mark-text', '--icon-image', '--icon-code', '--success-bg', '--success-text'].map((name) => css.getPropertyValue(name).trim());
  });
  const light = await colors();
  await page.getByRole('button', { name: 'Theme: Light' }).click();
  await page.getByRole('menuitemradio', { name: 'Dark' }).click();
  const dark = await colors();
  expect(dark.every((value, index) => value !== light[index])).toBe(true);
  for (const name of ['first.html', 'transparent.html', 'colored.html']) {
    await page.goto(`http://127.0.0.1:${port}/?path=docs%2F${name}`);
    const frame = page.frameLocator('.html-preview');
    await expect(frame.locator('h1')).toBeVisible();
    const background = await frame.locator('body').evaluate((body) => getComputedStyle(body).backgroundColor);
    if (name === 'colored.html') expect(background).toBe('rgb(255, 128, 128)');
    else expect(background).toBe('rgba(0, 0, 0, 0)');
    await expect(page.locator('.html-preview')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  }
});

test('header controls stay aligned and theme choices work by keyboard on mobile', async ({ page }, testInfo) => {
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 844 });
    for (const theme of ['light', 'dark']) {
      await page.addInitScript((value) => localStorage.setItem('markport-theme', value), theme);
      await page.goto(`http://127.0.0.1:${port}/?path=README.md`);
      const buttons = width <= 700 ? ['#drawer-toggle', '#header-more', '#reload'] : ['#sidebar-toggle', '#theme-toggle', '#paste-toggle', '#reload'];
      const positions = await page.locator(buttons.join(',')).evaluateAll((elements) => elements.map((element) => {
        const box = element.getBoundingClientRect(); return { top: box.top, height: box.height, right: box.right };
      }));
      expect(new Set(positions.map((position) => position.height)).size, JSON.stringify({ width, theme, positions })).toBe(1);
      expect(new Set(positions.map((position) => position.top)).size).toBe(1);
      expect(Math.max(...positions.map((position) => position.right))).toBeLessThanOrEqual(width);
      await expect(page.locator('#connection')).toHaveAttribute('role', 'status');
      await page.screenshot({ path: testInfo.outputPath(`header-${width}-${theme}.png`) });
    }
  }
  await page.getByRole('button', { name: 'More header actions' }).click();
  await page.getByRole('button', { name: 'Theme: Dark' }).click();
  await expect(page.getByRole('menuitemradio', { name: 'Dark' })).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('Home');
  await expect(page.getByRole('menuitemradio', { name: 'Auto' })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('menuitemradio', { name: 'Light' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.getByRole('button', { name: 'Paste Markdown' }).click();
  await expect(page.locator('#paste-input')).toBeVisible();
});

test('title controls show active views and keep auxiliary actions reachable on mobile', async ({ page }) => {
  await page.goto(`http://127.0.0.1:${port}/?path=README.md`);
  const title = page.locator('#file-title');
  await expect(title.getByRole('button', { name: 'File', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await title.getByRole('button', { name: 'Source' }).click();
  await expect(title.getByRole('button', { name: 'Source' })).toHaveAttribute('aria-pressed', 'true');
  await title.getByRole('button', { name: 'Rendered view' }).click();
  await expect(title.getByRole('button', { name: 'Rendered view' })).toHaveAttribute('aria-pressed', 'true');
  await expect(title.getByRole('button', { name: 'Copy path' })).toHaveAttribute('title', 'Copy path');
  await page.setViewportSize({ width: 390, height: 720 });
  const more = title.getByRole('button', { name: 'More actions' });
  await more.focus(); await page.keyboard.press('Enter');
  await expect(title.getByRole('menuitemradio', { name: 'File' })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(title.getByRole('menuitemradio', { name: 'Diff' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(more).toBeFocused();
  await expect(more).toHaveAttribute('aria-expanded', 'false');
  await more.click();
  await title.getByRole('menuitem', { name: 'Open on right' }).click();
  await expect(page.locator('#right-pane')).toBeVisible();
});

test('mobile title stays one row and keeps reading actions close', async ({ page }, testInfo) => {
  await writeFile(join(directory, 'mobile-title.md'), `# Mobile title\n\n## First\n\n${'Reading line\n\n'.repeat(60)}## Second\n\n## Third\n\n## Fourth\n`);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(`http://127.0.0.1:${port}/?path=mobile-title.md`);
  await expect(page.locator('#content h1')).toHaveText('Mobile title');
  expect((await page.locator('#file-title').boundingBox())!.height).toBeLessThanOrEqual(48);
  await page.screenshot({ path: testInfo.outputPath('mobile-title-390.png') });
  const more = page.locator('#file-title').getByRole('button', { name: 'More actions' });
  await more.click();
  await page.getByRole('menuitemradio', { name: 'Source' }).click();
  await expect(page.locator('#content')).toHaveAttribute('data-kind', 'code');
  await more.click();
  await page.getByRole('menuitemradio', { name: 'Rendered view' }).click();
  await expect(page.locator('#content h1')).toHaveText('Mobile title');
  await more.click();
  await page.getByRole('menuitem', { name: 'Contents' }).click();
  await expect(page.locator('#outline')).toBeVisible();
  await page.locator('#outline a', { hasText: 'Fourth' }).click();
  const heading = (await page.locator('#content h2', { hasText: 'Fourth' }).boundingBox())!;
  const title = (await page.locator('#file-title').boundingBox())!;
  expect(heading.y).toBeGreaterThanOrEqual(title.y + title.height);
  await more.click();
  await page.getByRole('menuitem', { name: 'Copy path' }).click();
  await expect(page.locator('#file-title')).toContainText('mobile-title.md');
  await page.route('**/api/git/changes', (route) => route.fulfill({ json: { available: true, rootId: 'mobile-title-review', changes: [{ path: 'mobile-title.md', status: 'modified', revision: 'one', added: 1, deleted: 1 }] } }));
  await page.route('**/api/git/diff?**', (route) => route.fulfill({ json: { path: 'mobile-title.md', kind: 'text', patch: '@@ -1 +1 @@\n-old\n+new\n' } }));
  await page.goto(`http://127.0.0.1:${port}/?path=mobile-title.md&view=diff`);
  await more.click();
  await expect(page.getByRole('menuitem', { name: 'Review and next (r)' })).toBeVisible();
  await page.getByRole('menuitemradio', { name: 'Mark reviewed: mobile-title.md' }).click();
  await more.click();
  await expect(page.getByRole('menuitemradio', { name: 'Mark unreviewed: mobile-title.md' })).toBeVisible();
});

test('sidebar tabs and resize handle work with keyboard, pointer, and mobile drawer', async ({ page }) => {
  await page.goto(`http://127.0.0.1:${port}/?path=README.md`);
  const files = page.getByRole('tab', { name: 'Files' });
  const changes = page.getByRole('tab', { name: 'Changes' });
  await expect(files).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tabpanel', { name: 'Files' })).toBeVisible();
  await files.focus(); await page.keyboard.press('ArrowRight');
  await expect(changes).toBeFocused();
  await expect(changes).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tabpanel', { name: 'Changes' })).toBeVisible();
  await page.keyboard.press('Home');
  await expect(files).toBeFocused();
  await expect(files).toHaveAttribute('aria-selected', 'true');
  const resize = page.locator('#sidebar-resize');
  const box = (await resize.boundingBox())!;
  expect(box.width).toBe(8);
  expect(await resize.evaluate((element) => getComputedStyle(element, '::before').width)).toBe('1px');
  await resize.focus(); await page.keyboard.press('ArrowRight');
  await expect.poll(() => page.evaluate(() => localStorage.getItem('markport-sidebar-width'))).toBe('290');
  const movedBox = (await resize.boundingBox())!;
  await page.mouse.move(movedBox.x + 2, movedBox.y + 50);
  await page.mouse.down(); await page.mouse.move(340, movedBox.y + 50); await page.mouse.up();
  await expect.poll(() => page.evaluate(() => Number(localStorage.getItem('markport-sidebar-width')))).toBeGreaterThan(320);
  await page.setViewportSize({ width: 390, height: 720 });
  await page.getByRole('button', { name: 'Open file list' }).click();
  await expect(files).toBeVisible();
  await changes.click();
  await expect(changes).toHaveAttribute('aria-selected', 'true');
  await expect(changes).toBeVisible();
  await expect(resize).toBeHidden();
});

test('keeps sidebar controls visible while file and change lists scroll', async ({ page }) => {
  for (const width of [1024, 390]) {
    await page.setViewportSize({ width, height: 500 });
    await page.goto(`http://127.0.0.1:${port}/?path=README.md`);
    if (width < 700) await page.getByRole('button', { name: 'Open file list' }).click();

    const tabs = page.locator('.sidebar-tabs');
    const search = page.locator('#files-panel > form');
    const tabsTop = (await tabs.boundingBox())!.y;
    const searchTop = (await search.boundingBox())!.y;
    await page.locator('#files-list').evaluate((list) => {
      const tree = list.querySelector('#tree')!;
      for (let i = 0; i < 80; i++) tree.appendChild(document.createElement('p')).textContent = `File ${i}`;
      list.scrollTop = list.scrollHeight;
    });
    await expect.poll(() => page.locator('#files-list').evaluate((list) => list.scrollTop)).toBeGreaterThan(0);
    expect((await tabs.boundingBox())!.y).toBe(tabsTop);
    expect((await search.boundingBox())!.y).toBe(searchTop);
    await expect(page.getByRole('searchbox', { name: 'Search files' })).toBeInViewport();

    await page.getByRole('tab', { name: 'Changes' }).click();
    await expect(page.locator('#changes-tree .hint')).toContainText('not a Git repository');
    if (width < 700) await page.getByRole('button', { name: 'Open file list' }).click();
    await page.locator('#changes-tree').evaluate((tree) => {
      for (let i = 0; i < 80; i++) tree.appendChild(document.createElement('p')).textContent = `Change ${i}`;
      tree.scrollTop = tree.scrollHeight;
    });
    await expect.poll(() => page.locator('#changes-tree').evaluate((tree) => tree.scrollTop)).toBeGreaterThan(0);
    expect((await tabs.boundingBox())!.y).toBe(tabsTop);
    await expect(page.getByRole('tab', { name: 'Files' })).toBeInViewport();
  }
});

test('searches text within a folder and opens the matching source line', async ({ page }) => {
  await mkdir(join(directory, 'content-scope'), { recursive: true });
  await writeFile(join(directory, 'content-scope', 'guide.md'), '# Guide\n\nBefore the answer\nThe auth needle is here\nAfter the answer\n');
  await writeFile(join(directory, 'content-scope', 'code.py'), 'print("before")\nprint("auth needle")\nprint("after")\n');
  await writeFile(join(directory, 'outside.md'), 'auth needle outside');
  await page.goto(`http://127.0.0.1:${port}/?path=README.md`);
  const contentSearch = page.locator('#content-search');
  const toggle = contentSearch.locator('summary');
  await expect(contentSearch).not.toHaveAttribute('open', '');
  await expect(page.locator('#content-query')).toBeHidden();
  await toggle.click();
  await expect(page.locator('#content-query')).toBeVisible();
  await page.locator('#content-query').fill('auth needle');
  await page.locator('#content-folder').fill('content-scope');
  await contentSearch.getByRole('button', { name: 'Search' }).click();
  await expect(page.locator('.content-search-status')).toContainText('2 matches');
  await expect(page.locator('.content-search-results a')).toHaveCount(2);
  await expect(page.locator('.content-search-results')).not.toContainText('outside.md');
  await expect(page.locator('.content-search-results a', { hasText: 'code.py' })).toContainText('print("before")');
  await toggle.click();
  await expect(page.locator('.content-search-results')).toBeHidden();
  await toggle.click();
  await expect(page.locator('#content-query')).toHaveValue('auth needle');
  await expect(page.locator('.content-search-results a')).toHaveCount(2);
  await page.locator('.content-search-results a', { hasText: 'code.py' }).click();
  await expect(page).toHaveURL(/path=content-scope%2Fcode\.py#L2$/);
  await expect(page.locator('#L2')).toBeVisible();
  await expect(page.locator('#content .line.selected-code-line')).toHaveCount(1);
  const titleBox = (await page.locator('#file-title').boundingBox())!;
  expect((await page.locator('#L2').boundingBox())!.y).toBeGreaterThanOrEqual(titleBox.y + titleBox.height);
  await page.locator('.content-search-results a', { hasText: 'guide.md' }).click();
  await expect(page).toHaveURL(/path=content-scope%2Fguide\.md&source=1#L4$/);
  await expect(page.locator('#file-title').getByRole('button', { name: 'Rendered view' })).toBeVisible();
  await expect(page.locator('#L4')).toBeVisible();
  await expect(page.locator('#content .line.selected-code-line')).toHaveCount(1);
  await page.locator('#content-folder').fill('missing-folder');
  await contentSearch.getByRole('button', { name: 'Search' }).click();
  await expect(page.locator('.content-search-status')).toHaveText('Folder not found.');
});

test('shows partial content results and cancels an active search', async ({ page }) => {
  await writeFile(join(directory, 'content-limit.md'), 'needle\n'.repeat(101));
  await page.goto(`http://127.0.0.1:${port}/?path=README.md`);
  await page.locator('#content-search summary').click();
  await page.locator('#content-query').fill('needle');
  await page.locator('#content-search').getByRole('button', { name: 'Search' }).click();
  await expect(page.locator('.content-search-status')).toContainText('Partial results: match limit reached.');
  await expect(page.locator('.content-search-results a')).toHaveCount(100);
  await page.route('**/api/content-search?**', async (route) => {
    await new Promise((done) => setTimeout(done, 1000));
    await route.abort();
  });
  await page.locator('#content-search').getByRole('button', { name: 'Search' }).click();
  await expect(page.locator('.content-search-status')).toHaveText('Searching…');
  await page.locator('#content-search').getByRole('button', { name: 'Cancel' }).click();
  await expect(page.locator('.content-search-status')).toHaveText('Search canceled.');
  await page.waitForTimeout(1100);
  await expect(page.locator('.content-search-status')).toHaveText('Search canceled.');
});

test('previews pasted Markdown and restores it after reloading the tab', async ({ page }) => {
  await page.goto(`http://127.0.0.1:${port}/?path=README.md`);
  await page.getByRole('button', { name: 'Paste Markdown' }).click();
  await page.getByLabel('Markdown Text').fill('# Pasted\n\n[Local](sample.py) [Jump](#pasted)');
  await expect(page.locator('.paste-preview')).toBeHidden();
  await page.getByRole('button', { name: 'Rendered view' }).click();
  await expect(page.locator('.paste-preview h1')).toHaveText('Pasted');
  await expect(page.getByLabel('Markdown Text')).toBeHidden();
  await expect(page.locator('.paste-preview a', { hasText: 'Local' })).toHaveCount(0);
  await expect(page.locator('.paste-preview a', { hasText: 'Jump' })).toHaveAttribute('href', '#pasted');
  await page.getByRole('button', { name: 'Markdown Text' }).click();
  await expect(page.getByLabel('Markdown Text')).toBeVisible();
  await expect(page.locator('.paste-preview')).toBeHidden();
  await page.getByRole('button', { name: 'Rendered view' }).click();
  await expect(page.locator('.paste-preview h1')).toHaveText('Pasted');
  await page.reload();
  await expect(page.getByLabel('Markdown Text')).toHaveValue('# Pasted\n\n[Local](sample.py) [Jump](#pasted)');
  await expect(page.locator('.paste-preview')).toBeHidden();
  await page.getByRole('button', { name: 'Clear' }).click();
  await expect(page.getByLabel('Markdown Text')).toBeEmpty();
  await expect(page.locator('.paste-preview h1')).toHaveCount(0);
});

test('keeps an unchanged page still during automatic refresh', async ({ page }) => {
  await page.goto(`http://127.0.0.1:${port}/?path=sample.py`);
  await expect(page.locator('article .lntd:last-child pre')).toContainText('first');
  await page.evaluate(() => {
    (window as Window & { originalContent?: Element | null }).originalContent = document.querySelector('article .code-frame');
  });
  await page.waitForTimeout(3500);
  expect(await page.evaluate(() => (window as Window & { originalContent?: Element | null }).originalContent === document.querySelector('article .code-frame'))).toBe(true);
  await expect(page.locator('#reload')).toBeEnabled();
  await expect(page.locator('#progress')).toBeHidden();
  await expect(page.locator('#content')).toHaveAttribute('aria-busy', 'false');
});

test('opens and refreshes two independently scrolling files', async ({ page }) => {
  await writeFile(join(directory, 'split-left.md'), `# Left\n${'Left line\n\n'.repeat(150)}`);
  await writeFile(join(directory, 'split-right.md'), `# Right\n${'Right line\n\n'.repeat(150)}`);
  await page.setViewportSize({ width: 1440, height: 800 });
  await page.goto(`http://127.0.0.1:${port}/?path=split-left.md`);
  await expect(page.locator('#content h1')).toHaveText('Left');
  await page.locator('#main').evaluate((pane) => { pane.scrollTop = 350; });
  const leftScroll = await page.locator('#main').evaluate((pane) => pane.scrollTop);
  await page.getByRole('button', { name: 'Open split-right.md on right' }).click();
  await expect(page.locator('#right-content h1')).toHaveText('Right');
  expect(await page.locator('#main').evaluate((pane) => pane.scrollTop)).toBe(leftScroll);
  await page.locator('#right-pane').evaluate((pane) => { pane.scrollTop = 480; });
  expect(await page.locator('#right-pane').evaluate((pane) => pane.scrollTop)).toBeGreaterThan(0);
  expect(await page.locator('#main').evaluate((pane) => pane.scrollTop)).toBe(leftScroll);
  await writeFile(join(directory, 'split-left.md'), `# Left updated\n${'Left line\n\n'.repeat(150)}`);
  await writeFile(join(directory, 'split-right.md'), `# Right updated\n${'Right line\n\n'.repeat(150)}`);
  await expect(page.locator('#content h1')).toHaveText('Left updated', { timeout: 15000 });
  await expect(page.locator('#right-content h1')).toHaveText('Right updated', { timeout: 15000 });
  expect(await page.locator('#main').evaluate((pane) => pane.scrollTop)).toBe(leftScroll);
  expect(await page.locator('#right-pane').evaluate((pane) => pane.scrollTop)).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Close split view' }).click();
  await expect(page.locator('#right-pane')).toBeHidden();
  await expect(page.locator('#content h1')).toHaveText('Left updated');
});

test('split pane titles, controls, and navigation keep file context', async ({ page }, testInfo) => {
  await mkdir(join(directory, 'docs'), { recursive: true });
  await writeFile(join(directory, 'docs', 'split-left.md'), `# Left\n\n## First\n\n## Second\n\n${'Left line\n\n'.repeat(100)}`);
  await writeFile(join(directory, 'docs', 'split-right.md'), `# Right\n\n## First\n\n## Second\n\n${'Right line\n\n'.repeat(100)}`);
  for (const width of [1280, 1400, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`http://127.0.0.1:${port}/?path=docs%2Fsplit-left.md&right=docs%2Fsplit-right.md`);
    await expect(page.locator('#right-content h1')).toHaveText('Right');
    await expect(page.locator('#file-title .breadcrumbs strong')).toHaveText('split-left.md');
    await expect(page.locator('#right-path strong')).toHaveText('split-right.md');
    for (const selector of ['#file-title .breadcrumbs strong', '#right-path strong']) {
      const visible = await page.locator(selector).evaluate((element) => {
        const box = element.getBoundingClientRect(); const pane = element.closest('#main, #right-pane')!.getBoundingClientRect();
        return box.left >= pane.left && box.right <= pane.right && box.width > 0;
      });
      expect(visible, `${selector} at ${width}px`).toBe(true);
    }
    expect(await page.locator('.content-layout').evaluate((element) => getComputedStyle(element).display)).toBe('block');
    await page.screenshot({ path: testInfo.outputPath(`split-${width}.png`) });
  }
  await expect(page.locator('#right-rendered')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#right-source').click();
  await expect(page.locator('#right-source')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#right-rendered').click();
  await page.locator('#right-contents').click();
  await expect(page.locator('#right-outline')).toBeVisible();
  await page.locator('#right-pane').evaluate((pane) => { pane.scrollTop = 350; });
  await page.locator('#main').evaluate((pane) => { pane.scrollTop = 250; });
  await page.getByRole('button', { name: 'Swap panes' }).click();
  await expect(page.locator('#content h1')).toHaveText('Right');
  await expect(page.locator('#right-content h1')).toHaveText('Left');
  expect(new URL(page.url()).searchParams.get('path')).toBe('docs/split-right.md');
  expect(new URL(page.url()).searchParams.get('right')).toBe('docs/split-left.md');
  expect(await page.locator('#main').evaluate((pane) => pane.scrollTop)).toBeGreaterThan(0);
  expect(await page.locator('#right-pane').evaluate((pane) => pane.scrollTop)).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Show this file only' }).click();
  await expect(page.locator('#right-pane')).toBeHidden();
  await expect(page.locator('#content h1')).toHaveText('Left');
  expect(new URL(page.url()).searchParams.get('right')).toBeNull();
});

test('scrolls long code and table lines inside narrow panes', async ({ page }) => {
  const longLine = `value = '${'x'.repeat(200)}END'`;
  await writeFile(join(directory, 'long-lines.md'), `# Long lines\n\n\`\`\`python\n${longLine}\n\`\`\`\n\n| Column |\n|---|\n| ${longLine} |\n`);
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto(`http://127.0.0.1:${port}/?path=long-lines.md`);
  await expect(page.locator('#content .code-frame>.chroma')).toContainText('END');
  const scrollToEnd = async (selector: string): Promise<void> => {
    const dimensions = await page.locator(selector).evaluate((element) => {
      element.scrollLeft = element.scrollWidth;
      return { width: element.clientWidth, content: element.scrollWidth, offset: element.scrollLeft };
    });
    expect(dimensions.content).toBeGreaterThan(dimensions.width);
    expect(dimensions.offset).toBeGreaterThan(0);
  };
  await scrollToEnd('#content .code-frame>.chroma');
  await scrollToEnd('#content .table-wrap');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);

  await page.setViewportSize({ width: 900, height: 800 });
  await page.getByRole('button', { name: 'Open long-lines.md on right' }).click();
  await expect(page.locator('#right-content .code-frame>.chroma')).toContainText('END');
  await scrollToEnd('#right-content .code-frame>.chroma');
  await scrollToEnd('#right-content .table-wrap');
});

test('keeps the HTML preview sandbox in the right pane and works on a narrow screen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto(`http://127.0.0.1:${port}/?path=README.md`);
  await page.getByRole('button', { name: 'Open file list' }).click();
  await page.locator('details[data-path="docs"] > summary').click();
  await page.getByRole('button', { name: 'Open docs/first.html on right' }).click();
  const frame = page.locator('#right-content .html-preview');
  await expect(frame).toHaveAttribute('sandbox', 'allow-same-origin');
  await expect(page.frameLocator('#right-content .html-preview').locator('h1')).toHaveText('HTML preview');
  expect(await page.frameLocator('#right-content .html-preview').locator('body').evaluate((body) => (body.ownerDocument.defaultView as Window & { previewScriptRan?: boolean }).previewScriptRan)).toBeUndefined();
  await expect(page.locator('#main')).toBeVisible();
  await expect(page.locator('#right-pane')).toBeVisible();
  const scrollable = await page.locator('#right-pane').evaluate((pane) => getComputedStyle(pane).overflowY);
  expect(scrollable).toBe('auto');
  await page.frameLocator('#right-content .html-preview').getByRole('link', { name: 'Next HTML' }).click();
  await expect(page.locator('#right-path')).toHaveAttribute('title', 'docs/second.htm');
  await expect(page.locator('#content h1')).toHaveText('Demo');
  await page.locator('#right-source').click();
  await expect(page.locator('#right-content .lntd:last-child pre')).toContainText('Second HTML');
  await page.getByRole('button', { name: 'Close split view' }).click();
  await expect(page.locator('#right-pane')).toBeHidden();
});

test('desktop sidebar toggle keeps the content full width', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`http://127.0.0.1:${port}/?path=README.md`);
  const sidebar = page.locator('#sidebar');
  const main = page.locator('#main');
  await expect(sidebar).toBeVisible();

  await page.getByRole('button', { name: 'Collapse sidebar' }).click();
  await expect(sidebar).toBeHidden();
  await expect(page.locator('#sidebar-resize')).toBeHidden();
  await expect.poll(async () => (await main.boundingBox())?.width).toBe(1280);
  await expect.poll(async () => (await main.boundingBox())?.x).toBe(0);

  await page.getByRole('button', { name: 'Expand sidebar' }).click();
  await expect(sidebar).toBeVisible();
  await expect(page.locator('#sidebar-resize')).toBeVisible();
  await expect.poll(async () => (await main.boundingBox())?.width).toBeLessThan(1280);
});

test('directory breadcrumbs reveal the folder in the sidebar', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`http://127.0.0.1:${port}/?path=docs%2Ffirst.html`);
  await expect(page.locator('#content .html-preview')).toBeVisible();
  const url = page.url();
  await page.getByRole('button', { name: 'Collapse sidebar' }).click();
  await page.locator('.crumb', { hasText: 'docs' }).click();
  await expect(page.locator('#sidebar')).toBeVisible();
  await expect(page.locator('details[data-path="docs"]')).toHaveAttribute('open');
  await expect(page.locator('details[data-path="docs"] > summary')).toBeFocused();
  expect(page.url()).toBe(url);

  await page.setViewportSize({ width: 390, height: 800 });
  await page.locator('#file-title').getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: 'Show parent folder' }).click();
  await expect(page.locator('#sidebar')).toHaveClass(/open/);
  await expect(page.locator('details[data-path="docs"] > summary')).toBeFocused();
  expect(page.url()).toBe(url);
});

test('uses the outline column only when the outline is visible', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const columns = async (): Promise<number> => page.locator('.content-layout').evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(' ').length);
  await page.goto(`http://127.0.0.1:${port}/?path=README.md`);
  await expect(page.locator('#outline')).toBeHidden();
  expect(await columns()).toBe(1);
  await page.goto(`http://127.0.0.1:${port}/?path=sample.py`);
  await expect(page.locator('article[data-kind="code"]')).toBeVisible();
  expect(await columns()).toBe(1);
  await writeFile(join(directory, 'outline-layout.md'), '# First\n\n## Second\n\n### Third\n');
  await page.goto(`http://127.0.0.1:${port}/?path=outline-layout.md`);
  await expect(page.locator('#outline a')).toHaveCount(3);
  expect(await columns()).toBe(2);
});

test('previews HTML with CSS and images, blocks scripts, and follows local links', async ({ page }) => {
  await page.route('https://cdn.example.test/external.css', (route) => route.fulfill({ contentType: 'text/css', body: 'h1 { background: rgb(40, 50, 60) }' }));
  await page.route('https://cdn.example.test/external.png', (route) => route.fulfill({ contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/c4sAAAAASUVORK5CYII=', 'base64') }));
  await page.goto(`http://127.0.0.1:${port}/?path=docs%2Ffirst.html`);
  const frame = page.frameLocator('.html-preview');
  await expect(frame.locator('h1')).toHaveText('HTML preview');
  await expect(frame.locator('h1')).toHaveCSS('color', 'rgb(10, 20, 30)');
  await expect(frame.locator('h1')).toHaveCSS('background-color', 'rgb(40, 50, 60)');
  for (const image of await frame.locator('img').all()) await expect.poll(() => image.evaluate((element: HTMLImageElement) => element.naturalWidth)).toBeGreaterThan(0);
  expect(await frame.locator('body').evaluate((body) => (body.ownerDocument.defaultView as Window & { previewScriptRan?: boolean }).previewScriptRan)).toBeUndefined();
  await page.locator('#file-title .view-segment').getByRole('button', { name: 'Source' }).click();
  await expect(page.locator('article .lntd:last-child pre')).toContainText('HTML preview');
  await page.locator('#file-title .view-segment').getByRole('button', { name: 'Preview' }).click();
  await frame.locator('a', { hasText: 'Next HTML' }).click();
  await expect(page).toHaveURL(/path=docs%2Fsecond\.htm/);
  await expect(page.frameLocator('.html-preview').locator('h1')).toHaveText('Second HTML');
  await writeFile(join(directory, 'docs', 'second.htm'), '<!doctype html><html><body><h1>Updated HTML</h1></body></html>');
  await expect(page.frameLocator('.html-preview').locator('h1')).toHaveText('Updated HTML', { timeout: 15000 });
});

test('enables interactive HTML per file and keeps it isolated', async ({ page }) => {
  await page.goto(`http://127.0.0.1:${port}/?path=docs%2Finteractive.html`);
  const frame = page.frameLocator('#content .html-preview');
  const toggle = page.locator('#file-title .interactive-toggle');
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await expect(frame.locator('body')).not.toHaveAttribute('data-local-script', 'ready');
  await toggle.click();
  await expect(toggle).toHaveText('Disable JavaScript');
  await expect(page.locator('#content .html-preview')).toHaveAttribute('sandbox', 'allow-scripts allow-modals');
  await expect(frame.locator('body')).toHaveAttribute('data-local-script', 'ready');
  await expect(frame.locator('body')).toHaveAttribute('data-module-script', 'ready');
  await expect(frame.locator('body')).toHaveAttribute('data-parent-access', 'false');
  await expect(frame.locator('body')).toHaveAttribute('data-network-access', 'blocked');
  await expect(frame.locator('body')).not.toHaveAttribute('data-external-script', 'ready');
  expect(await page.locator('#content .html-preview').evaluate((element: HTMLIFrameElement) => element.contentDocument)).toBeNull();
  await frame.getByRole('button', { name: 'Public' }).click();
  await expect(frame.getByRole('button', { name: 'Public' })).toHaveAttribute('aria-pressed', 'true');
  await expect(frame.locator('[data-flow="internal"]')).toHaveClass('dim');
  await frame.locator('body').evaluate((body) => { body.ownerDocument.defaultView!.addEventListener('beforeprint', () => { body.dataset.printCalled = 'true'; }); });
  await frame.getByRole('button', { name: 'Print' }).click();
  await expect(frame.locator('body')).toHaveAttribute('data-print-called', 'true');
  await page.reload();
  await expect(frame.locator('body')).toHaveAttribute('data-local-script', 'ready');
  await frame.getByRole('link', { name: 'Next HTML' }).click();
  await expect(page).toHaveURL(/path=docs%2Fsecond\.htm/);
  await expect(page.locator('#file-title .interactive-toggle')).toHaveAttribute('aria-pressed', 'false');
  await page.goto(`http://127.0.0.1:${port}/?path=docs%2Finteractive.html`);
  await expect(frame.locator('body')).toHaveAttribute('data-local-script', 'ready');
  await page.locator('#file-title .interactive-toggle').click();
  await expect(frame.locator('body')).not.toHaveAttribute('data-local-script', 'ready');
});

test('enables interactive HTML in the right pane', async ({ page }) => {
  await page.goto(`http://127.0.0.1:${port}/?path=README.md&right=docs%2Finteractive.html`);
  const frame = page.frameLocator('#right-content .html-preview');
  await expect(frame.locator('body')).not.toHaveAttribute('data-local-script', 'ready');
  await page.locator('#right-interactive').click();
  await expect(frame.locator('body')).toHaveAttribute('data-local-script', 'ready');
  await frame.getByRole('link', { name: 'Next HTML' }).click();
  await expect(page.locator('#right-path')).toHaveAttribute('title', 'docs/second.htm');
  await expect(page.locator('#right-interactive')).toHaveAttribute('aria-pressed', 'false');
});

test('renders GFM, Mermaid and code, then tracks files', async ({ page }) => {
  const externalRequests: string[] = [];
  page.on('request', (request) => { const url = new URL(request.url()); if ((url.protocol === 'http:' || url.protocol === 'https:') && url.origin !== `http://127.0.0.1:${port}`) externalRequests.push(request.url()); });
  await page.goto(`http://127.0.0.1:${port}/?path=README.md`);
  await expect(page.locator('article h1')).toHaveText('Demo');
  await expect(page.locator('article table')).toContainText('1');
  await expect(page.locator('article input[type=checkbox]')).toBeChecked();
  await expect(page.locator('.mermaid-source svg')).toBeVisible({ timeout: 15000 });
  await page.locator('article a', { hasText: 'Jump' }).click();
  await expect(page).toHaveURL(/#section$/);
  await expect(page.locator('article h2#section')).toHaveText('Section');
  await expect(page.locator('article img')).toHaveJSProperty('complete', true);
  expect(await page.locator('article img').evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);
  expect(externalRequests).toEqual([]);
  await page.locator('article a', { hasText: 'Python' }).click();
  await expect(page.locator('article .lntd:last-child pre')).toContainText('print("first")');
  await expect(page.locator('article .lntd:last-child pre span').first()).toBeVisible();
  await expect(page).toHaveURL(/path=sample.py/);

  await writeFile(join(directory, 'new.md'), '# New file\n');
  await expect(page.getByRole('link', { name: 'new.md' })).toBeVisible();
  await page.getByRole('link', { name: 'new.md' }).click();
  await expect(page.locator('article h1')).toHaveText('New file');
  await writeFile(join(directory, 'new.md'), '# Updated file\n');
  await expect(page.locator('article h1')).toHaveText('Updated file');
  await unlink(join(directory, 'new.md'));
  await expect(page.locator('.file-error')).toContainText('File not found');
  await expect(page.getByRole('link', { name: 'new.md' })).toHaveCount(0);
});

test('previews SVG and PNG files and refreshes a changed image', async ({ page }) => {
  await page.goto(`http://127.0.0.1:${port}/?path=image.svg`);
  const preview = page.locator('article img.image-preview');
  await expect(preview).toBeVisible();
  await expect.poll(() => preview.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBe(40);
  const originalURL = await preview.getAttribute('src');
  await writeFile(join(directory, 'image.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="30"><rect width="80" height="30" fill="red"/></svg>');
  await expect.poll(() => preview.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBe(80);
  expect(await preview.getAttribute('src')).not.toBe(originalURL);
  await page.getByRole('link', { name: 'image.png' }).click();
  await expect(page).toHaveURL(/path=image.png/);
  await expect(preview).toBeVisible();
  await expect.poll(() => preview.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBe(1);
});

test('tracks imported descendants and an in-root directory move', async ({ page }) => {
  const source = await mkdtemp(join(tmpdir(), 'markport-import-'));
  await mkdir(join(source, 'folder', 'child'), { recursive: true });
  await writeFile(join(source, 'folder', 'child', 'nested.md'), '# Nested first\n');
  await page.goto(`http://127.0.0.1:${port}/`);
  await expect(page.locator('#connection')).toHaveText('Checking every few seconds');
  await rename(join(source, 'folder'), join(directory, 'folder'));
  await expect(page.locator('details[data-path="folder"]')).toHaveCount(1);
  await page.locator('details[data-path="folder"] > summary').click();
  await page.locator('details[data-path="folder/child"] > summary').click();
  await expect(page.getByRole('link', { name: 'nested.md' })).toBeVisible();
  await page.getByRole('link', { name: 'nested.md' }).click();
  await expect(page.locator('article h1')).toHaveText('Nested first');
  await writeFile(join(directory, 'folder', 'child', 'nested.md'), '# Nested second\n');
  await expect(page.locator('article h1')).toHaveText('Nested second');
  await rename(join(directory, 'folder'), join(directory, 'renamed'));
  await expect(page.locator('.file-error')).toBeVisible();
  await page.locator('details[data-path="renamed"] > summary').click();
  await page.locator('details[data-path="renamed/child"] > summary').click();
  await page.getByRole('link', { name: 'nested.md' }).click();
  await expect(page).toHaveURL(/path=renamed%2Fchild%2Fnested.md/);
  await writeFile(join(directory, 'renamed', 'child', 'nested.md'), '# Nested third\n');
  await expect(page.locator('article h1')).toHaveText('Nested third');
  await mkdir(join(directory, 'just-created'));
  await writeFile(join(directory, 'just-created', 'immediate.md'), '# Immediate\n');
  await expect(page.locator('details[data-path="just-created"]')).toHaveCount(1);
  await page.locator('details[data-path="just-created"] > summary').click();
  await expect(page.getByRole('link', { name: 'immediate.md' })).toBeVisible();
  await rm(source, { recursive: true, force: true });
});

test('recovers changes after the server restarts', async ({ page }) => {
  await writeFile(join(directory, 'to-delete.md'), '# Delete me\n');
  await page.goto(`http://127.0.0.1:${port}/?path=docs%2Finteractive.html`);
  await page.locator('#file-title .interactive-toggle').click();
  await expect(page.frameLocator('#content .html-preview').locator('body')).toHaveAttribute('data-local-script', 'ready');
  await page.goto(`http://127.0.0.1:${port}/?path=sample.py`);
  await expect(page.locator('article .lntd:last-child pre')).toContainText('first');
  await expect(page.getByRole('link', { name: 'to-delete.md' })).toBeVisible();
  await stopServer();
  await expect(page.locator('#connection')).toContainText('Refresh failed');
  await writeFile(join(directory, 'sample.py'), 'print("offline update")\n');
  await writeFile(join(directory, 'offline.md'), '# Added offline\n');
  await unlink(join(directory, 'to-delete.md'));
  await startServer();
  await expect(page.locator('article .lntd:last-child pre')).toContainText('offline update', { timeout: 15000 });
  await expect(page.getByRole('link', { name: 'offline.md' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'to-delete.md' })).toHaveCount(0);
  await page.goto(`http://127.0.0.1:${port}/?path=docs%2Finteractive.html`);
  await expect(page.locator('#file-title .interactive-toggle')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.frameLocator('#content .html-preview').locator('body')).not.toHaveAttribute('data-local-script', 'ready');
});

test('keeps browsing after a Mermaid parse error', async ({ page }) => {
  await writeFile(join(directory, 'bad.md'), '# Broken\n\n```mermaid\nflowchart LR\n A -->\n```\n');
  await page.goto(`http://127.0.0.1:${port}/?path=bad.md`);
  await expect(page.locator('.diagram-error')).toBeVisible({ timeout: 15000 });
  await expect(page.locator('.mermaid-source pre')).toContainText('A -->');
  await page.getByRole('link', { name: 'sample.py' }).click();
  await expect(page.locator('article .lntd:last-child pre')).toContainText('print');
});

test('desktop and mobile views in both themes', async ({ page }, testInfo) => {
  await page.goto(`http://127.0.0.1:${port}/?path=README.md`);
  await expect(page.locator('.mermaid-source svg')).toBeVisible({ timeout: 15000 });
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 800 });
    for (const theme of ['light', 'dark']) {
      await page.evaluate((value) => { localStorage.setItem('markport-theme', value); }, theme);
      await page.reload();
      await expect(page.locator('.mermaid-source svg')).toBeVisible({ timeout: 15000 });
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      const brand = page.locator('.brand-symbol');
      await expect(brand).toBeVisible();
      await expect(page.getByRole('img', { name: 'markport' })).toBeVisible();
      await expect(page.locator('header .brand img')).toHaveCount(1);
      const svg = await brand.evaluate(async (image: HTMLImageElement) => (await fetch(image.src)).text());
      expect(svg).toContain(theme === 'dark' ? '#75B7FF' : '#0969DA');
      expect(await brand.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);
      await page.screenshot({ path: testInfo.outputPath(`${width}-${theme}.png`), fullPage: true });
    }
  }
  const favicon = await page.locator('link[rel="icon"]').getAttribute('href');
  expect(favicon).toBeTruthy();
  const faviconSvg = await page.evaluate(async (url) => (await fetch(url!)).text(), favicon);
  expect(faviconSvg).toMatch(/viewBox=['"]0 0 32 32['"]/);
  expect(faviconSvg).toContain('--icon-accent: #0969DA');
  await page.evaluate(() => { localStorage.setItem('markport-theme', 'light'); });
  await page.reload();
  if (!(await page.locator('#theme-toggle').isVisible())) await page.getByRole('button', { name: 'More header actions' }).click();
  await page.getByRole('button', { name: 'Theme: Light' }).click();
  await page.getByRole('menuitemradio', { name: 'Dark' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  const switchedSvg = await page.locator('.brand-symbol').evaluate(async (image: HTMLImageElement) => (await fetch(image.src)).text());
  expect(switchedSvg).toContain('#75B7FF');
  await page.getByRole('button', { name: 'Open file list' }).click();
  await expect(page.locator('#sidebar')).toHaveClass(/open/);
  await page.getByRole('link', { name: 'sample.py' }).click();
  await expect(page.locator('#sidebar')).not.toHaveClass(/open/);
});

test('opens README, switches source, searches by keyboard, and follows code lines', async ({ page, context }) => {
  await page.goto(`http://127.0.0.1:${port}/`);
  await expect(page).toHaveURL(/path=README.md/);
  await expect(page).toHaveTitle('README.md — markport');
  await page.getByRole('button', { name: 'Source', exact: true }).click();
  await expect(page.locator('article .lntd:last-child pre')).toContainText('# Demo');
  await page.getByRole('button', { name: 'Rendered view' }).click();
  await expect(page.locator('article h1')).toHaveText('Demo');
  await page.keyboard.press('Control+k');
  await expect(page.locator('#search')).toBeFocused();
  await page.locator('#search').fill('smpy');
  await expect(page.locator('#result-count')).toContainText('1 match');
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('link', { name: 'sample.py' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/path=sample.py/);
  await expect(page.locator('#L1')).toHaveCount(1);
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.locator('.code-toolbar').getByRole('button', { name: 'Copy', exact: true }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toMatch(/^print\(/);
});

test('highlights linked code lines and keeps wrapped line numbers aligned', async ({ page }) => {
  const file = join(directory, 'long-wrap.ts');
  await writeFile(file, `const first = 1;\nconst long = '${'x'.repeat(300)}';\nconst third = 3;\nconst fourth = 4;\nconst fifth = 5;\n`);
  await page.setViewportSize({ width: 900, height: 700 });
  await page.goto(`http://127.0.0.1:${port}/?path=long-wrap.ts#L2`);
  await expect(page.locator('#content .lnt.selected-code-line')).toHaveCount(1);
  await expect(page.locator('#content .line.selected-code-line')).toHaveCount(1);
  await page.locator('#content .lnlinks[href="#L5"]').click({ modifiers: ['Shift'] });
  await expect(page).toHaveURL(/#L2-L5$/);
  await expect(page.locator('#content .line.selected-code-line')).toHaveCount(4);
  await expect(page.locator('#content .copy-line-link')).toBeVisible();
  await page.getByRole('button', { name: 'Wrap lines' }).click();
  await expect(page.getByRole('button', { name: 'Wrap lines' })).toHaveAttribute('aria-pressed', 'true');
  const alignment = await page.locator('#content .lntd:last-child .line').evaluateAll((lines) => {
    const second = lines[1].getBoundingClientRect(); const third = lines[2].getBoundingClientRect();
    const number = lines[1].querySelector('.wrapped-line-number')!.getBoundingClientRect();
    return { lineTop: second.top, numberTop: number.top, lineHeight: second.height, nextTop: third.top, overflow: document.querySelector('#content .code-frame')!.scrollWidth > document.querySelector('#content .code-frame')!.clientWidth };
  });
  expect(alignment.numberTop).toBe(alignment.lineTop);
  expect(alignment.lineHeight).toBeGreaterThan(30);
  expect(alignment.nextTop).toBeGreaterThanOrEqual(alignment.lineTop + alignment.lineHeight);
  expect(alignment.overflow).toBe(false);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Wrap lines' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#content .line.selected-code-line')).toHaveCount(4);
  await writeFile(file, `const first = 1;\nconst long = '${'y'.repeat(300)}';\nconst third = 3;\nconst fourth = 4;\nconst fifth = 5;\n`);
  await expect(page.locator('#content .lntd:last-child .line').nth(1)).toContainText('yyyy', { timeout: 15000 });
  await expect(page.locator('#content .line.selected-code-line')).toHaveCount(4);
});

test('copies Markdown blocks, code files, and paths without the Clipboard API', async ({ page, context }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await writeFile(join(directory, 'copy.md'), '```python\nprint("markdown")\n```\n\n```\nplain <text>\n```\n');
  await writeFile(join(directory, 'copy.py'), 'print("code file")\n');
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const hideClipboard = async () => page.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
  });
  const readClipboard = async () => page.evaluate(async () => {
    Reflect.deleteProperty(navigator, 'clipboard');
    return navigator.clipboard.readText();
  });

  await page.goto(`http://127.0.0.1:${port}/?path=copy.md`);
  const copyButtons = page.locator('.code-toolbar').getByRole('button', { name: 'Copy', exact: true });
  await expect(copyButtons).toHaveCount(2);
  await hideClipboard();
  await copyButtons.first().click();
  await expect(page.locator('.code-toolbar').first().getByRole('button', { name: 'Copied' })).toBeVisible();
  expect(await readClipboard()).toBe('print("markdown")\n');

  await hideClipboard();
  await copyButtons.last().click();
  await expect(page.locator('.code-toolbar').last().getByRole('button', { name: 'Copied' })).toBeVisible();
  expect(await readClipboard()).toBe('plain <text>\n');

  await page.goto(`http://127.0.0.1:${port}/?path=copy.py`);
  await hideClipboard();
  await page.locator('.code-toolbar').getByRole('button', { name: 'Copy', exact: true }).click();
  await expect(page.locator('.code-toolbar').getByRole('button', { name: 'Copied' })).toBeVisible();
  expect(await readClipboard()).toBe('print("code file")\n');

  await hideClipboard();
  await page.getByRole('button', { name: 'Copy path' }).click();
  await expect(page.getByRole('button', { name: 'Copied' }).last()).toBeVisible();
  expect(await readClipboard()).toBe('copy.py');

  await hideClipboard();
  await page.evaluate(() => { document.execCommand = () => false; });
  await page.locator('.code-toolbar').getByRole('button', { name: 'Copy', exact: true }).click();
  await expect(page.locator('.code-toolbar').getByRole('button', { name: 'Copy failed' })).toBeVisible();
  expect(pageErrors).toEqual([]);
});

test('opens a deep link beyond the first directory page', async ({ page }) => {
  const paged = join(directory, 'paged');
  await mkdir(paged);
  await Promise.all(Array.from({ length: 205 }, (_, index) => writeFile(join(paged, `file${String(index).padStart(3, '0')}.md`), `# ${index}\n`)));
  await page.goto(`http://127.0.0.1:${port}/?path=paged%2Ffile204.md`);
  await expect(page.locator('article h1')).toHaveText('204');
  await expect(page.locator('details[data-path="paged"] a')).toHaveCount(5);
  await page.locator('details[data-path="paged"] button[data-offset="0"]').click();
  await expect(page.locator('details[data-path="paged"] a')).toHaveCount(205);
  await page.locator('#search').fill('file000');
  await expect(page.getByRole('link', { name: 'paged/file000.md' })).toBeVisible();
});

test('searches a closed folder and refreshes search results after file changes', async ({ page }) => {
  test.setTimeout(45000);
  const folder = join(directory, 'search-refresh');
  await mkdir(folder);
  await writeFile(join(folder, 'hidden-target.md'), '# Hidden\n');
  await page.goto(`http://127.0.0.1:${port}/`);
  await expect(page.locator('details[data-path="search-refresh"]')).toHaveCount(1);
  await expect(page.locator('details[data-path="search-refresh"]')).not.toHaveAttribute('open');
  await page.locator('#search').fill('hidden-target');
  await expect(page.getByRole('link', { name: 'search-refresh/hidden-target.md' })).toBeVisible();
  await writeFile(join(folder, 'hidden-target-new.md'), '# New\n');
  await expect(page.locator('#result-count')).toHaveText('2 matches', { timeout: 20000 });
  await unlink(join(folder, 'hidden-target.md'));
  await expect(page.locator('#result-count')).toHaveText('1 match', { timeout: 20000 });
  await expect(page.getByRole('link', { name: 'search-refresh/hidden-target-new.md' })).toBeVisible();
});

test('filename search keeps names readable in a narrow sidebar', async ({ page }) => {
  await mkdir(join(directory, 'search-names', 'one'), { recursive: true });
  await mkdir(join(directory, 'search-names', 'two'), { recursive: true });
  const name = 'distinctive-long-filename.md';
  await writeFile(join(directory, 'search-names', 'one', name), '# One');
  await writeFile(join(directory, 'search-names', 'two', name), '# Two');
  await page.goto(`http://127.0.0.1:${port}/`);
  await page.evaluate(() => { localStorage.setItem('markport-sidebar-width', '200'); document.documentElement.style.setProperty('--sidebar-width', '200px'); });
  await page.locator('#search').fill(name);
  await expect(page.locator('#tree .search-results a')).toHaveCount(2);
  const rows = page.locator('#tree .search-results li');
  await expect(rows.nth(0).locator('.node-file-name')).toHaveText(name);
  await expect(rows.nth(1).locator('.node-file-name')).toHaveText(name);
  expect(await rows.nth(0).locator('.node-file-name').evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  expect(await rows.nth(0).locator('.node-parent-path').textContent()).not.toBe(await rows.nth(1).locator('.node-parent-path').textContent());
  await page.locator('#search').press('ArrowDown');
  await expect(rows.nth(0).locator('a')).toBeFocused();
  await rows.nth(0).locator('.open-right').focus();
  await expect(rows.nth(0).locator('.open-right')).toBeFocused();
  await page.locator('#search').focus();
  await page.locator('#search').press('Escape');
  await expect(page.locator('#tree .search-results')).toHaveCount(0);
});

test('shows an outline and keeps a long table header visible', async ({ page }) => {
  const rows = Array.from({ length: 50 }, (_, index) => `| ${index} | value ${index} |`).join('\n');
  await writeFile(join(directory, 'long.md'), `# First\n\n## Second\n\n### Third\n\n| Number | Value |\n|---:|:---|\n${rows}\n`);
  await page.goto(`http://127.0.0.1:${port}/?path=long.md`);
  await expect(page.locator('#outline a')).toHaveCount(3);
  await page.locator('#outline a', { hasText: 'Third' }).click();
  await expect(page).toHaveURL(/#third$/);
  await page.locator('main').evaluate((element) => { element.scrollTop = 500; });
  await expect.poll(() => page.locator('article thead').evaluate((element) => parseFloat((element as HTMLElement).style.transform.match(/\d+(?:\.\d+)?/)?.[0] ?? '0'))).toBeGreaterThan(0);
  const positions = await page.evaluate(() => ({ title: document.querySelector('#file-title')!.getBoundingClientRect().bottom, head: document.querySelector('article thead')!.getBoundingClientRect().top }));
  expect(positions.head).toBeGreaterThanOrEqual(positions.title - 2);
});

test('starts folders collapsed and sorts folders and numbered files naturally', async ({ page }) => {
  await mkdir(join(directory, 'sort10'));
  await mkdir(join(directory, 'sort2'));
  await writeFile(join(directory, 'z10.txt'), 'ten');
  await writeFile(join(directory, 'z2.txt'), 'two');
  await page.goto(`http://127.0.0.1:${port}/?path=README.md`);
  await expect(page.locator('details[data-path="sort2"]')).not.toHaveAttribute('open');
  const names = await page.locator('#tree > ul > li').evaluateAll((items) => items.map((item) => item.querySelector(':scope > details > summary .node-label, :scope > a .node-label')?.textContent));
  expect(names.indexOf('sort2')).toBeLessThan(names.indexOf('sort10'));
  expect(names.indexOf('z2.txt')).toBeLessThan(names.indexOf('z10.txt'));
  expect(names.indexOf('sort10')).toBeLessThan(names.indexOf('z2.txt'));
  await page.locator('details[data-path="sort2"] > summary').click();
  await writeFile(join(directory, 'sort2', 'new.md'), '# New');
  await expect(page.getByRole('link', { name: 'new.md' })).toBeVisible();
  await page.reload();
  await expect(page.locator('details[data-path="sort2"]')).toHaveAttribute('open');
  await expect(page.locator('details[data-path="sort10"]')).not.toHaveAttribute('open');
});

test('shows Git changes and refreshes a file diff', async ({ page }) => {
  const git = (...args: string[]): void => { execFileSync('git', ['-C', directory, ...args]); };
  git('init', '-q');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'Test');
  git('add', '.');
  git('commit', '-qm', 'initial');
  await writeFile(join(directory, 'sample.py'), 'print("changed")\n');
  await writeFile(join(directory, 'new-diff.md'), `<script>alert(1)</script>${'x'.repeat(200)}END\n`);
  await page.goto(`http://127.0.0.1:${port}/?view=changes`);
  await expect(page.locator('#content .change-path', { hasText: 'sample.py' })).toBeVisible();
  await expect(page.locator('#content .change-path', { hasText: 'new-diff.md' })).toBeVisible();
  await page.setViewportSize({ width: 375, height: 800 });
  await page.getByRole('button', { name: 'Open file list' }).click();
  await page.getByRole('tab', { name: 'Changes' }).click();
  const reviewButton = page.locator('#changes-tree .review-toggle').first();
  await expect(reviewButton).toHaveAttribute('aria-label', /Mark reviewed:/);
  const row = page.locator('#changes-tree .change-list li').first();
  const positions = await row.evaluate((item) => {
    const link = item.querySelector('a')!.getBoundingClientRect();
    const button = item.querySelector('button')!.getBoundingClientRect();
    return { linkTop: link.top, buttonTop: button.top, linkWidth: link.width };
  });
  expect(positions.buttonTop).toBe(positions.linkTop);
  expect(positions.linkWidth).toBeGreaterThan(100);
  await page.getByRole('button', { name: 'Open file list' }).click();
  const count = page.locator('#content .review-count');
  await expect(count).toContainText('0 of');
  await page.locator('#content a[href*="new-diff.md"]').click();
  await expect(page.locator('.diff-added .diff-code')).toContainText('<script>alert(1)</script>');
  const diffScroll = await page.locator('.diff-frame').evaluate((frame) => {
    frame.scrollLeft = frame.scrollWidth;
    return { width: frame.clientWidth, content: frame.scrollWidth, offset: frame.scrollLeft };
  });
  expect(diffScroll.content).toBeGreaterThan(diffScroll.width);
  expect(diffScroll.offset).toBeGreaterThan(0);
  await page.setViewportSize({ width: 1280, height: 800 });
  expect(await page.locator('#content script').count()).toBe(0);
  await page.locator('#file-title .review-toggle').click();
  await expect(page.locator('#file-title .review-toggle')).toHaveAttribute('aria-pressed', 'true');
  await page.reload();
  await expect(page.locator('#file-title .review-toggle')).toHaveAttribute('aria-pressed', 'true');
  await page.waitForTimeout(3500);
  await expect(page.locator('#file-title .review-toggle')).toHaveAttribute('aria-pressed', 'true');
  await writeFile(join(directory, 'new-diff.md'), '<script>alert(2)</script>\n');
  await expect(page.locator('#file-title .review-toggle')).toHaveAttribute('aria-pressed', 'false', { timeout: 15000 });
  await expect(page.locator('.diff-added .diff-code')).toContainText('alert(2)');
  await page.getByRole('tab', { name: 'Changes' }).click();
  await expect(page.locator('#content .review-count')).toContainText('0 of');
  await page.locator('#content').getByLabel('Unreviewed only').check();
  await expect(page.locator('#content .change-path', { hasText: 'new-diff.md' })).toBeVisible();
  await page.locator('#changes-tree a[href*="sample.py"]').click();
  await expect(page.locator('.diff-added .diff-code')).toContainText('changed');
  await writeFile(join(directory, 'sample.py'), 'print("changed again")\n');
  await expect(page.locator('.diff-added .diff-code')).toContainText('changed again', { timeout: 15000 });
  await page.getByRole('button', { name: 'File', exact: true }).last().click();
  await expect(page.locator('article .lntd:last-child pre')).toContainText('changed again');
  await writeFile(join(directory, 'docs', 'style.css'), 'h1 { color: red }');
  await page.goto(`http://127.0.0.1:${port}/?view=diff&path=docs%2Fstyle.css`);
  await expect(page.locator('.diff-added .diff-code')).toContainText('color: red');
  await page.locator('.crumb', { hasText: 'docs' }).click();
  await expect(page.locator('#files-panel')).toBeVisible();
  await expect(page.locator('details[data-path="docs"] > summary')).toBeFocused();
  await page.getByRole('button', { name: 'Refresh' }).click();
  await expect(page.locator('#files-panel')).toBeVisible();
  await expect(page.locator('.diff-added .diff-code')).toContainText('color: red');
});

test('reviews changed files in order with counts and directory groups', async ({ page }) => {
  const changes = [
    { path: 'a.md', status: 'modified', revision: 'a1', added: 1, deleted: 2 },
    { path: 'b.md', status: 'added', revision: 'b1', added: 3, deleted: 0 },
    { path: 'docs/c.md', status: 'deleted', revision: 'c1', added: 0, deleted: 4 },
  ];
  await page.route('**/api/git/changes', (route) => route.fulfill({ json: { available: true, rootId: 'review-navigation-test', changes } }));
  await page.route('**/api/git/diff?**', (route) => {
    const path = new URL(route.request().url()).searchParams.get('path')!;
    return route.fulfill({ json: { path, kind: 'text', patch: `diff --git a/${path} b/${path}\n@@ -1 +1 @@\n-old\n+new\n` } });
  });
  await page.goto(`http://127.0.0.1:${port}/?view=changes`);
  await expect(page.locator('#content .change-lines').first()).toContainText('+1 −2');
  await page.locator('#content').getByLabel('Group by directory').check();
  await expect(page.locator('#content .change-directory')).toHaveText(['Root', 'docs']);
  await page.locator('#content a[href*="b.md"]').click();
  await expect(page.locator('#file-title .diff-navigation')).toBeVisible();
  await page.keyboard.press('n');
  expect(new URL(page.url()).searchParams.get('path')).toBe('docs/c.md');
  await expect(page.getByRole('button', { name: 'Next (n)' })).toBeDisabled();
  await page.keyboard.press('p');
  expect(new URL(page.url()).searchParams.get('path')).toBe('b.md');
  await page.keyboard.press('r');
  expect(new URL(page.url()).searchParams.get('path')).toBe('docs/c.md');
  await expect(page.locator('#changes-tree .review-count')).toContainText('1 of 3 reviewed');
  await page.locator('#changes-tree').getByLabel('Unreviewed only').check();
  await page.keyboard.press('p');
  expect(new URL(page.url()).searchParams.get('path')).toBe('a.md');
  await page.locator('#changes-tree .review-filter input').first().focus();
  await page.keyboard.press('n');
  expect(new URL(page.url()).searchParams.get('path')).toBe('a.md');
  await page.locator('#changes-tree .review-filter input').first().blur();
  await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', isComposing: true, bubbles: true })));
  expect(new URL(page.url()).searchParams.get('path')).toBe('a.md');
});
