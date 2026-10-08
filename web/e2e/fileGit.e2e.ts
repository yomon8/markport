import { test, expect } from '@playwright/test';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir, devNull } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:net';

let directory: string; let cache: string; let port: number; let server: ChildProcess; let initial: string;
const git = (...args: string[]): string => execFileSync('git', ['-C', directory, ...args], { encoding: 'utf8', env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: devNull } }).trim();
const base = 'package main\n// staged base\n// working base\n' + Array.from({ length: 150 }, (_, index) => `// stable ${index}\n`).join('');
const working = base.replace('// staged base', '// staged edit').replace('// working base', '// working edit');

test.beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'markport-file-git-')); cache = await mkdtemp(join(tmpdir(), 'markport-file-git-cache-'));
  await new Promise<void>((done, reject) => {
    const listener = createServer(); listener.once('error', reject); listener.listen(0, '127.0.0.1', () => {
      const address = listener.address(); if (!address || typeof address === 'string') return reject(new Error('port unavailable'));
      port = address.port; listener.close(() => done());
    });
  });
  git('init', '-q'); git('config', 'user.name', 'File Test'); git('config', 'user.email', 'file@example.com'); git('config', 'gc.auto', '0'); git('config', 'maintenance.auto', 'false');
  await writeFile(join(directory, 'old name 日本語.md'), '# Original\n\n<script>historical source</script>\n');
  await writeFile(join(directory, 'a.go'), base); await writeFile(join(directory, 'b.go'), base.replace('package main', 'package other'));
  await writeFile(join(directory, 'wide.go'), base + `// ${'long source '.repeat(40)}\n`);
  git('add', '.'); git('commit', '-qm', 'initial files'); initial = git('rev-parse', 'HEAD');
  git('mv', 'old name 日本語.md', 'new.md'); git('commit', '-qm', 'rename docs');
  await writeFile(join(directory, 'new.md'), '# Updated\n\n<script>historical source</script>\n'); git('add', 'new.md'); git('commit', '-qm', 'edit docs');
  await writeFile(join(directory, 'a.go'), base.replace('// staged base', '// staged edit')); git('add', 'a.go'); await writeFile(join(directory, 'a.go'), working);
  server = spawn(resolve('../dist/markport'), [directory, '--port', String(port)], { stdio: 'ignore', env: { ...process.env, XDG_CACHE_HOME: cache, LOCALAPPDATA: cache } });
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
  if (directory) await rm(directory, { recursive: true, force: true }); if (cache) await rm(cache, { recursive: true, force: true });
});

test('file history follows renames and opens historical Diff and Source with browser navigation', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1600, height: 900 }); await page.goto(`http://127.0.0.1:${port}/?path=new.md`);
  await page.locator('#file-title').getByRole('button', { name: 'History', exact: true }).click();
  await expect(page.locator('#files-tab')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.file-history-list li')).toHaveCount(3);
  await expect(page.locator('.file-history-list')).toContainText('old name 日本語.md');
  await page.getByRole('link', { name: 'rename docs', exact: true }).click();
  await expect(page.locator('#content .diff-frame')).toContainText('rename from');
  await page.goBack(); await expect(page.locator('.file-history-list')).toBeVisible();
  await page.getByRole('link', { name: 'initial files', exact: true }).click();
  await page.locator('.revision-views').getByRole('link', { name: 'Source', exact: true }).click();
  await expect(page.locator('.historical-source')).toContainText('# Original');
  await expect(page.locator('.historical-source')).toContainText('<script>historical source</script>');
  await expect(page.locator('.historical-source script')).toHaveCount(0);
  expect(new URL(page.url()).searchParams.get('revision-path')).toBe('old name 日本語.md');
  await page.screenshot({ path: testInfo.outputPath('file-history-source.png') });
  await page.reload(); await expect(page.locator('.historical-source')).toContainText('# Original');
  await page.locator('#file-title').getByRole('button', { name: 'File', exact: true }).click(); await expect(page.locator('#content h1')).toHaveText('Updated');
});

