import { test, expect } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:net';

let directory: string;
let port: number;
let process: ChildProcess | undefined;
const startupTitle = '作業ノート <script> & "quoted"';
const url = () => `http://127.0.0.1:${port}/`;

async function stopServer(): Promise<void> {
  if (!process || process.exitCode !== null || process.signalCode !== null) return;
  const exited = new Promise<void>((done) => process!.once('exit', () => done()));
  process.kill('SIGTERM'); await exited;
}
async function startServer(folder = directory, title = startupTitle): Promise<void> {
  process = spawn(resolve('../dist/markport'), [folder, '--port', String(port), '--title', title], { stdio: 'ignore' });
  await expect.poll(async () => {
    try { return (await fetch(`${url()}api/config`)).ok; } catch { return false; }
  }).toBe(true);
}

test.beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'markport-title-'));
  await writeFile(join(directory, 'README.md'), '# Notes');
  await writeFile(join(directory, 'code.py'), 'print("hello")');
  port = await new Promise<number>((done, reject) => {
    const server = createServer(); server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') { server.close(); reject(new Error('port unavailable')); return; }
      server.close(() => done(address.port));
    });
  });
});
test.afterEach(async () => { await stopServer(); await rm(directory, { recursive: true, force: true }); });

test('keeps the CLI title fixed across files, split view, Git screens and pasted Markdown', async ({ page }) => {
  await startServer();
  for (const query of ['', '?path=code.py', '?path=README.md&right=code.py', '?view=changes', '?view=history', '?view=paste']) {
    await page.goto(url() + query);
    await expect(page.locator('#content')).toHaveAttribute('aria-busy', 'false');
    await expect(page).toHaveTitle(startupTitle);
  }
});

test('saves, restores, synchronizes and resets browser titles', async ({ page, context }) => {
  await startServer(); await page.goto(url()); await expect(page).toHaveTitle(startupTitle);
  await page.getByRole('button', { name: 'Tab title', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Tab title', exact: true });
  await dialog.getByLabel('Browser tab title').fill('  Browser notes  ');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click(); await expect(page).toHaveTitle('Browser notes');
  await page.reload(); await expect(page).toHaveTitle('Browser notes');
  const other = await context.newPage(); await other.goto(url()); await expect(other).toHaveTitle('Browser notes');
  await page.getByRole('button', { name: 'Tab title', exact: true }).click();
  await dialog.getByLabel('Browser tab title').fill('Unsaved'); await dialog.getByLabel('Browser tab title').press('Escape');
  await expect(dialog).not.toBeVisible(); await expect(page.getByRole('button', { name: 'Tab title', exact: true })).toBeFocused();
  await expect(page).toHaveTitle('Browser notes');
  await page.getByRole('button', { name: 'Tab title', exact: true }).click();
  await dialog.getByRole('button', { name: 'Reset', exact: true }).click();
  await expect(page).toHaveTitle(startupTitle); await expect(other).toHaveTitle(startupTitle);
  await other.close();
});

test('restores folder-specific titles after a restart or a different folder on the same port', async ({ page }) => {
  await startServer(); await page.goto(url()); await expect(page).toHaveTitle(startupTitle);
  await page.getByRole('button', { name: 'Tab title', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Tab title', exact: true });
  await dialog.getByLabel('Browser tab title').fill('Folder one'); await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await stopServer(); await startServer(directory, 'Restarted');
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(page).toHaveTitle('Folder one');
  await page.getByRole('button', { name: 'Tab title', exact: true }).click();
  await expect(dialog.getByLabel('Browser tab title')).toHaveAttribute('placeholder', 'Restarted');
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  const otherFolder = join(directory, 'other'); await mkdir(otherFolder); await writeFile(join(otherFolder, 'README.md'), '# Other');
  await stopServer(); await startServer(otherFolder, 'Folder two');
  await page.getByRole('button', { name: 'Refresh', exact: true }).click(); await expect(page).toHaveTitle('Folder two');
  await stopServer(); await startServer(directory); await page.reload(); await expect(page).toHaveTitle('Folder one');
});

test('offers mobile keyboard controls and returns to existing titles when unset', async ({ page }) => {
  await startServer(directory, ''); await page.setViewportSize({ width: 390, height: 844 }); await page.goto(url());
  await expect(page).toHaveTitle('README.md — markport');
  await page.getByRole('button', { name: 'App settings', exact: true }).click();
  await page.getByRole('button', { name: 'Tab title', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Tab title', exact: true });
  const input = dialog.getByLabel('Browser tab title'); await expect(input).toBeFocused();
  await input.fill('Mobile notes'); await input.press('Enter'); await expect(page).toHaveTitle('Mobile notes');
  await page.getByRole('button', { name: 'Tab title', exact: true }).click(); await input.fill('  '); await input.press('Enter');
  await expect(page).toHaveTitle('README.md — markport');
  await page.goto(url() + '?path=code.py'); await expect(page).toHaveTitle('code.py — markport');
});
