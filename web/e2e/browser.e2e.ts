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
  await expect(page.locator('article pre')).toContainText('print("first")');
  await expect(page.locator('article pre span').first()).toBeVisible();
  await expect(page).toHaveURL(/path=sample.py/);

  await writeFile(join(directory, 'new.md'), '# New file\n');
  await expect(page.getByRole('link', { name: 'new.md' })).toBeVisible();
  await page.getByRole('link', { name: 'new.md' }).click();
  await expect(page.locator('article h1')).toHaveText('New file');
  await writeFile(join(directory, 'new.md'), '# Updated file\n');
  await expect(page.locator('article h1')).toHaveText('Updated file');
  await unlink(join(directory, 'new.md'));
  await expect(page.locator('.file-error')).toContainText('表示できません');
  await expect(page.getByRole('link', { name: 'new.md' })).toHaveCount(0);
});

test('tracks imported descendants and an in-root directory move', async ({ page }) => {
  const source = await mkdtemp(join(tmpdir(), 'markport-import-'));
  await mkdir(join(source, 'folder', 'child'), { recursive: true });
  await writeFile(join(source, 'folder', 'child', 'nested.md'), '# Nested first\n');
  await page.goto(`http://127.0.0.1:${port}/`);
  await expect(page.locator('#connection')).toHaveText('自動更新中');
  await rename(join(source, 'folder'), join(directory, 'folder'));
  await expect(page.getByRole('link', { name: 'nested.md' })).toBeVisible();
  await page.getByRole('link', { name: 'nested.md' }).click();
  await expect(page.locator('article h1')).toHaveText('Nested first');
  await writeFile(join(directory, 'folder', 'child', 'nested.md'), '# Nested second\n');
  await expect(page.locator('article h1')).toHaveText('Nested second');
  await rename(join(directory, 'folder'), join(directory, 'renamed'));
  await expect(page.locator('.file-error')).toBeVisible();
  await page.getByRole('link', { name: 'nested.md' }).click();
  await expect(page).toHaveURL(/path=renamed%2Fchild%2Fnested.md/);
  await writeFile(join(directory, 'renamed', 'child', 'nested.md'), '# Nested third\n');
  await expect(page.locator('article h1')).toHaveText('Nested third');
  await mkdir(join(directory, 'just-created'));
  await writeFile(join(directory, 'just-created', 'immediate.md'), '# Immediate\n');
  await expect(page.getByRole('link', { name: 'immediate.md' })).toBeVisible();
  await rm(source, { recursive: true, force: true });
});

test('recovers changes after an SSE disconnect', async ({ page }) => {
  await writeFile(join(directory, 'to-delete.md'), '# Delete me\n');
  await page.goto(`http://127.0.0.1:${port}/?path=sample.py`);
  await expect(page.locator('article pre')).toContainText('first');
  await expect(page.getByRole('link', { name: 'to-delete.md' })).toBeVisible();
  await stopServer();
  await expect(page.locator('#connection')).toContainText('再接続中');
  await writeFile(join(directory, 'sample.py'), 'print("offline update")\n');
  await writeFile(join(directory, 'offline.md'), '# Added offline\n');
  await unlink(join(directory, 'to-delete.md'));
  await startServer();
  await expect(page.locator('article pre')).toContainText('offline update', { timeout: 15000 });
  await expect(page.getByRole('link', { name: 'offline.md' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'to-delete.md' })).toHaveCount(0);
});

test('keeps browsing after a Mermaid parse error', async ({ page }) => {
  await writeFile(join(directory, 'bad.md'), '# Broken\n\n```mermaid\nflowchart LR\n A -->\n```\n');
  await page.goto(`http://127.0.0.1:${port}/?path=bad.md`);
  await expect(page.locator('.diagram-error')).toBeVisible({ timeout: 15000 });
  await expect(page.locator('.mermaid-source pre')).toContainText('A -->');
  await page.getByRole('link', { name: 'sample.py' }).click();
  await expect(page.locator('article pre')).toContainText('print');
});
