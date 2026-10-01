// Regenerates the README screenshots. Run it with `make screenshots`; it is not part of `make test-e2e`.
import { test, expect, type Page } from '@playwright/test';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:net';

const output = resolve('../docs/screenshots');
const desktop = { width: 1280, height: 800 };
let workspace: string;
let directory: string;
let port: number;
let serverProcess: ChildProcess;

function git(...args: string[]): void {
  execFileSync('git', ['-C', directory, '-c', 'user.name=Markport', '-c', 'user.email=markport@example.com', '-c', 'commit.gpgsign=false', ...args], {
    stdio: 'ignore', env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' },
  });
}

async function freePort(): Promise<number> {
  return new Promise((done, fail) => {
    const server = createServer();
    server.once('error', fail);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') return fail(new Error('port unavailable'));
      server.close(() => done(address.port));
    });
  });
}

test.beforeAll(async () => {
  workspace = await mkdtemp(join(tmpdir(), 'markport-shots-'));
  directory = join(workspace, 'markport-demo');
  await cp(resolve('../testdata'), directory, { recursive: true });
  await mkdir(join(directory, 'notes'));
  await writeFile(join(directory, 'notes', 'todo.md'), '# Todo\n\n- [x] Write the guide\n- [ ] Review the diagrams\n');
  git('init', '-q');
  git('add', '.');
  git('commit', '-q', '-m', 'Add sample content');
  const readme = await readFile(join(directory, 'README.md'), 'utf8');
  await writeFile(join(directory, 'README.md'), readme.replace('Further review', 'Further review by the team').replace('Ready', 'Ready for review'));
  await writeFile(join(directory, 'sample.py'), 'print("Hello from markport")\nprint("A second line")\n');
  await writeFile(join(directory, 'notes', 'plan.md'), '# Plan\n\nCompare the sample files, then mark each one as reviewed.\n');
  port = await freePort();
  serverProcess = spawn(resolve('../dist/markport'), [directory, '--port', String(port)], { stdio: 'ignore' });
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(`http://127.0.0.1:${port}/api/tree`)).ok) return; } catch { /* Starting. */ }
    await new Promise((wait) => setTimeout(wait, 50));
  }
  throw new Error('server did not start');
});

test.afterAll(async () => {
  serverProcess?.kill('SIGTERM');
  await rm(workspace, { recursive: true, force: true });
});

const url = (query: string): string => `http://127.0.0.1:${port}/${query}`;

async function useTheme(page: Page, theme: 'light' | 'dark' | 'sepia' | 'nord'): Promise<void> {
  await page.addInitScript((value) => localStorage.setItem('markport-theme', value), theme);
}

async function searchContent(page: Page): Promise<void> {
  await page.goto(url('?path=README.md'));
  await page.locator('#content-search summary').click();
  await page.locator('#content-query').fill('markport');
  await page.locator('#content-search').getByRole('button', { name: 'Search' }).click();
  await expect(page.locator('.content-search-results a').first()).toBeVisible();
}

test.use({ viewport: desktop, deviceScaleFactor: 1 });

test('content search', async ({ page }) => {
  await useTheme(page, 'light');
  await searchContent(page);
  await page.screenshot({ path: join(output, 'content-search.png') });
});

test('content search in the dark theme', async ({ page }) => {
  await useTheme(page, 'dark');
  await searchContent(page);
  await page.screenshot({ path: join(output, 'content-search-dark.png') });
});

for (const theme of ['sepia', 'nord'] as const) {
  test(`content search in the ${theme} theme`, async ({ page }) => {
    await useTheme(page, theme);
    await searchContent(page);
    await page.screenshot({ path: join(output, `content-search-${theme}.png`) });
  });
}

test('split view', async ({ page }) => {
  await useTheme(page, 'light');
  await page.goto(url('?path=README.md&right=sample.py'));
  await expect(page.locator('#right-content')).toContainText('Hello from markport');
  await page.screenshot({ path: join(output, 'split-view.png') });
});

test('reviewed changes', async ({ page }) => {
  await useTheme(page, 'light');
  await page.goto(url('?view=changes'));
  const buttons = page.locator('#content .review-toggle');
  await expect(buttons).toHaveCount(3);
  await buttons.first().click();
  await expect(page.locator('#content .review-toggle[aria-pressed=true]')).toHaveCount(1);
  await page.screenshot({ path: join(output, 'reviewed-changes.png') });
});

test('pasted markdown', async ({ page }) => {
  await useTheme(page, 'light');
  await page.goto(url('?view=paste'));
  await page.locator('#paste-input').fill('# Release notes\n\n- **Fast:** files refresh as they change\n- **Safe:** everything stays read-only\n\n| Area | Status |\n| --- | --- |\n| Search | Done |\n| Review | Done |\n');
  await page.getByRole('button', { name: 'Rendered view' }).click();
  await expect(page.locator('.paste-preview')).toBeVisible();
  await page.screenshot({ path: join(output, 'pasted-markdown.png') });
});

test('mobile', async ({ page }) => {
  await useTheme(page, 'light');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(url('?path=README.md'));
  await expect(page.locator('#content h1')).toBeVisible();
  await page.screenshot({ path: join(output, 'mobile.png') });
});
