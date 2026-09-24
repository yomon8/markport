import { test, expect } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
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
  await startServer();
});

test.afterAll(async () => {
  await stopServer();
  if (directory) await rm(directory, { recursive: true, force: true });
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
  await expect(page.locator('.file-error')).toContainText('ファイルが見つかりません');
  await expect(page.getByRole('link', { name: 'new.md' })).toHaveCount(0);
});

test('tracks imported descendants and an in-root directory move', async ({ page }) => {
  const source = await mkdtemp(join(tmpdir(), 'markport-import-'));
  await mkdir(join(source, 'folder', 'child'), { recursive: true });
  await writeFile(join(source, 'folder', 'child', 'nested.md'), '# Nested first\n');
  await page.goto(`http://127.0.0.1:${port}/`);
  await expect(page.locator('#connection')).toHaveText('自動更新中');
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

test('recovers changes after an SSE disconnect', async ({ page }) => {
  await writeFile(join(directory, 'to-delete.md'), '# Delete me\n');
  await page.goto(`http://127.0.0.1:${port}/?path=sample.py`);
  await expect(page.locator('article .lntd:last-child pre')).toContainText('first');
  await expect(page.getByRole('link', { name: 'to-delete.md' })).toBeVisible();
  await stopServer();
  await expect(page.locator('#connection')).toContainText('再接続中');
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
      await page.screenshot({ path: testInfo.outputPath(`${width}-${theme}.png`), fullPage: true });
    }
  }
  await page.getByRole('button', { name: 'ファイル一覧を開く' }).click();
  await expect(page.locator('#sidebar')).toHaveClass(/open/);
  await page.getByRole('link', { name: 'sample.py' }).click();
  await expect(page.locator('#sidebar')).not.toHaveClass(/open/);
});

test('opens README, switches source, searches by keyboard, and follows code lines', async ({ page, context }) => {
  await page.goto(`http://127.0.0.1:${port}/`);
  await expect(page).toHaveURL(/path=README.md/);
  await expect(page).toHaveTitle('README.md — markport');
  await page.getByRole('button', { name: 'ソース', exact: true }).click();
  await expect(page.locator('article .lntd:last-child pre')).toContainText('# Demo');
  await page.getByRole('button', { name: '整形表示' }).click();
  await expect(page.locator('article h1')).toHaveText('Demo');
  await page.keyboard.press('Control+k');
  await expect(page.locator('#search')).toBeFocused();
  await page.locator('#search').fill('smpy');
  await expect(page.locator('#result-count')).toHaveText('1件');
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('link', { name: 'sample.py' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/path=sample.py/);
  await expect(page.locator('#L1')).toHaveCount(1);
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.locator('.code-toolbar button').click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toMatch(/^print\(/);
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
