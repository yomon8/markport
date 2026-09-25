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
    await expect(page.getByRole('button', { name: 'Files' })).toBeVisible();
    await expect(page.locator('#file-title').getByRole('button', { name: 'Source' })).toBeVisible();
  } finally {
    await context.close();
  }
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
  await page.locator('.crumb', { hasText: 'docs' }).click();
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
  await page.locator('.title-actions button', { hasText: 'Source' }).click();
  await expect(page.locator('article .lntd:last-child pre')).toContainText('HTML preview');
  await page.locator('.title-actions button', { hasText: 'Preview' }).click();
  await frame.locator('a', { hasText: 'Next HTML' }).click();
  await expect(page).toHaveURL(/path=docs%2Fsecond\.htm/);
  await expect(page.frameLocator('.html-preview').locator('h1')).toHaveText('Second HTML');
  await writeFile(join(directory, 'docs', 'second.htm'), '<!doctype html><html><body><h1>Updated HTML</h1></body></html>');
  await expect(page.frameLocator('.html-preview').locator('h1')).toHaveText('Updated HTML', { timeout: 15000 });
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
      const brand = page.locator(width === 390 ? '.brand-symbol' : '.brand-horizontal');
      await expect(brand).toBeVisible();
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
  await page.getByRole('button', { name: 'Theme: Light' }).click();
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
  await page.locator('.code-toolbar button').click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toMatch(/^print\(/);
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
  await writeFile(join(directory, 'new-diff.md'), '<script>alert(1)</script>\n');
  await page.goto(`http://127.0.0.1:${port}/?view=changes`);
  await expect(page.locator('#content .change-path', { hasText: 'sample.py' })).toBeVisible();
  await expect(page.locator('#content .change-path', { hasText: 'new-diff.md' })).toBeVisible();
  await page.locator('#content a[href*="new-diff.md"]').click();
  await expect(page.locator('.diff-added .diff-code')).toContainText('<script>alert(1)</script>');
  expect(await page.locator('#content script').count()).toBe(0);
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