test('Blame annotates staged and working edits and preserves independent split states', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto(`http://127.0.0.1:${port}/?path=a.go&view=blame&right=new.md&right-view=file-history`);
  await expect(page.locator('#content .blame-table tbody tr')).toHaveCount(153);
  await expect(page.locator('#content [data-blame-line="1"] .blame-meta')).toContainText(initial.slice(0, 7));
  await expect(page.locator('#content [data-blame-line="2"]')).toHaveClass('uncommitted'); await expect(page.locator('#content [data-blame-line="3"]')).toHaveClass('uncommitted');
  await expect(page.locator('#right-content .file-history-list li')).toHaveCount(3);
  await page.locator('#right-content').getByRole('link', { name: 'initial files', exact: true }).click();
  await page.locator('#right-content .revision-views').getByRole('link', { name: 'Source', exact: true }).click();
  await expect(page.locator('#right-content .historical-source')).toContainText('# Original');
  await page.locator('#right-swap').click();
  await expect(page.locator('#content .historical-source')).toContainText('# Original'); await expect(page.locator('#right-content .blame-table')).toBeVisible();
  expect(new URL(page.url()).searchParams.get('revision-path')).toBe('old name 日本語.md');
  await page.screenshot({ path: testInfo.outputPath('split-history-blame.png') });
  await page.locator('#right-only').click();
  await expect(page.locator('#content .blame-table')).toBeVisible(); await expect(page.locator('#right-pane')).toBeHidden();
  expect(new URL(page.url()).searchParams.get('view')).toBe('blame');
  await page.locator('#content .blame-meta a').first().click(); await expect(page.locator('.historical-source')).toContainText('// staged base');
  await page.goto(`http://127.0.0.1:${port}/?path=new.md&right=a.go&right-view=diff`);
  await expect(page.locator('#right-content .diff-frame')).toContainText('// staged edit');
  await expect(page.locator('#content h1')).toHaveText('Updated');
  await page.locator('#right-swap').click();
  await expect(page.locator('#content .diff-frame')).toContainText('// staged edit');
  await expect(page.locator('#right-content h1')).toHaveText('Updated');
});

test('both panes expose mobile file menus and Blame contains horizontal scrolling', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`http://127.0.0.1:${port}/?path=a.go&right=new.md`);
  await page.locator('#file-title').getByRole('button', { name: 'File actions', exact: true }).click();
  await page.locator('#file-title').getByRole('menuitemradio', { name: 'Blame', exact: true }).click();
  await expect(page.locator('#content .blame-table')).toBeVisible();
  await page.locator('#right-title').getByRole('button', { name: 'File actions', exact: true }).click();
  await page.locator('#right-title').getByRole('menuitemradio', { name: 'History', exact: true }).click();
  await expect(page.locator('#right-content .file-history-list')).toBeVisible();
  const fits = await page.locator('.blame-frame').evaluate((element) => element.clientWidth <= element.parentElement!.clientWidth);
  expect(fits).toBe(true); await page.screenshot({ path: testInfo.outputPath('mobile-history-blame.png') });
  await page.locator('#right-title').getByRole('button', { name: 'File actions', exact: true }).click();
  await page.locator('#right-title').getByRole('menuitemradio', { name: 'Blame', exact: true }).focus(); await page.keyboard.press('Enter');
  await expect(page.locator('#right-content .blame-table')).toBeVisible();
});

test('auto-refresh preserves Blame scroll and updates working lines after edits and commits', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 }); await page.goto(`http://127.0.0.1:${port}/?path=a.go&view=blame`);
  await expect(page.locator('.blame-table')).toBeVisible(); await page.locator('#main').evaluate((element) => { element.scrollTop = 400; });
  await writeFile(join(directory, 'a.go'), working.replace('// working edit', '// live update'));
  await expect(page.locator('[data-blame-line="3"] .blame-code')).toContainText('// live update');
  expect(await page.locator('#main').evaluate((element) => element.scrollTop)).toBeGreaterThan(300);
  git('add', 'a.go'); git('commit', '-qm', 'commit working edits');
  await expect(page.locator('[data-blame-line="3"]')).not.toHaveClass('uncommitted');
  await expect(page.locator('.blame-table')).toContainText(git('rev-parse', '--short=7', 'HEAD'));
});


test('restores both pane scroll positions through swaps, single-file display and browser Back', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto(`http://127.0.0.1:${port}/?path=a.go&view=blame&right=b.go&right-view=blame`);
  await expect(page.locator('#content .blame-table')).toBeVisible(); await expect(page.locator('#right-content .blame-table')).toBeVisible();
  await page.locator('#main').evaluate((element) => { element.scrollTop = 400; }); await page.locator('#right-pane').evaluate((element) => { element.scrollTop = 300; });
  await page.locator('#right-swap').click();
  await expect(page.locator('#file-title .breadcrumbs strong')).toHaveText('b.go');
  await expect.poll(() => page.locator('#main').evaluate((element) => element.scrollTop)).toBe(300);
  await expect.poll(() => page.locator('#right-pane').evaluate((element) => element.scrollTop)).toBe(400);
  await page.goBack();
  await expect(page.locator('#file-title .breadcrumbs strong')).toHaveText('a.go');
  await expect.poll(() => page.locator('#main').evaluate((element) => element.scrollTop)).toBe(400);
  await expect.poll(() => page.locator('#right-pane').evaluate((element) => element.scrollTop)).toBe(300);
  await page.locator('#right-only').click(); await expect(page.locator('#right-pane')).toBeHidden();
  await expect.poll(() => page.locator('#main').evaluate((element) => element.scrollTop)).toBe(300);
  await page.goBack(); await expect(page.locator('#right-pane')).toBeVisible();
  await expect.poll(() => page.locator('#main').evaluate((element) => element.scrollTop)).toBe(400);
  await expect.poll(() => page.locator('#right-pane').evaluate((element) => element.scrollTop)).toBe(300);
});

