import { test, expect } from '@playwright/test';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:net';

let directory: string;
let cacheDirectory: string;
let port: number;
let server: ChildProcess;

test.beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'markport-staging-'));
  cacheDirectory = await mkdtemp(join(tmpdir(), 'markport-staging-cache-'));
  port = await new Promise<number>((done, fail) => {
    const listener = createServer(); listener.once('error', fail);
    listener.listen(0, '127.0.0.1', () => {
      const address = listener.address();
      if (!address || typeof address === 'string') { listener.close(); fail(new Error('port unavailable')); return; }
      listener.close(() => done(address.port));
    });
  });
  server = spawn(resolve('../dist/markport'), [directory, '--port', String(port)], { stdio: 'ignore', env: { ...process.env, XDG_CACHE_HOME: cacheDirectory, LOCALAPPDATA: cacheDirectory } });
  await expect.poll(async () => {
    try { return (await fetch(`http://127.0.0.1:${port}/api/tree`)).ok; } catch { return false; }
  }).toBe(true);
});

test.afterAll(async () => {
  if (server && server.exitCode === null && server.signalCode === null) {
    const exited = new Promise((done) => server.once('exit', done)); server.kill('SIGTERM'); await exited;
  }
  if (directory) await rm(directory, { recursive: true, force: true });
  if (cacheDirectory) await rm(cacheDirectory, { recursive: true, force: true });
});

test('shows Lazygit status codes and refreshes index-only changes while preserving reviews', async ({ page }, testInfo) => {
  test.setTimeout(60000);
  const git = (...args: string[]): string => execFileSync('git', ['-C', directory, '-c', 'user.name=Test', '-c', 'user.email=test@example.com', '-c', 'commit.gpgsign=false', ...args], { encoding: 'utf8' }).trim();
  git('init', '-q');
  await mkdir(join(directory, 'staging'), { recursive: true });
  await writeFile(join(directory, 'staging', 'tracked.md'), 'old\n');
  await writeFile(join(directory, 'staging', 'cancelled.md'), 'old\n');
  await writeFile(join(directory, 'staging', 'recreated.md'), 'old\n');
  git('add', 'staging'); git('commit', '-qm', 'staging fixture', '--', 'staging');
  const base = git('rev-parse', 'HEAD');
  git('rm', '-q', 'staging/recreated.md');
  await writeFile(join(directory, 'staging', 'recreated.md'), 'old\n');
  await writeFile(join(directory, 'staging', 'tracked.md'), 'new\n');
  await writeFile(join(directory, 'staging', 'cancelled.md'), 'staged\n');
  await writeFile(join(directory, 'staging', 'untracked.md'), 'untracked\n');
  git('add', 'staging/cancelled.md');
  await writeFile(join(directory, 'staging', 'cancelled.md'), 'old\n');
  await page.goto(`http://127.0.0.1:${port}/?view=changes`);
  const row = (target: string, path: string) => page.locator(`${target} a[href*="${encodeURIComponent(path)}"]`);
  for (const target of ['#content', '#changes-tree']) {
    await expect(row(target, 'staging/tracked.md').locator('.git-status')).toHaveJSProperty('textContent', ' M');
    await expect(row(target, 'staging/untracked.md').locator('.git-status')).toHaveJSProperty('textContent', '??');
    await expect(row(target, 'staging/cancelled.md').locator('.git-status')).toHaveJSProperty('textContent', 'MM');
    await expect(row(target, 'staging/cancelled.md').locator('.change-lines')).toHaveText('+0 −0');
    await expect(row(target, 'staging/recreated.md').locator('.git-status-code')).toHaveCount(2);
  }
  const indicator = row('#content', 'staging/cancelled.md').locator('.git-status');
  expect(await indicator.locator('.git-status-index').evaluate((node) => getComputedStyle(node).color)).not.toBe(await indicator.locator('.git-status-worktree').evaluate((node) => getComputedStyle(node).color));
  await expect(page.locator('#content .change-status, #content .change-staging')).toHaveCount(0);
  await page.locator('#content').getByLabel('Folder tree').uncheck();
  await expect(row('#content', 'staging/tracked.md').locator('.change-path')).toHaveText('staging/tracked.md');
  await page.locator('#content').getByLabel('Folder tree').check();
  await row('#content', 'staging/tracked.md').click();
  await page.locator('#file-title .review-toggle').click();
  await page.locator('.diff-frame').evaluate((frame) => { frame.setAttribute('data-retained', 'true'); });
  git('add', 'staging/tracked.md');
  await expect(page.locator('#file-title .git-status')).toHaveJSProperty('textContent', 'M ', { timeout: 15000 });
  await expect(page.locator('#file-title .review-toggle')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.diff-frame')).toHaveAttribute('data-retained', 'true');
  git('restore', '--staged', 'staging/tracked.md');
  await expect(page.locator('#file-title .git-status')).toHaveJSProperty('textContent', ' M', { timeout: 15000 });
  await expect(page.locator('#file-title .review-toggle')).toHaveAttribute('aria-pressed', 'true');
  git('add', 'staging/tracked.md');
  await writeFile(join(directory, 'staging', 'tracked.md'), 'newer\n');
  await expect(page.locator('#file-title .git-status')).toHaveJSProperty('textContent', 'MM', { timeout: 15000 });
  await expect(page.locator('#file-title .review-toggle')).toHaveAttribute('aria-pressed', 'false');
  await row('#changes-tree', 'staging/cancelled.md').click();
  await expect(page.locator('#content .hint')).toHaveText('No net changes against the comparison base.');
  await page.setViewportSize({ width: 375, height: 800 });
  await expect(page.locator('#file-title .git-status')).toBeVisible();
  await page.getByRole('button', { name: 'Open file list' }).click();
  await expect(row('#changes-tree', 'staging/cancelled.md').locator('.git-status')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('staging-mobile.png'), animations: 'disabled' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Close file list' }).click();
  git('add', 'staging/tracked.md'); git('commit', '-qm', 'tracked update', '--', 'staging/tracked.md');
  await page.goto(`http://127.0.0.1:${port}/?view=changes&base=${base}`);
  await expect(row('#content', 'staging/tracked.md').locator('.git-status')).toHaveJSProperty('textContent', '  ');
  await expect(row('#content', 'staging/tracked.md').locator('.git-status')).toHaveAttribute('aria-label', /No local changes.*Compared with base: Modified/);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.screenshot({ path: testInfo.outputPath('staging-desktop.png'), animations: 'disabled' });
});
