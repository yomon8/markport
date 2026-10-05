import { test, expect, type Page } from '@playwright/test';
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:net';

let directory: string;
let port: number;
let server: ChildProcess;
const markdown = '# Theme demo\n\n```go\n// A comment\npackage main\nfunc main() { println("Hello") }\n```\n\n```mermaid\nflowchart LR\n  A[Read] --> B[Review]\n```\n\n' + 'A paragraph for scrolling.\n\n'.repeat(80);
const presets = [
  { label: 'Sepia', id: 'sepia', scheme: 'light', background: 'rgb(244, 236, 216)', node: 'rgb(229, 214, 184)', string: 'rgb(70, 99, 56)' },
  { label: 'Nord', id: 'nord', scheme: 'dark', background: 'rgb(46, 52, 64)', node: 'rgb(57, 66, 82)', string: 'rgb(163, 190, 140)' },
  { label: 'Catppuccin Mocha', id: 'catppuccin-mocha', scheme: 'dark', background: 'rgb(30, 30, 46)', node: 'rgb(49, 50, 68)', string: 'rgb(166, 227, 161)' },
  { label: 'Solarized Light', id: 'solarized-light', scheme: 'light', background: 'rgb(253, 246, 227)', node: 'rgb(228, 232, 217)', string: 'rgb(20, 108, 102)' },
  { label: 'Rosé Pine Dawn', id: 'rose-pine-dawn', scheme: 'light', background: 'rgb(250, 244, 237)', node: 'rgb(238, 228, 229)', string: 'rgb(56, 107, 90)' },
  { label: 'Tokyo Night', id: 'tokyo-night', scheme: 'dark', background: 'rgb(26, 27, 38)', node: 'rgb(37, 43, 64)', string: 'rgb(158, 206, 106)' },
  { label: 'Tokyo Night Light', id: 'tokyo-night-light', scheme: 'light', background: 'rgb(225, 226, 231)', node: 'rgb(211, 218, 234)', string: 'rgb(72, 99, 47)' },
] as const;

const url = (query: string): string => `http://127.0.0.1:${port}/${query}`;
async function choose(page: Page, label: string): Promise<void> {
  if (!(await page.locator('#theme-toggle').isVisible())) await page.getByRole('button', { name: 'App settings' }).click();
  await page.locator('#theme-toggle').click();
  await page.getByRole('menuitemradio', { name: label, exact: true }).click();
}