test('historical source uses the whole pane and compact gutters with local long-line scrolling', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  const source = `path=wide.go&view=file-history&commit=${initial}&revision-path=wide.go&revision-view=source`;
  await page.goto(`http://127.0.0.1:${port}/?${source}`);
  const frame = page.locator('#content .historical-source'); await expect(frame).toBeVisible();
  const width = await frame.evaluate((element) => ({ source: element.clientWidth, pane: element.parentElement!.clientWidth, gutter: element.querySelector('.lntd')!.getBoundingClientRect().width }));
  expect(width.source).toBeGreaterThan(900); expect(width.pane - width.source).toBeLessThan(3); expect(width.gutter).toBeLessThan(65);
  for (const viewport of [1600, 390, 320]) {
    await page.setViewportSize({ width: viewport, height: 900 });
    await page.goto(`http://127.0.0.1:${port}/?${source}&right=wide.go&right-view=file-history&right-commit=${initial}&right-revision-path=wide.go&right-revision-view=source`);
    for (const pane of ['#content', '#right-content']) {
      const sourceFrame = page.locator(`${pane} .historical-source`); await expect(sourceFrame).toBeVisible();
      const sizes = await sourceFrame.evaluate((element) => {
        const scroller = element.querySelector<HTMLElement>(':scope > .chroma')!;
        scroller.scrollLeft = 100;
        return { frame: element.getBoundingClientRect().width, pane: element.parentElement!.clientWidth, gutter: element.querySelector('.lntd')!.getBoundingClientRect().width, scrolled: scroller.scrollLeft };
      });
      expect(Math.abs(sizes.pane - sizes.frame)).toBeLessThan(3); expect(sizes.gutter).toBeLessThan(65); expect(sizes.scrolled).toBeGreaterThan(0);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.screenshot({ path: testInfo.outputPath('mobile-historical-source-width.png') });
});

test('Blame compacts by pane width and exposes accessible details in either pane', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto(`http://127.0.0.1:${port}/?path=wide.go&view=blame&right=wide.go&right-view=blame`);
  for (const pane of ['#content', '#right-content']) {
    const button = page.locator(pane).getByRole('button', { name: 'Last change details for line 1', exact: true });
    await expect(button).toBeVisible(); await expect(page.locator(`${pane} .blame-author`).first()).toBeHidden();
    await expect(page.locator(`${pane} .blame-meta time`).first()).toBeHidden();
    await button.focus(); await page.keyboard.press('Enter');
    const dialog = page.locator(pane).getByRole('dialog', { name: 'Last change details', exact: true });
    await expect(dialog).toBeVisible(); await expect(dialog).toContainText('File Test'); await expect(dialog).toContainText('initial files'); await expect(dialog).toContainText('wide.go');
    await expect(dialog.getByRole('button', { name: 'Close', exact: true })).toBeFocused();
    await page.keyboard.press('Escape'); await expect(dialog).toBeHidden(); await expect(button).toBeFocused();
  }
  await page.screenshot({ path: testInfo.outputPath('split-compact-blame.png') });
  await page.setViewportSize({ width: 2400, height: 900 });
  for (const pane of ['#content', '#right-content']) {
    await expect(page.locator(`${pane} .blame-author`).first()).toBeVisible(); await expect(page.locator(`${pane} .blame-details-button`).first()).toBeHidden();
  }
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    for (const pane of ['#content', '#right-content']) {
      const frame = page.locator(`${pane} .blame-frame`); await expect(frame).toBeVisible();
      const sizes = await frame.evaluate((element) => {
        const rect = element.getBoundingClientRect(); const start = element.querySelector('.blame-code')!.getBoundingClientRect().left;
        const meta = element.querySelector('.blame-meta')!.getBoundingClientRect().width;
        const gutter = element.querySelector('.blame-number')!.getBoundingClientRect().width;
        element.scrollLeft = 100;
        return { available: rect.right - start, width: rect.width, meta, gutter, scrolled: element.scrollLeft };
      });
      expect(sizes.meta).toBeLessThanOrEqual(121); expect(sizes.gutter).toBeLessThan(50); expect(sizes.available).toBeGreaterThan(width === 390 ? sizes.width / 2 : 110); expect(sizes.scrolled).toBeGreaterThan(0);
      await frame.evaluate((element) => { element.scrollLeft = 0; });
      const button = page.locator(`${pane} .blame-details-button`).first();
      expect(await button.evaluate((element) => element.getBoundingClientRect().height)).toBeGreaterThanOrEqual(40);
      await button.click(); const dialog = page.locator(`${pane} .blame-details`); await expect(dialog).toBeVisible();
      await dialog.getByRole('button', { name: 'Close', exact: true }).click(); await expect(button).toBeFocused();
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.screenshot({ path: testInfo.outputPath('mobile-compact-blame.png') });
});
