import { test, expect, type Page } from '@playwright/test';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir, devNull } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:net';

test.skip(process.platform !== 'linux', 'Push acceptance tests use the Linux native watcher');
let directory: string; let port: number; let server: ChildProcess;
const git = (...args: string[]): void => {
  execFileSync('git', ['-C', directory, '-c', 'user.name=Watch Test', '-c', 'user.email=watch@example.com', '-c', 'commit.gpgsign=false', ...args], {
    stdio: 'ignore', env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: devNull },
  });
};

test.beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'markport-live-'));
  await writeFile(join(directory, 'README.md'), '# Before\n');
  git('init', '-q'); git('add', '.'); git('commit', '-qm', 'Initial watch fixture');
  await new Promise<void>((done, reject) => {
    const listener = createServer(); listener.once('error', reject);
    listener.listen(0, '127.0.0.1', () => {
      const address = listener.address();
      if (!address || typeof address === 'string') return reject(new Error('port unavailable'));
      port = address.port; listener.close(() => done());
    });
  });
  server = spawn(resolve('../dist/markport'), [directory, '--port', String(port)], { stdio: 'ignore' });
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(`http://127.0.0.1:${port}/api/tree`)).ok) return; } catch { /* Starting. */ }
    await new Promise((done) => setTimeout(done, 50));
  }
  throw new Error('server did not start');
});

test.afterAll(async () => {
  if (server && server.exitCode === null && server.signalCode === null) {
    const exited = new Promise((done) => server.once('exit', done)); server.kill('SIGTERM'); await exited;
  }
  if (directory) await rm(directory, { recursive: true, force: true });
});

async function openWatching(page: Page, query: string): Promise<void> {
  await page.addInitScript(() => {
    const NativeEventSource = window.EventSource;
    window.EventSource = class extends NativeEventSource {
      constructor(url: string | URL, init?: EventSourceInit) {
        super(url, init);
        this.addEventListener('mode', (event: MessageEvent) => {
          document.documentElement.dataset.testLiveMode = (JSON.parse(event.data) as { mode: string }).mode;
        });
      }
    };
  });
  await page.goto(`http://127.0.0.1:${port}/${query}`);
  await expect(page.locator('html')).toHaveAttribute('data-test-live-mode', 'watch');
}

test('pushes file edits to the open document in less than a second', async ({ page }) => {
  await writeFile(join(directory, 'README.md'), '# Before\n');
  await openWatching(page, '?path=README.md');
  await expect(page.locator('#content h1')).toHaveText('Before');
  const started = Date.now();
  await writeFile(join(directory, 'README.md'), '# After push\n');
  await expect(page.locator('#content h1')).toHaveText('After push', { timeout: 1000 });
  expect(Date.now() - started).toBeLessThan(1000);
});

test('pushes git add into the Changes view without a working-file write', async ({ page }) => {
  await writeFile(join(directory, 'README.md'), '# Staging change\n');
  await openWatching(page, '?view=changes');
  const status = page.locator('#content a[href*="README.md"] .git-status');
  await expect(status).toHaveJSProperty('textContent', ' M');
  const started = Date.now(); git('add', 'README.md');
  await expect(status).toHaveJSProperty('textContent', 'M ', { timeout: 1000 });
  expect(Date.now() - started).toBeLessThan(1000);
});

test('pushes a changed HEAD into the History view', async ({ page }) => {
  await openWatching(page, '?view=history');
  await expect(page.locator('#history-tree .history-list')).toContainText('Initial watch fixture');
  const started = Date.now(); git('commit', '--allow-empty', '-qm', 'Pushed history update');
  await expect(page.locator('#history-tree .history-list')).toContainText('Pushed history update', { timeout: 1000 });
  expect(Date.now() - started).toBeLessThan(1000);
});