test.beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'markport-themes-'));
  await writeFile(join(directory, 'demo.md'), markdown);
  await writeFile(join(directory, 'sample.go'), 'package main\n\n// A comment\nfunc main() { println("Hello") }\n' + '// Another line\n'.repeat(120));
  await writeFile(join(directory, 'preview.html'), '<!doctype html><body style="background:#ff8080"><h1>Document colors</h1></body>');
  const git = (...args: string[]): void => {
    execFileSync('git', ['-C', directory, '-c', 'user.name=Test', '-c', 'user.email=test@example.com', '-c', 'commit.gpgsign=false', ...args], { stdio: 'ignore' });
  };
  git('init', '-q'); git('add', '.'); git('commit', '-qm', 'initial');
  await writeFile(join(directory, 'sample.go'), 'package main\n\nfunc main() { println("Updated") }\n');
  port = await new Promise<number>((done, fail) => {
    const listener = createServer(); listener.once('error', fail);
    listener.listen(0, '127.0.0.1', () => {
      const address = listener.address();
      if (!address || typeof address === 'string') return fail(new Error('port unavailable'));
      listener.close(() => done(address.port));
    });
  });
  server = spawn(resolve('../dist/markport'), [directory, '--port', String(port)], { stdio: 'ignore' });
  for (let attempt = 0; attempt < 100; attempt++) {
    try { if ((await fetch(url('api/tree'))).ok) return; } catch { /* Starting. */ }
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

for (const width of [1280, 390, 320]) {
  test(`theme choices, persistence, code, diagrams, and previews at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 844 });
    await page.emulateMedia({ colorScheme: 'light' });
    await page.goto(url('?path=demo.md&right=demo.md'));
    for (const pane of ['#content', '#right-content']) await expect(page.locator(`${pane} .diagram-image svg`)).toBeVisible();
    if (width <= 700) await page.getByRole('button', { name: 'App settings' }).click();
    await page.locator('#theme-toggle').click();
    const menu = await page.locator('#theme-menu').boundingBox();
    expect(menu!.x).toBeGreaterThanOrEqual(0);
    expect(menu!.x + menu!.width).toBeLessThanOrEqual(width);
    await expect(page.getByRole('menuitemradio')).toHaveText(['Auto', 'Light', 'Dark', 'Sepia', 'Nord', 'Catppuccin Mocha', 'Solarized Light', 'Rosé Pine Dawn', 'Tokyo Night', 'Tokyo Night Light']);
    await page.keyboard.press('End'); await expect(page.getByRole('menuitemradio', { name: 'Tokyo Night Light', exact: true })).toBeFocused();
    await page.keyboard.press('Home'); await expect(page.getByRole('menuitemradio', { name: 'Auto', exact: true })).toBeFocused();
    await page.keyboard.press('Escape'); await expect(page.locator('#theme-toggle')).toBeFocused();
    for (const preset of presets) {
      await choose(page, preset.label);
      await expect(page.locator('html')).toHaveAttribute('data-theme', preset.id);
      await expect(page.locator('html')).toHaveAttribute('data-color-scheme', preset.scheme);
      await expect(page.locator('body')).toHaveCSS('background-color', preset.background);
      const placeholder = await page.locator('#search').evaluate((input) => getComputedStyle(input, '::placeholder').color);
      expect(placeholder).toBe(await page.locator('html').evaluate((root) => {
        const probe = document.createElement('span'); probe.style.color = 'var(--text-muted)'; root.append(probe);
        const color = getComputedStyle(probe).color; probe.remove(); return color;
      }));
      for (const pane of ['#content', '#right-content']) {
        await expect(page.locator(`${pane} .diagram-image .node rect`).first()).toHaveCSS('fill', preset.node);
        await expect(page.locator(`${pane} .chroma .s`).first()).toHaveCSS('color', preset.string);
      }
      await page.screenshot({ path: testInfo.outputPath(`${width}-${preset.id}.png`) });
      await page.reload();
      await expect(page.locator('html')).toHaveAttribute('data-theme', preset.id);
      await expect(page.locator('#content .diagram-image .node rect').first()).toHaveCSS('fill', preset.node);
      const brand = await page.locator('.brand-symbol').evaluate(async (image: HTMLImageElement) => (await fetch(image.src)).text());
      expect(brand).toContain(preset.scheme === 'dark' ? '#75B7FF' : '#0969DA');
      await page.locator('#content [data-diagram-action=expand]').click();
      await expect(page.locator('#diagram-overlay .node rect').first()).toHaveCSS('fill', preset.node);
      await page.keyboard.press('Escape');
    }
    await page.goto(url('?path=sample.go&view=diff'));
    await expect(page.locator('.diff-added').first()).toBeVisible();
    const diffColors = [
      ['rgb(43, 59, 54)', 'rgb(64, 43, 61)'],
      ['rgb(225, 232, 203)', 'rgb(247, 228, 213)'],
      ['rgb(224, 233, 221)', 'rgb(243, 224, 227)'],
      ['rgb(41, 58, 50)', 'rgb(60, 40, 60)'],
      ['rgb(213, 223, 202)', 'rgb(235, 213, 222)'],
    ];
    for (const [index, preset] of presets.slice(2).entries()) {
      await choose(page, preset.label);
      await expect(page.locator('.diff-added').first()).toHaveCSS('background-color', diffColors[index][0]);
      await expect(page.locator('.diff-deleted').first()).toHaveCSS('background-color', diffColors[index][1]);
    }
    await page.goto(url('?path=preview.html'));
    await expect(page.frameLocator('.html-preview').locator('body')).toHaveCSS('background-color', 'rgb(255, 128, 128)');
    await expect(page.locator('.html-preview')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
    await choose(page, 'Nord');
    await expect(page.frameLocator('.html-preview').locator('body')).toHaveCSS('background-color', 'rgb(255, 128, 128)');
    await expect(page.locator('.html-preview')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  });
}

test('keeps split-pane scroll positions and the right source mode when changing themes', async ({ page }) => {
  await page.goto(url('?path=demo.md&right=demo.md'));
  await expect(page.locator('#content .diagram-image svg')).toBeVisible();
  await page.locator('#right-source').click();
  await expect(page.locator('#right-content')).toHaveAttribute('data-kind', 'code');
  await page.locator('#main').evaluate((pane) => { pane.scrollTop = 150; });
  await page.locator('#right-pane').evaluate((pane) => { pane.scrollTop = 250; });
  for (const preset of presets.slice(2)) {
    await choose(page, preset.label);
    await expect(page.locator('#content .diagram-image .node rect').first()).toHaveCSS('fill', preset.node);
    expect(await page.locator('#main').evaluate((pane) => pane.scrollTop)).toBe(150);
    expect(await page.locator('#right-pane').evaluate((pane) => pane.scrollTop)).toBe(250);
    await expect(page.locator('#right-source')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#right-content .diagram-image')).toHaveCount(0);
  }
});

test('switches pasted diagrams without changing input or source controls', async ({ page }) => {
  await page.goto(url('?view=paste'));
  await page.locator('#paste-input').fill(markdown);
  await page.getByRole('button', { name: 'Rendered view' }).click();
  await expect(page.locator('#content .diagram-image svg')).toBeVisible();
  await page.locator('#content [data-diagram-action=source]').click();
  await expect(page.locator('.diagram-source')).toBeVisible();
  await page.locator('#main').evaluate((main) => { main.scrollTop = 300; });
  for (const preset of presets.slice(2)) {
    await choose(page, preset.label);
    await expect(page.locator('#content .diagram-image .node rect').first()).toHaveCSS('fill', preset.node);
    await expect(page.locator('.diagram-source')).toBeVisible();
    expect(await page.locator('#main').evaluate((main) => main.scrollTop)).toBe(300);
  }
  await page.getByRole('button', { name: 'Markdown Text', exact: true }).click();
  await expect(page.locator('#paste-input')).toHaveValue(markdown);
});

test('updates an expanded diagram on an Auto OS change', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto(url('?path=demo.md'));
  await expect(page.locator('#content .diagram-image svg')).toBeVisible();
  await page.locator('#content [data-diagram-action=expand]').click();
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  const zoom = await page.locator('#overlay-zoom-status').textContent();
  const light = await page.locator('#overlay-content .node rect').first().evaluate((node) => getComputedStyle(node).fill);
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect.poll(() => page.locator('#overlay-content .node rect').first().evaluate((node) => getComputedStyle(node).fill)).not.toBe(light);
  await expect(page.locator('#diagram-overlay')).toBeVisible(); await expect(page.locator('#overlay-zoom-status')).toHaveText(zoom!);
});
