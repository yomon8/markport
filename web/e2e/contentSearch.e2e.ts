import { test, expect } from '@playwright/test';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir, devNull } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:net';

let directory: string; let port: number; let server: ChildProcess;

test.beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'markport-content-options-'));
  await mkdir(join(directory, 'docs'));
  await writeFile(join(directory, 'docs', 'guide.md'), '# Guide\n\nIssue: BUG-123\n');
  await writeFile(join(directory, '.gitignore'), 'ignored.md\n');
  await writeFile(join(directory, 'ignored.md'), '# BUG-456\n');
  execFileSync('git', ['-C', directory, 'init', '-q'], { env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: devNull } });
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

test('searches with regex options, opens the source line, and restores saved options', async ({ page }) => {
  await page.goto(`http://127.0.0.1:${port}/?path=docs%2Fguide.md`);
  await page.locator('#content-search summary').click();
  await page.getByLabel('Text to find', { exact: true }).fill(String.raw`bug-\d+`);
  await page.getByRole('button', { name: 'Use regular expression', exact: true }).click();
  await page.getByLabel('Files to include', { exact: true }).fill('*.md');
  await page.locator('#content-search').getByRole('button', { name: 'Search', exact: true }).click();
  await expect(page.locator('.content-search-status')).toContainText('1 ignored files skipped');
  const result = page.locator('.content-search-results a');
  await expect(result).toHaveCount(1); await expect(result).toContainText('BUG-123');
  await result.click();
  await expect(page).toHaveURL(/source=1#L3$/);
  await expect(page.locator('#content .line.selected-code-line')).toContainText('BUG-123');
  await expect(page.locator('#content .line.selected-code-line')).toBeInViewport();
  await page.reload(); await page.locator('#content-search summary').click();
  await expect(page.getByRole('button', { name: 'Use regular expression', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByLabel('Files to include', { exact: true })).toHaveValue('*.md');
  await page.getByLabel('Text to find', { exact: true }).fill('[');
  await page.locator('#content-search').getByRole('button', { name: 'Search', exact: true }).click();
  await expect(page.locator('.content-search-status')).toContainText('error parsing regexp');
});
