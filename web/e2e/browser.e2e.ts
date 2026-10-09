import { test, expect } from '@playwright/test';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, mkdir, readFile, realpath, rename, writeFile, unlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:net';

let directory: string;
let cacheDirectory: string;
let port: number;
let serverProcess: ChildProcess;

test('prints Markdown with Mermaid, math, images and paginated text without changing the display theme', async ({ page, context }, testInfo) => {
  test.setTimeout(60000);
  const markdown = '# 日本語 Print document\n\n```mermaid\nflowchart LR\n A[開始] --> B[完了]\n```\n\n```mermaid\nsequenceDiagram\n Alice->>Bob: Hello\n```\n\n$$x^2 + y^2 = z^2$$\n\n![Relative image](image.png)\n\n'
    + '| Heading | Value |\n|---|---|\n' + '| Long table row | readable value |\n'.repeat(65)
    + '\n```typescript\nconst readableLongLine = "' + 'long '.repeat(80) + '";\n```\n\n'
    + ('Paragraph with searchable text.\n\n'.repeat(50)) + '## Document end\n\nFinal paragraph.\n';
  await writeFile(join(directory, 'print-document.md'), markdown);
  await page.goto(`http://127.0.0.1:${port}/?path=print-document.md`);
  await page.getByRole('button', { name: /^Theme:/ }).click(); await page.getByRole('menuitemradio', { name: 'Dark', exact: true }).click();
  const open = page.locator('#file-title').getByRole('button', { name: 'Print / Save as PDF' });
  await open.click(); const dialog = page.getByRole('dialog', { name: 'Print view', exact: true });
  const frame = page.frameLocator('#print-view iframe');
  await expect(dialog.getByRole('button', { name: 'Print / Save as PDF' })).toBeEnabled({ timeout: 30000 });
  await expect(frame.locator('[data-mermaid] .diagram-image svg')).toHaveCount(2);
  await expect(frame.locator('.katex')).toHaveCount(1); await expect(frame.getByRole('heading', { name: 'Document end' })).toBeVisible();
  expect(await frame.locator('img').evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
  expect(await frame.locator('body').evaluate((body) => getComputedStyle(body).backgroundColor)).toBe('rgb(255, 255, 255)');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(frame.locator('button, textarea')).toHaveCount(0);
  // Register from the parent: scripts inside the printable frame are disabled.
  await page.evaluate(() => {
    const iframe = document.querySelector<HTMLIFrameElement>('#print-view iframe')!;
    iframe.contentWindow!.addEventListener('beforeprint', () => { iframe.contentDocument!.body.dataset.printCalled = 'true'; });
  });
  await dialog.screenshot({ path: testInfo.outputPath('print-view.png') });
  await dialog.getByRole('button', { name: 'Print / Save as PDF' }).click();
  await expect(frame.locator('body')).toHaveAttribute('data-print-called', 'true'); await expect(dialog).toBeVisible();
  // Use the exact printable document as a top-level page for Chromium's PDF API.
  const printableHTML = await frame.locator('html').evaluate((html) => html.outerHTML);
  const pdfPage = await context.newPage(); await pdfPage.setContent(printableHTML);
  await pdfPage.evaluate(async () => { await document.fonts.ready; await Promise.all([...document.images].map((image) => image.decode())); });
  await pdfPage.emulateMedia({ media: 'print' });
  expect(await pdfPage.locator('article').evaluate((article) => article.scrollWidth <= article.clientWidth)).toBe(true);
  await pdfPage.screenshot({ path: testInfo.outputPath('print-document.png'), fullPage: true });
  const pdf = await pdfPage.pdf({ path: testInfo.outputPath('print-document.pdf'), format: 'A4', printBackground: true });
  expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
  expect((pdf.toString('latin1').match(/\/Type \/Page\b/g) ?? []).length).toBeGreaterThan(2);
  await pdfPage.close();
  await dialog.getByRole('button', { name: 'Close' }).click(); await expect(open).toBeFocused();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});

test('prints each split pane from Source and exposes the action in the mobile file menu', async ({ page }) => {
  await writeFile(join(directory, 'print-left.md'), '# Left snapshot\n'); await writeFile(join(directory, 'print-right.md'), '# Right snapshot\n');
  await page.goto(`http://127.0.0.1:${port}/?path=print-left.md&right=print-right.md&source=1`);
  await page.locator('#right-source').click();
  for (const [selector, heading] of [['#file-title', 'Left snapshot'], ['#right-title', 'Right snapshot']]) {
    await page.locator(selector).getByRole('button', { name: 'Print / Save as PDF' }).click();
    await expect(page.frameLocator('#print-view iframe').getByRole('heading', { name: heading })).toBeVisible();
    await expect(page.locator('#print-submit')).toBeEnabled(); await page.locator('#print-close').click();
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`http://127.0.0.1:${port}/?path=print-left.md`);
  const actions = page.getByRole('button', { name: 'File actions' }); await actions.click();
  await page.getByRole('menuitem', { name: 'Print / Save as PDF' }).click();
  await expect(page.frameLocator('#print-view iframe').getByRole('heading', { name: 'Left snapshot' })).toBeVisible();
  await expect(page.locator('#print-submit')).toBeEnabled(); await page.locator('#print-close').click(); await expect(actions).toBeFocused();
});

test('prints latest pasted input from all paste views and includes individual display errors', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`http://127.0.0.1:${port}/?view=paste`);
  const input = page.getByLabel('Markdown Text');
  for (const view of ['Text', 'Split', 'Rendered']) {
    await input.fill(`# Latest ${view}\n\n\`\`\`mermaid\nflowchart LR\n A --> B\n\`\`\`\n`);
    if (view !== 'Text') await page.getByRole('button', { name: view, exact: true }).click();
    await page.getByRole('button', { name: 'Paste options' }).click();
    await page.getByRole('button', { name: 'Print / Save as PDF', exact: true }).click();
    await expect(page.locator('#print-submit')).toBeEnabled({ timeout: 15000 });
    await expect(page.frameLocator('#print-view iframe').getByRole('heading', { name: `Latest ${view}` })).toBeVisible();
    await expect(page.frameLocator('#print-view iframe').locator('[data-mermaid] .diagram-image svg')).toHaveCount(1);
    await page.locator('#print-close').click();
    if (view !== 'Text') await page.getByRole('button', { name: 'Text', exact: true }).click();
  }
  await input.fill('# Errors\n\n```mermaid\nflowchart LR\n A -->\n```\n\n![Missing](https://missing.example.test/image.png)');
  await page.route('https://missing.example.test/**', (route) => route.abort());
  await page.getByRole('button', { name: 'Paste options' }).click(); await page.getByRole('button', { name: 'Print / Save as PDF', exact: true }).click();
  await expect(page.locator('#print-submit')).toBeEnabled({ timeout: 15000 });
  await expect(page.locator('.print-status')).toContainText('errors are included');
  await expect(page.frameLocator('#print-view iframe').locator('.diagram-error')).toBeVisible();
  await expect(page.frameLocator('#print-view iframe').locator('details pre')).toContainText('A -->');
  await expect(page.frameLocator('#print-view iframe').locator('.image-error')).toContainText('Missing');
});

test('shows print request failures and retries the original file', async ({ page }) => {
  await writeFile(join(directory, 'print-retry.md'), '# Retry document\n');
  await page.goto(`http://127.0.0.1:${port}/?path=print-retry.md`);
  await expect(page.locator('#content h1')).toHaveText('Retry document');
  await page.route('**/api/file?path=print-retry.md', (route) => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'Temporarily unavailable' }) }), { times: 1 });
  await page.locator('#file-title').getByRole('button', { name: 'Print / Save as PDF' }).click();
  await expect(page.locator('.print-status')).toHaveText('Temporarily unavailable'); await expect(page.locator('#print-submit')).toBeDisabled();
  await page.getByRole('button', { name: 'Retry', exact: true }).click(); await expect(page.locator('#print-submit')).toBeEnabled();
  await expect(page.frameLocator('#print-view iframe').getByRole('heading', { name: 'Retry document' })).toBeVisible();
});

test('fits wide and tall Mermaid diagrams to print pages and closes with Escape from the document', async ({ page, context }, testInfo) => {
  const chain = Array.from({ length: 25 }, (_, index) => `N${index}[Node ${index}]`).join(' --> ');
  await writeFile(join(directory, 'print-large.md'), `# Large diagrams\n\n\`\`\`mermaid\nflowchart LR\n${chain}\n\`\`\`\n\n\`\`\`mermaid\nflowchart TD\n${chain}\n\`\`\`\n\n## Final heading\n`);
  await page.goto(`http://127.0.0.1:${port}/?path=print-large.md`);
  const open = page.locator('#file-title').getByRole('button', { name: 'Print / Save as PDF' }); await open.click();
  await expect(page.locator('#print-submit')).toBeEnabled({ timeout: 15000 });
  const frame = page.frameLocator('#print-view iframe'); await expect(frame.locator('[data-mermaid] .diagram-image svg')).toHaveCount(2);
  const html = await frame.locator('html').evaluate((element) => element.outerHTML);
  const pdfPage = await context.newPage(); await pdfPage.setContent(html); await pdfPage.emulateMedia({ media: 'print' });
  const geometry = await pdfPage.locator('.diagram-image svg').evaluateAll((diagrams) => diagrams.map((svg) => {
    const bounds = svg.getBoundingClientRect(); const parent = svg.closest('article')!.getBoundingClientRect();
    return { fits: bounds.width <= parent.width, height: bounds.height, maxHeight: parseFloat(getComputedStyle(svg).maxHeight) };
  }));
  for (const diagram of geometry) { expect(diagram.fits).toBe(true); expect(diagram.height).toBeLessThanOrEqual(diagram.maxHeight); }
  await pdfPage.pdf({ path: testInfo.outputPath('large-diagrams.pdf'), format: 'A4', printBackground: true }); await pdfPage.close();
  await frame.locator('body').click(); await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Print view', exact: true })).not.toBeVisible(); await expect(open).toBeFocused();
});

function pdfFixture(label: string): Buffer {
  const stream = `BT /F1 24 Tf 72 720 Td (${label}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ];
  let body = '%PDF-1.4\n';
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(body));
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = Buffer.byteLength(body);
  body += `xref\n0 ${offsets.length}\n0000000000 65535 f \n`;
  body += offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  body += `trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body);
}

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
  serverProcess = spawn(resolve('../dist/markport'), [directory, '--port', String(port)], { stdio: 'ignore', env: { ...process.env, XDG_CACHE_HOME: cacheDirectory, LOCALAPPDATA: cacheDirectory } });
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
  cacheDirectory = await mkdtemp(join(tmpdir(), 'markport-e2e-cache-'));
  port = await freePort();
  await writeFile(join(directory, 'README.md'), '# Demo\n\n[Jump](#section)\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n- [x] done\n\n[Python](sample.py)\n\n[PDF](docs/sample.pdf)\n\n![Image](image.svg)\n\n## Section\n\n```mermaid\nflowchart LR\n  A --> B\n```\n');
  await writeFile(join(directory, 'sample.py'), 'print("first")\n');
  await writeFile(join(directory, 'image.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="30"><rect width="40" height="30" fill="blue"/></svg>');
  await writeFile(join(directory, 'image.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/c4sAAAAASUVORK5CYII=', 'base64'));
  await mkdir(join(directory, 'docs'));
  await writeFile(join(directory, 'docs', 'sample.pdf'), pdfFixture('First PDF'));
  await writeFile(join(directory, 'docs', 'style.css'), 'h1 { color: rgb(10, 20, 30) }');
  await writeFile(join(directory, 'docs', 'first.html'), '<!doctype html><html><head><link rel="stylesheet" href="style.css"><link rel="stylesheet" href="https://cdn.example.test/external.css"></head><body><h1>HTML preview</h1><img src="../image.png"><img src="https://cdn.example.test/external.png"><script>window.previewScriptRan = true</script><a href="second.htm">Next HTML</a></body></html>');
  await writeFile(join(directory, 'docs', 'second.htm'), '<!doctype html><html><body><h1>Second HTML</h1></body></html>');
  await writeFile(join(directory, 'docs', 'transparent.html'), '<!doctype html><html><body style="background:transparent"><h1>Transparent HTML</h1></body></html>');
  await writeFile(join(directory, 'docs', 'colored.html'), '<!doctype html><html><body style="background:#ff8080"><h1>Colored HTML</h1></body></html>');
  await writeFile(join(directory, 'docs', 'interactive.js'), 'document.body.dataset.localScript = "ready";');
  await writeFile(join(directory, 'docs', 'interactive.mjs'), 'document.body.dataset.moduleScript = "ready";');
  await writeFile(join(directory, 'docs', 'interactive.html'), `<!doctype html><html><head></head><body>
    <nav><button type="button" data-mode="all" aria-pressed="true">All</button><button type="button" data-mode="public" aria-pressed="false">Public</button><button type="button" data-mode="internal" aria-pressed="false">Internal</button><button type="button" id="print">Print</button></nav>
    <div data-flow="public internal"></div><div data-flow="internal"></div><a href="second.htm">Next HTML</a>
    <script src="interactive.js"></script><script type="module" src="interactive.mjs"></script><script src="https://cdn.example.test/external.js"></script><script>
      document.body.dataset.parentAccess = String((function(){try{return !!parent.document.body}catch{return false}})());
      fetch('/api/tree').then(() => document.body.dataset.networkAccess = 'allowed', () => document.body.dataset.networkAccess = 'blocked');
      for (const button of document.querySelectorAll('[data-mode]')) button.addEventListener('click', () => {
        for (const item of document.querySelectorAll('[data-mode]')) item.setAttribute('aria-pressed', String(item === button));
        for (const path of document.querySelectorAll('[data-flow]')) path.classList.toggle('dim', button.dataset.mode !== 'all' && !path.dataset.flow.split(' ').includes(button.dataset.mode));
      });
      document.querySelector('#print').addEventListener('click', () => window.print());
    </script></body></html>`);
  await startServer();
});

test.afterAll(async () => {
  await stopServer();
  if (directory) await rm(directory, { recursive: true, force: true });
  if (cacheDirectory) await rm(cacheDirectory, { recursive: true, force: true });
});

test('renders LaTeX in both panes, source, updates, themes, and mobile', async ({ page }, testInfo) => {
  const markdown = '# Math $x_1$\n\n## Second\n\n### Third\n\nInline $x_1$ and \\(x_2\\).\n\n$$\n\\frac{1}{2}\n$$\n\n\\[x_3\\]\n\n$$' + Array(90).fill('x').join('+') + '$$\n\n`$literal$` and $5 and $10\n\n$\\unknowncommand$\n';
  await writeFile(join(directory, 'math.md'), markdown);
  const remote: string[] = [];
  const requests: string[] = [];
  page.on('request', (request) => { requests.push(request.url()); if (!request.url().startsWith(`http://127.0.0.1:${port}/`)) remote.push(request.url()); });
  await page.goto(`http://127.0.0.1:${port}/?path=math.md&right=math.md`);
  for (const pane of ['#content', '#right-content']) {
    await expect(page.locator(`${pane} .katex`)).toHaveCount(6);
    await expect(page.locator(`${pane} .math-error`)).toHaveCount(1);
    await expect(page.locator(`${pane} code`)).toContainText('$literal$');
    await expect(page.locator(pane)).toContainText('$5 and $10');
  }
  await expect(page.locator('#outline a').first()).toHaveText('Math $x_1$');
  await expect(page.locator('#right-outline a').first()).toHaveText('Math $x_1$');
  await page.evaluate(async () => { await document.fonts.ready; });
  expect(requests.some((url) => /KaTeX.*\.woff2/.test(url))).toBe(true);
  expect(remote).toEqual([]);
  await page.locator('#file-title .view-segment').getByRole('button', { name: 'Source' }).click();
  await expect(page.locator('#content .katex')).toHaveCount(0);
  await expect(page.locator('#content')).toContainText('$x_1$');
  await page.locator('#file-title .view-segment').getByRole('button', { name: 'Preview' }).click();
  await expect(page.locator('#content .katex')).toHaveCount(6);
  await page.locator('#right-source').click();
  await expect(page.locator('#right-content .katex')).toHaveCount(0);
  await page.locator('#right-rendered').click();
  await expect(page.locator('#right-content .katex')).toHaveCount(6);
  await writeFile(join(directory, 'math.md'), markdown.replace('\\frac{1}{2}', '\\frac{3}{4}'));
  await page.locator('#reload').click();
  for (const pane of ['#content', '#right-content']) await expect(page.locator(`${pane} [data-math-source]`).filter({ has: page.locator('math annotation', { hasText: '\\frac{3}{4}' }) })).toHaveCount(1);
  for (const theme of ['dark', 'light']) {
    await page.locator('#theme-toggle').click();
    await page.getByRole('menuitemradio', { name: theme === 'dark' ? 'Dark' : 'Light', exact: true }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    const colors = await page.locator('#content').evaluate((article) => [getComputedStyle(article).color, getComputedStyle(article.querySelector('.katex')!).color]);
    expect(colors[0]).toBe(colors[1]);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => { document.querySelector('#main')!.scrollTop = 0; document.querySelector('#right-pane')!.scrollTop = 0; });
  const long = page.locator('#content [data-math="display"]').last();
  expect(await long.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('latex-mobile.png'), fullPage: true, animations: 'disabled' });
});

test('renders pasted math and survives cached preview toggles', async ({ page }) => {
  await page.goto(`http://127.0.0.1:${port}/?path=sample.py`);
  await page.getByRole('button', { name: 'Paste Markdown' }).click();
  await page.getByLabel('Markdown Text').fill('$x_1$ and \\(x_2\\)\n\n$$\\frac{1}{2}$$\n\n\\[x_3\\]');
  await page.getByRole('button', { name: 'Rendered', exact: true }).click();
  await expect(page.locator('.paste-preview .katex')).toHaveCount(4);
  await page.getByRole('button', { name: 'Text', exact: true }).click();
  await page.getByRole('button', { name: 'Rendered', exact: true }).click();
  await expect(page.locator('.paste-preview .katex')).toHaveCount(4);
});

test('loads math assets on demand and preserves source on loading failure', async ({ page }) => {
  await writeFile(join(directory, 'math-load.md'), '$x_1$\n');
  const assets: string[] = [];
  page.on('request', (request) => { if (/\/assets\/(katex|KaTeX)/.test(request.url())) assets.push(request.url()); });
  await page.goto(`http://127.0.0.1:${port}/?path=sample.py`);
  await expect(page.locator('#content')).toContainText('print');
  expect(assets).toEqual([]);
  await page.route('**/assets/katex*.js', (route) => route.abort());
  await page.goto(`http://127.0.0.1:${port}/?path=math-load.md`);
  await expect(page.locator('#content .math-error')).toHaveText('Cannot display formula');
  await expect(page.locator('#content .math-original')).toHaveText('$x_1$');
});

test('shows English controls with a Japanese browser locale', async ({ browser }) => {
  const context = await browser.newContext({ locale: 'ja-JP' });
  try {
    const page = await context.newPage();
    await page.goto(`http://127.0.0.1:${port}/?path=README.md`);
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.getByRole('button', { name: 'Refresh' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Files' })).toBeVisible();
    await expect(page.locator('#file-title').getByRole('button', { name: 'Source' })).toBeVisible();
  } finally {
    await context.close();
  }
});

test('keeps global shortcuts out of Markdown and editable text', async ({ page }) => {
  await page.goto(`http://127.0.0.1:${port}/`);
  await page.getByRole('button', { name: 'Paste Markdown' }).click();
  const editor = page.getByLabel('Markdown Text');
  await editor.click();
  await page.keyboard.type('docs/file.md https://example.test/a');
  await expect(editor).toHaveValue('docs/file.md https://example.test/a');
  await expect(editor).toBeFocused();
  await page.keyboard.press('Control+k');
  await page.keyboard.press('Control+b');
  await page.keyboard.press('Control+i');
  await expect(page.locator('#server-info-dialog')).toBeHidden();
  await expect(editor).toBeFocused();
  const editable = page.locator('#content').evaluate((content) => {
    const node = document.createElement('div'); node.contentEditable = 'true'; node.id = 'shortcut-editable'; content.append(node);
  });
  await editable;
  await page.locator('#shortcut-editable').focus();
  await page.keyboard.type('a/b');
  await expect(page.locator('#shortcut-editable')).toHaveText('a/b');
  await page.keyboard.press('Control+i');
  await expect(page.locator('#server-info-dialog')).toBeHidden();
  await expect(page.locator('#shortcut-editable')).toBeFocused();
  await page.locator('#file-title').click();
  await page.keyboard.press('/');
  await expect(page.getByRole('searchbox', { name: 'Search files' })).toBeFocused();
  await page.locator('#file-title').click();
  await page.keyboard.press('Control+k');
  await expect(page.getByRole('searchbox', { name: 'Search files' })).toBeFocused();
});

test('shortcut help opens by keyboard and mouse without interrupting editing', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, 'platform', { configurable: true, value: 'MacIntel' }));
  await page.goto(`http://127.0.0.1:${port}/?path=README.md`);
  await expect(page.locator('#sidebar-toggle')).toHaveAttribute('title', /⌘B/);
  await page.keyboard.press('?');
  const dialog = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('⌘K');
  await expect(dialog).toContainText('⌘I');
  await expect(dialog).toContainText('Open selected server in the same tab');
  await expect(dialog).toContainText('Next changed file');
  await expect(dialog.getByRole('button', { name: 'Close' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(page.locator('#help-toggle')).toBeFocused();
  await page.locator('#help-toggle').click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Close' }).click();
  await expect(dialog).toBeHidden();
  await page.locator('#search').fill('?');
  await expect(dialog).toBeHidden();
  await expect(page.locator('#search')).toHaveValue('?');
  await page.locator('#search').blur();
  await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: '?', isComposing: true, bubbles: true })));
  await expect(dialog).toBeHidden();
});

test('theme colors follow the selected theme and HTML keeps document colors', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('markport-theme', 'light'));
  await page.goto(`http://127.0.0.1:${port}/?path=README.md`);
  const colors = async () => page.evaluate(() => {
    const css = getComputedStyle(document.documentElement);
    return ['--mark-bg', '--mark-text', '--icon-image', '--icon-code', '--success-bg', '--success-text'].map((name) => css.getPropertyValue(name).trim());
  });
  const light = await colors();
  await page.getByRole('button', { name: 'Theme: Light' }).click();
  await page.getByRole('menuitemradio', { name: 'Dark' }).click();
  const dark = await colors();
  expect(dark.every((value, index) => value !== light[index])).toBe(true);
  for (const name of ['first.html', 'transparent.html', 'colored.html']) {
    await page.goto(`http://127.0.0.1:${port}/?path=docs%2F${name}`);
    const frame = page.frameLocator('.html-preview');
    await expect(frame.locator('h1')).toBeVisible();
    const background = await frame.locator('body').evaluate((body) => getComputedStyle(body).backgroundColor);
    if (name === 'colored.html') expect(background).toBe('rgb(255, 128, 128)');
    else expect(background).toBe('rgba(0, 0, 0, 0)');
    await expect(page.locator('.html-preview')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  }
});

test('server info shows actual startup details and returns keyboard focus', async ({ page }) => {
  await page.goto(`http://127.0.0.1:${port}/?path=README.md`);
  const button = page.getByRole('button', { name: 'Server info', exact: true });
  const dialog = page.getByRole('dialog', { name: 'Server info', exact: true });
  await page.getByRole('searchbox', { name: 'Search files' }).focus();
  await page.keyboard.press('Control+i'); await expect(dialog).toBeHidden();
  await page.locator('#search').blur();
  await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'i', ctrlKey: true, isComposing: true, bubbles: true })));
  await expect(dialog).toBeHidden();
  await page.keyboard.press('Control+i');
  await expect(dialog.getByRole('link').first()).toBeFocused();
  await expect(button).toHaveAttribute('title', /Ctrl\+I/);
  await expect(dialog.locator('dd')).toHaveText([
    await realpath(directory), process.cwd(), execFileSync(resolve('../dist/markport'), ['--version'], { encoding: 'utf8' }).trim(), `http://127.0.0.1:${port}`,
  ]);
  await page.keyboard.press('Escape'); await expect(dialog).toBeHidden(); await expect(button).toBeFocused();
  await button.click(); await expect(dialog.locator('dd')).toHaveCount(4);
  await dialog.getByRole('button', { name: 'Close', exact: true }).click(); await expect(button).toBeFocused();
});

test('server info navigates to another running server and refreshes after shutdown', async ({ page }, testInfo) => {
  const otherDirectory = await mkdtemp(join(tmpdir(), 'markport-other-'));
  const otherRoot = await realpath(otherDirectory);
  const otherPort = await freePort();
  await writeFile(join(otherDirectory, 'README.md'), '# Other server');
  const other = spawn(resolve('../dist/markport'), [otherDirectory, '--host', '0.0.0.0', '--port', String(otherPort)], {
    stdio: 'ignore', env: { ...process.env, XDG_CACHE_HOME: cacheDirectory, LOCALAPPDATA: cacheDirectory },
  });
  async function stopOther(): Promise<void> {
    if (other.exitCode !== null || other.signalCode !== null) return;
    const exited = new Promise((done) => other.once('exit', done)); other.kill('SIGTERM'); await exited;
  }
  try {
    await expect.poll(async () => {
      try { return (await fetch(`http://127.0.0.1:${otherPort}/api/instance`)).ok; } catch { return false; }
    }).toBe(true);
    await page.goto(`http://127.0.0.1:${port}/?path=README.md`);
    await page.keyboard.press('Control+i');
    const dialog = page.getByRole('dialog', { name: 'Server info', exact: true });
    const link = dialog.getByRole('link', { name: otherRoot, exact: true });
    await expect(link).toHaveAttribute('href', `http://127.0.0.1:${otherPort}/`);
    await page.screenshot({ path: testInfo.outputPath('running-servers.png') });
    const currentLink = dialog.getByRole('link', { name: await realpath(directory), exact: true });
    await expect(currentLink).toBeFocused();
    await page.keyboard.press('ArrowUp'); await expect(currentLink).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(link).toBeFocused();
    await page.keyboard.press('ArrowUp'); await expect(currentLink).toBeFocused();
    await page.keyboard.press('ArrowDown'); await expect(link).toBeFocused();
    await page.keyboard.press('ArrowDown'); await expect(link).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL((url) => url.origin === `http://127.0.0.1:${otherPort}`);
    await expect(page.locator('#content h1')).toHaveText('Other server');
    await page.getByRole('button', { name: 'Server info', exact: true }).click();
    await expect(dialog.locator('dd').first()).toHaveText(otherRoot);
    await page.goBack();
    await page.getByRole('button', { name: 'Server info', exact: true }).click();
    await expect(link).toBeVisible();
    await stopOther();
    await dialog.getByRole('button', { name: 'Refresh', exact: true }).click();
    await expect(link).toHaveCount(0);
    await expect(dialog.getByRole('link', { name: await realpath(directory), exact: true })).toBeVisible();
  } finally {
    await stopOther(); await rm(otherDirectory, { recursive: true, force: true });
  }
});

test('server info wraps long paths on desktop and mobile in both themes', async ({ page }, testInfo) => {
  const rootPath = `/work/${'very-long-directory-'.repeat(30)}作業 <script> & notes`;
  await page.route('**/api/info', (route) => route.fulfill({ json: { rootPath, workingDirectory: '/startup', version: 'dev', instances: [
    { rootPath, version: 'dev', url: 'http://127.0.0.1:3000/', current: true },
    { rootPath: '/other/作業', version: 'v1.0.0', url: 'http://127.0.0.1:4000/', current: false },
    { rootPath: '/local-only', version: 'dev', url: '', current: false, unavailableReason: 'Local access only' },
  ] } }));
  for (const width of [1280, 390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    for (const theme of ['light', 'dark']) {
      await page.addInitScript((value) => localStorage.setItem('markport-theme', value), theme);
      await page.goto(`http://127.0.0.1:${port}/?path=README.md`);
      const button = page.getByRole('button', { name: 'Server info', exact: true });
      await expect(button).toBeVisible(); await button.click();
      const dialog = page.getByRole('dialog', { name: 'Server info', exact: true });
      await expect(dialog.locator('dd').first()).toHaveText(rootPath);
      expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
      expect(await page.locator('header').evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`server-info-${width}-${theme}.png`) });
      await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    }
  }
  await page.route('**/api/tree**', (route) => route.abort());
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(page.locator('#connection')).toHaveAttribute('data-state', 'error');
  expect(await page.locator('header').evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await expect(page.getByRole('button', { name: 'Server info', exact: true })).toBeInViewport();
  await page.screenshot({ path: testInfo.outputPath('server-info-320-connection-error.png') });
  await page.getByRole('button', { name: 'Server info', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Server info', exact: true }).locator('dd').first()).toHaveText(rootPath);
});

test('server info retries and updates an open dialog after server restart', async ({ page }) => {
  let requests = 0;
  await page.route('**/api/info', (route) => {
    requests++;
    return requests === 1 ? route.fulfill({ status: 503 }) : route.continue();
  });
  await page.goto(`http://127.0.0.1:${port}/?path=README.md`);
  await expect(page.locator('#content h1').first()).toHaveText('Demo');
  await page.getByRole('button', { name: 'Server info', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Server info', exact: true });
  await expect(dialog).toContainText('Cannot load server info');
  await dialog.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(dialog.locator('dd')).toHaveCount(4);
  const beforeRestart = requests;
  await stopServer(); await startServer();
  await expect.poll(() => requests).toBeGreaterThan(beforeRestart);
  await expect(dialog.locator('dd').first()).toHaveText(await realpath(directory));
});

test('header controls stay aligned and theme choices work by keyboard on mobile', async ({ page }, testInfo) => {
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 844 });
    for (const theme of ['light', 'dark']) {
      await page.addInitScript((value) => localStorage.setItem('markport-theme', value), theme);
      await page.goto(`http://127.0.0.1:${port}/?path=README.md`);
      const buttons = width <= 700 ? ['#drawer-toggle', '#header-more', '#server-info-toggle', '#reload'] : ['#sidebar-toggle', '#theme-toggle', '#paste-toggle', '#server-info-toggle', '#reload'];
      const positions = await page.locator(buttons.join(',')).evaluateAll((elements) => elements.map((element) => {
        const box = element.getBoundingClientRect(); return { top: box.top, height: box.height, right: box.right };
      }));
      expect(new Set(positions.map((position) => position.height)).size, JSON.stringify({ width, theme, positions })).toBe(1);
      expect(new Set(positions.map((position) => position.top)).size).toBe(1);
      expect(Math.max(...positions.map((position) => position.right))).toBeLessThanOrEqual(width);
      await expect(page.locator('#connection')).toHaveAttribute('role', 'status');
      await page.screenshot({ path: testInfo.outputPath(`header-${width}-${theme}.png`) });
    }
  }
  await page.getByRole('button', { name: 'App settings' }).click();
  await page.getByRole('button', { name: 'Theme: Dark' }).click();
  await expect(page.getByRole('menuitemradio', { name: 'Dark' })).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('Home');
  await expect(page.getByRole('menuitemradio', { name: 'Auto' })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('menuitemradio', { name: 'Light', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.getByRole('button', { name: 'Paste Markdown' }).click();
  await expect(page.locator('#paste-input')).toBeVisible();
});

test('title controls show active views and keep auxiliary actions reachable on mobile', async ({ page }) => {
  await page.goto(`http://127.0.0.1:${port}/?path=README.md`);
  const title = page.locator('#file-title');
  await expect(title.getByRole('button', { name: 'File', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await title.getByRole('button', { name: 'Source' }).click();
  await expect(title.getByRole('button', { name: 'Source' })).toHaveAttribute('aria-pressed', 'true');
  await title.getByRole('button', { name: 'Preview' }).click();
  await expect(title.getByRole('button', { name: 'Preview' })).toHaveAttribute('aria-pressed', 'true');
  await expect(title.getByRole('button', { name: 'Copy path' })).toHaveAttribute('title', 'Copy path');
  await page.setViewportSize({ width: 390, height: 720 });
  const more = title.getByRole('button', { name: 'File actions' });
  await more.focus(); await page.keyboard.press('Enter');
  await expect(title.getByRole('menuitemradio', { name: 'File' })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(title.getByRole('menuitemradio', { name: 'Diff' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(more).toBeFocused();
  await expect(more).toHaveAttribute('aria-expanded', 'false');
  await more.click();
  await title.getByRole('menuitem', { name: 'Open on right' }).click();
  await expect(page.locator('#right-pane')).toBeVisible();
});

test('downloads original files from both panes and the mobile menu', async ({ page }) => {
  const binaryPath = join(directory, 'download.bin');
  const largePath = join(directory, 'large-download.txt');
  const binary = Buffer.from([0, 1, 255, 10]);
  await writeFile(binaryPath, binary);
  await writeFile(largePath, Buffer.alloc((10 << 20) + 1, 65));
  try {
    await page.goto(`http://127.0.0.1:${port}/?path=README.md`);
    const markdownPromise = page.waitForEvent('download');
    await page.locator('#file-title').getByRole('button', { name: 'Download' }).click();
    const markdown = await markdownPromise;
    expect(markdown.suggestedFilename()).toBe('README.md');
    expect((await readFile(await markdown.path())).toString()).toContain('# Demo');

    await page.goto(`http://127.0.0.1:${port}/?path=download.bin`);
    await expect(page.getByRole('heading', { name: 'Cannot display file' })).toBeVisible();
    const binaryPromise = page.waitForEvent('download');
    await page.locator('#file-title').getByRole('button', { name: 'Download' }).click();
    const binaryDownload = await binaryPromise;
    expect(binaryDownload.suggestedFilename()).toBe('download.bin');
    expect(await readFile(await binaryDownload.path())).toEqual(binary);

    await page.goto(`http://127.0.0.1:${port}/?path=large-download.txt`);
    await expect(page.getByRole('heading', { name: 'File too large' })).toBeVisible();
    const largePromise = page.waitForEvent('download');
    await page.locator('#file-title').getByRole('button', { name: 'Download' }).click();
    const large = await largePromise;
    expect((await readFile(await large.path())).length).toBe((10 << 20) + 1);

    await page.goto(`http://127.0.0.1:${port}/?path=README.md&right=sample.py`);
    await expect(page.locator('#right-content')).toContainText('print');
    const rightPromise = page.waitForEvent('download');
    await page.locator('#right-title').getByRole('button', { name: 'Download' }).click();
    const right = await rightPromise;
    expect(right.suggestedFilename()).toBe('sample.py');
    expect((await readFile(await right.path())).toString()).toBe('print("first")\n');

    await page.goto(`http://127.0.0.1:${port}/?path=README.md&right=download.bin`);
    await expect(page.locator('#right-content')).toContainText('Cannot display file');
    const rightBinaryPromise = page.waitForEvent('download');
    await page.locator('#right-title').getByRole('button', { name: 'Download' }).click();
    expect(await readFile(await (await rightBinaryPromise).path())).toEqual(binary);

    await page.setViewportSize({ width: 390, height: 720 });
    await page.goto(`http://127.0.0.1:${port}/?path=README.md`);
    await page.locator('#file-title').getByRole('button', { name: 'File actions' }).click();
    const mobilePromise = page.waitForEvent('download');
    await page.locator('#file-title').getByRole('menuitem', { name: 'Download' }).click();
    expect((await mobilePromise).suggestedFilename()).toBe('README.md');

    await unlink(binaryPath);
    await page.goto(`http://127.0.0.1:${port}/?path=download.bin`);
    await expect(page.getByRole('heading', { name: 'File not found' })).toBeVisible();
    await expect(page.locator('#file-title').getByRole('button', { name: 'Download' })).toHaveCount(0);
    await page.goto(`http://127.0.0.1:${port}/?path=README.md&right=download.bin`);
    await expect(page.locator('#right-content')).toContainText('File not found');
    await expect(page.locator('#right-title').getByRole('button', { name: 'Download' })).toBeHidden();
  } finally {
    await rm(binaryPath, { force: true });
    await rm(largePath, { force: true });
  }
});

test('contents button follows the persistent outline and split view', async ({ page }) => {
  await writeFile(join(directory, 'contents.md'), '# Contents\n\n## First\n\n## Second\n');
  await page.setViewportSize({ width: 1200, height: 900 });
  await page.goto(`http://127.0.0.1:${port}/?path=contents.md`);
  const contents = page.locator('#file-title').getByRole('button', { name: 'Contents', exact: true });
  await expect(page.locator('#outline')).toBeVisible();
  await expect(contents).toBeHidden();

  await page.setViewportSize({ width: 1199, height: 900 });
  await expect(contents).toBeVisible();
  await expect(page.locator('#outline')).toBeHidden();
  await contents.click();
  await expect(page.locator('#outline')).toBeVisible();
  await contents.click();
  await expect(page.locator('#outline')).toBeHidden();

  await page.setViewportSize({ width: 1400, height: 900 });
  await expect(contents).toBeHidden();
  await expect(page.locator('#outline')).toBeVisible();
  await page.getByRole('button', { name: 'Open on right', exact: true }).click();
  await expect(contents).toBeVisible();
  await expect(page.locator('#outline')).toBeHidden();
  await contents.click();
  await expect(page.locator('#outline')).toBeVisible();
  await page.getByRole('button', { name: 'Close split view', exact: true }).click();
  await expect(contents).toBeHidden();
  await expect(page.locator('#outline')).toBeVisible();
});

test('mobile title stays one row and keeps reading actions close', async ({ page }, testInfo) => {
  await writeFile(join(directory, 'mobile-title.md'), `# Mobile title\n\n## First\n\n${'Reading line\n\n'.repeat(60)}## Second\n\n## Third\n\n## Fourth\n`);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(`http://127.0.0.1:${port}/?path=mobile-title.md`);
  await expect(page.locator('#content h1')).toHaveText('Mobile title');
  expect((await page.locator('#file-title').boundingBox())!.height).toBeLessThanOrEqual(48);
  await page.screenshot({ path: testInfo.outputPath('mobile-title-390.png') });
  const more = page.locator('#file-title').getByRole('button', { name: 'File actions' });
  await more.click();
  await page.getByRole('menuitemradio', { name: 'Source' }).click();
  await expect(page.locator('#content')).toHaveAttribute('data-kind', 'code');
  await more.click();
  await page.getByRole('menuitemradio', { name: 'Preview' }).click();
  await expect(page.locator('#content h1')).toHaveText('Mobile title');
  await more.click();
  await page.getByRole('menuitem', { name: 'Contents' }).click();
  await expect(page.locator('#outline')).toBeVisible();
  await page.locator('#outline a', { hasText: 'Fourth' }).click();
  const heading = (await page.locator('#content h2', { hasText: 'Fourth' }).boundingBox())!;
  const title = (await page.locator('#file-title').boundingBox())!;
  expect(heading.y).toBeGreaterThanOrEqual(title.y + title.height);
  await more.click();
  await page.getByRole('menuitem', { name: 'Copy path' }).click();
  await expect(page.locator('#file-title')).toContainText('mobile-title.md');
  await page.route('**/api/git/changes', (route) => route.fulfill({ json: { available: true, rootId: 'mobile-title-review', changes: [{ path: 'mobile-title.md', status: 'modified', revision: 'one', added: 1, deleted: 1 }] } }));
  await page.route('**/api/git/diff?**', (route) => route.fulfill({ json: { path: 'mobile-title.md', kind: 'text', patch: '@@ -1 +1 @@\n-old\n+new\n' } }));
  await page.goto(`http://127.0.0.1:${port}/?path=mobile-title.md&view=diff`);
  await more.click();
  await expect(page.getByRole('menuitem', { name: 'Review and next (r)' })).toBeVisible();
  await page.getByRole('menuitemradio', { name: 'Mark reviewed: mobile-title.md' }).click();
  await more.click();
  await expect(page.getByRole('menuitemradio', { name: 'Mark unreviewed: mobile-title.md' })).toBeVisible();
});

test('sidebar tabs and resize handle work with keyboard, pointer, and mobile drawer', async ({ page }) => {
  await page.goto(`http://127.0.0.1:${port}/?path=README.md`);
  const files = page.getByRole('tab', { name: 'Files' });
  const changes = page.getByRole('tab', { name: 'Changes' });
  await expect(files).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tabpanel', { name: 'Files' })).toBeVisible();
  await files.focus(); await page.keyboard.press('ArrowRight');
  await expect(changes).toBeFocused();
  await expect(changes).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tabpanel', { name: 'Changes' })).toBeVisible();
  await page.keyboard.press('Home');
  await expect(files).toBeFocused();
  await expect(files).toHaveAttribute('aria-selected', 'true');
  const resize = page.locator('#sidebar-resize');
  const box = (await resize.boundingBox())!;
  expect(box.width).toBe(8);
  expect(await resize.evaluate((element) => getComputedStyle(element, '::before').width)).toBe('1px');
  await resize.focus(); await page.keyboard.press('ArrowRight');
  await expect.poll(() => page.evaluate(() => localStorage.getItem('markport-sidebar-width'))).toBe('290');
  const movedBox = (await resize.boundingBox())!;
  await page.mouse.move(movedBox.x + 2, movedBox.y + 50);
  await page.mouse.down(); await page.mouse.move(340, movedBox.y + 50); await page.mouse.up();
  await expect.poll(() => page.evaluate(() => Number(localStorage.getItem('markport-sidebar-width')))).toBeGreaterThan(320);
  await page.setViewportSize({ width: 390, height: 720 });
  await page.getByRole('button', { name: 'Open file list' }).click();
  await expect(files).toBeVisible();
  await changes.click();
  await expect(changes).toHaveAttribute('aria-selected', 'true');
  await expect(changes).toBeVisible();
  await expect(resize).toBeHidden();
});

test('keeps sidebar controls visible while file and change lists scroll', async ({ page }) => {
  for (const width of [1024, 390]) {
    await page.setViewportSize({ width, height: 500 });
    await page.goto(`http://127.0.0.1:${port}/?path=README.md`);
    if (width < 700) await page.getByRole('button', { name: 'Open file list' }).click();

    const tabs = page.locator('.sidebar-tabs');
    const search = page.locator('#files-panel > form');
    const tabsTop = (await tabs.boundingBox())!.y;
    const searchTop = (await search.boundingBox())!.y;
    await page.locator('#files-list').evaluate((list) => {
      const tree = list.querySelector('#tree')!;
      for (let i = 0; i < 80; i++) tree.appendChild(document.createElement('p')).textContent = `File ${i}`;
      list.scrollTop = list.scrollHeight;
    });
    await expect.poll(() => page.locator('#files-list').evaluate((list) => list.scrollTop)).toBeGreaterThan(0);
    expect((await tabs.boundingBox())!.y).toBe(tabsTop);
    expect((await search.boundingBox())!.y).toBe(searchTop);
    await expect(page.getByRole('searchbox', { name: 'Search files' })).toBeInViewport();

    await page.getByRole('tab', { name: 'Changes' }).click();
    await expect(page.locator('#changes-tree .hint')).toContainText('not a Git repository');
    if (width < 700) await page.getByRole('button', { name: 'Close file list' }).click();
    await page.locator('#changes-tree').evaluate((tree) => {
      for (let i = 0; i < 80; i++) tree.appendChild(document.createElement('p')).textContent = `Change ${i}`;
      tree.scrollTop = tree.scrollHeight;
    });
    await expect.poll(() => page.locator('#changes-tree').evaluate((tree) => tree.scrollTop)).toBeGreaterThan(0);
    expect((await tabs.boundingBox())!.y).toBe(tabsTop);
    await expect(page.getByRole('tab', { name: 'Files' })).toBeInViewport();
  }
});

test('separates app settings from file actions on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`http://127.0.0.1:${port}/?path=README.md`);
  const settings = page.getByRole('button', { name: 'App settings' });
  const fileActions = page.locator('#file-title').getByRole('button', { name: 'File actions' });
  await expect(settings).toBeVisible();
  await expect(fileActions).toBeVisible();
  expect(await settings.innerHTML()).not.toBe(await fileActions.innerHTML());
  await settings.click();
  await expect(page.getByRole('button', { name: 'Theme: Auto' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Paste Markdown' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Paste Markdown' })).toBeHidden();
  await expect(settings).toBeFocused();
  await fileActions.click();
  await expect(page.getByRole('menuitem', { name: 'Copy path' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menuitem', { name: 'Copy path' })).toBeHidden();
  await expect(fileActions).toBeFocused();
});

test('keeps sidebar rows compact with precise pointers and touch-sized with coarse pointers', async ({ page, browser }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto(`http://127.0.0.1:${port}/?path=README.md`);
  const row = page.locator('#tree a.file').first();
  const heading = page.locator('label[for=search]');
  const box = (await row.boundingBox())!;
  expect(box.height).toBeGreaterThanOrEqual(26);
  expect(box.height).toBeLessThanOrEqual(32);
  const size = (locator: typeof row) => locator.evaluate((element) => parseFloat(getComputedStyle(element).fontSize));
  expect(await size(heading)).toBeLessThan(await size(row));
  const touch = await browser.newContext({ viewport: { width: 1000, height: 800 }, hasTouch: true, isMobile: true });
  const touchPage = await touch.newPage();
  await touchPage.goto(`http://127.0.0.1:${port}/?path=README.md`);
  expect((await touchPage.locator('#tree a.file').first().boundingBox())!.height).toBeGreaterThanOrEqual(40);
  await touch.close();
});

test('keeps the comparison form on one row at desktop width', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.route('**/api/git/changes**', (route) => route.fulfill({ json: { available: true, rootId: 'cmp-row', changes: [] } }));
  await page.goto(`http://127.0.0.1:${port}/?view=changes`);
  const controls = page.locator('.comparison-controls');
  await expect(controls).toBeVisible();
  expect((await controls.boundingBox())!.height).toBeLessThan(60);
  expect((await page.locator('#comparison-base').boundingBox())!.width).toBeLessThan(260);
});

test('keeps the file name fully visible in a narrow title bar', async ({ page }) => {
  for (const width of [900, 700, 390]) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto(`http://127.0.0.1:${port}/?path=README.md`);
    const name = page.locator('#file-title .breadcrumbs strong');
    await expect(name).toHaveText('README.md');
    expect(await name.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
  await page.setViewportSize({ width: 900, height: 800 });
  await page.goto(`http://127.0.0.1:${port}/?path=README.md`);
  await expect(page.locator('#file-title .kind-badge')).toBeHidden();
  await expect(page.locator('#file-title .title-more')).toBeVisible();
});

test('keeps long search result names on a single line', async ({ page }) => {
  const name = `${'very-long-file-name-'.repeat(6)}main.ts`;
  await writeFile(join(directory, 'docs', name), 'export {};\n');
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto(`http://127.0.0.1:${port}/?path=README.md`);
  await page.getByRole('searchbox', { name: 'Search files' }).fill('very-long-file-name');
  const fileName = page.locator('#tree .search-results .node-file-name').first();
  await expect(fileName).toBeVisible();
  const lineHeight = await fileName.evaluate((element) => parseFloat(getComputedStyle(element).lineHeight) || 20);
  expect((await fileName.boundingBox())!.height).toBeLessThan(lineHeight * 1.5);
  await expect(page.locator('#tree .search-results a').first()).toHaveAttribute('title', `docs/${name}`);
  await unlink(join(directory, 'docs', name));
});

test('opens file search line targets in both panes and preserves scroll on refresh', async ({ page }) => {
  const path = 'docs/search-lines.md';
  await writeFile(join(directory, path), Array.from({ length: 180 }, (_, i) => `Line ${i + 1}`).join('\n'));
  await page.goto(`http://127.0.0.1:${port}/?path=README.md`);
  const search = page.getByRole('searchbox', { name: 'Search files' });
  const selected = page.locator('#content .line.selected-code-line');
  const rightSelected = page.locator('#right-content .line.selected-code-line');
  await search.fill(`${path}:123`);
  await expect(page.locator('#tree .search-results a')).toHaveAccessibleName(`${path}:123`);
  await search.press('Enter');
  await expect(page).toHaveURL(/path=docs%2Fsearch-lines\.md&source=1#L123$/);
  await expect(selected).toHaveText('Line 123\n');
  await expect(page.locator('#content #L123')).toBeInViewport();
  const cached = page.waitForResponse((response) => response.url().includes('/api/file?') && response.status() === 304);
  await search.fill(`${path}:150`);
  await page.locator('#tree .search-results a').click();
  await cached;
  await expect(selected).toHaveText('Line 150\n');
  await expect(page.locator('#content #L150')).toBeInViewport();
  await search.fill(`${path}:100`);
  await page.getByRole('button', { name: `Open ${path}:100 on right`, exact: true }).click();
  await expect(rightSelected).toHaveText('Line 100\n');
  await expect(page.locator('#right-content #L100')).toBeInViewport();
  await search.fill(`${path}:140`);
  await page.getByRole('button', { name: `Open ${path}:140 on right`, exact: true }).click();
  await expect(rightSelected).toHaveText('Line 140\n');
  await expect(page.locator('#right-content #L140')).toBeInViewport();
  await page.locator('#right-content .code-wrap-toggle').click();
  await expect(rightSelected).toContainText('Line 140');
  await expect(selected).toContainText('Line 150');
  await page.locator('#main').evaluate((pane) => { pane.scrollTop = 200; });
  await page.locator('#right-pane').evaluate((pane) => { pane.scrollTop = 300; });
  const refreshed = page.waitForResponse((response) => response.url().includes('/api/file?') && response.url().includes('source=1'));
  await writeFile(join(directory, path), Array.from({ length: 180 }, (_, i) => `Line ${i + 1}`).join('\n') + '\nNew line');
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await refreshed;
  await expect(page.locator('#content')).toContainText('New line');
  await expect(page.locator('#right-content')).toContainText('New line');
  expect(await page.locator('#main').evaluate((pane) => pane.scrollTop)).toBe(200);
  expect(await page.locator('#right-pane').evaluate((pane) => pane.scrollTop)).toBe(300);
  await page.locator('#right-rendered').click();
  await expect(rightSelected).toHaveCount(0);
  await page.locator('#file-title .breadcrumbs strong').click();
  await search.fill(`${path}:999`);
  await page.locator('#tree .search-results a').click();
  await expect(page).toHaveURL(/#L999/);
  await expect(selected).toHaveCount(0);
});

test('uses file search line targets for code and HTML and still opens visual files', async ({ page }) => {
  await page.goto(`http://127.0.0.1:${port}/?path=README.md`);
  const search = page.getByRole('searchbox', { name: 'Search files' });
  await search.fill('sample.py:1');
  await expect(page.locator('#tree .search-results a')).toHaveAccessibleName('sample.py:1');
  await search.press('Enter');
  await expect(page).toHaveURL(/path=sample\.py#L1$/);
  await expect(page.locator('#content .line.selected-code-line')).toContainText('print("first")');
  await search.fill('docs/first.html:1');
  await expect(page.locator('#tree .search-results a')).toHaveAccessibleName('docs/first.html:1');
  await search.press('Enter');
  await expect(page).toHaveURL(/path=docs%2Ffirst\.html&source=1#L1$/);
  await expect(page.locator('#content .line.selected-code-line')).toContainText('<!doctype html>');
  await expect(page.locator('#content .html-preview')).toHaveCount(0);
  await search.fill('docs/sample.pdf:123');
  await expect(page.locator('#tree .search-results a')).toHaveAccessibleName('docs/sample.pdf:123');
  await search.press('Enter');
  await expect(page.locator('#content .pdf-preview')).toBeVisible();
  await search.fill('image.png:123');
  await expect(page.locator('#tree .search-results a')).toHaveAccessibleName('image.png:123');
  await search.press('Enter');
  await expect(page.locator('#content .image-preview')).toBeVisible();
  await expect(page.locator('#content .selected-code-line')).toHaveCount(0);
});

test('searches text within a folder and opens the matching source line', async ({ page }) => {
  await mkdir(join(directory, 'content-scope'), { recursive: true });
  await writeFile(join(directory, 'content-scope', 'guide.md'), '# Guide\n\nBefore the answer\nThe auth needle is here\nAfter the answer\n');
  await writeFile(join(directory, 'content-scope', 'code.py'), 'print("before")\nprint("auth needle")\nprint("after")\n');
  await writeFile(join(directory, 'outside.md'), 'auth needle outside');
  await page.goto(`http://127.0.0.1:${port}/?path=README.md`);
  const contentSearch = page.locator('#content-search');
  const toggle = contentSearch.locator('summary');
  await expect(contentSearch).not.toHaveAttribute('open', '');
  await expect(page.locator('#content-query')).toBeHidden();
  await toggle.click();
  await expect(page.locator('#content-query')).toBeVisible();
  await page.locator('#content-query').fill('auth needle');
  await page.locator('#content-folder').fill('content-scope');
  await contentSearch.getByRole('button', { name: 'Search' }).click();
  await expect(page.locator('.content-search-status')).toContainText('2 matches');
  await expect(page.locator('.content-search-results a')).toHaveCount(2);
  await expect(page.locator('.content-search-results')).not.toContainText('outside.md');
  await expect(page.locator('.content-search-results a', { hasText: 'code.py' })).toContainText('print("before")');
  await toggle.click();
  await expect(page.locator('.content-search-results')).toBeHidden();
  await toggle.click();
  await expect(page.locator('#content-query')).toHaveValue('auth needle');
  await expect(page.locator('.content-search-results a')).toHaveCount(2);
  await page.locator('.content-search-results a', { hasText: 'code.py' }).click();
  await expect(page).toHaveURL(/path=content-scope%2Fcode\.py#L2$/);
  await expect(page.locator('#L2')).toBeVisible();
  await expect(page.locator('#content .line.selected-code-line')).toHaveCount(1);
  const titleBox = (await page.locator('#file-title').boundingBox())!;
  expect((await page.locator('#L2').boundingBox())!.y).toBeGreaterThanOrEqual(titleBox.y + titleBox.height);
  await page.locator('.content-search-results a', { hasText: 'guide.md' }).click();
  await expect(page).toHaveURL(/path=content-scope%2Fguide\.md&source=1#L4$/);
  await expect(page.locator('#file-title').getByRole('button', { name: 'Preview' })).toBeVisible();
  await expect(page.locator('#L4')).toBeVisible();
  await expect(page.locator('#content .line.selected-code-line')).toHaveCount(1);
  await page.locator('#content-folder').fill('missing-folder');
  await contentSearch.getByRole('button', { name: 'Search' }).click();
  await expect(page.locator('.content-search-status')).toHaveText('Folder not found.');
});

test('shows partial content results and cancels an active search', async ({ page }) => {
  await writeFile(join(directory, 'content-limit.md'), 'needle\n'.repeat(101));
  await page.goto(`http://127.0.0.1:${port}/?path=README.md`);
  await page.locator('#content-search summary').click();
  await page.locator('#content-query').fill('needle');
  await page.locator('#content-search').getByRole('button', { name: 'Search' }).click();
  await expect(page.locator('.content-search-status')).toContainText('Partial results: match limit reached.');
  await expect(page.locator('.content-search-results a')).toHaveCount(100);
  await page.route('**/api/content-search?**', async (route) => {
    await new Promise((done) => setTimeout(done, 1000));
    await route.abort();
  });
  await page.locator('#content-search').getByRole('button', { name: 'Search' }).click();
  await expect(page.locator('.content-search-status')).toHaveText('Searching…');
  await page.locator('#content-search').getByRole('button', { name: 'Cancel' }).click();
  await expect(page.locator('.content-search-status')).toHaveText('Search canceled.');
  await page.waitForTimeout(1100);
  await expect(page.locator('.content-search-status')).toHaveText('Search canceled.');
});

test('previews pasted Markdown and restores it after reloading the tab', async ({ page }) => {
  await page.goto(`http://127.0.0.1:${port}/?path=README.md`);
  await page.getByRole('button', { name: 'Paste Markdown' }).click();
  await page.getByLabel('Markdown Text').fill('# Pasted\n\n[Local](sample.py) [Jump](#pasted)');
  await expect(page.locator('.paste-preview')).toBeHidden();
  await page.getByRole('button', { name: 'Rendered' }).click();
  await expect(page.locator('.paste-preview h1')).toHaveText('Pasted');
  await expect(page.getByLabel('Markdown Text')).toBeHidden();
  await expect(page.locator('.paste-preview a', { hasText: 'Local' })).toHaveCount(0);
  await expect(page.locator('.paste-preview a', { hasText: 'Jump' })).toHaveAttribute('href', '#pasted');
  await page.getByRole('button', { name: 'Text' }).click();
  await expect(page.getByLabel('Markdown Text')).toBeVisible();
  await expect(page.locator('.paste-preview')).toBeHidden();
  await page.getByRole('button', { name: 'Rendered' }).click();
  await expect(page.locator('.paste-preview h1')).toHaveText('Pasted');
  await page.reload();
  await expect(page.getByLabel('Markdown Text')).toHaveValue('# Pasted\n\n[Local](sample.py) [Jump](#pasted)');
  await expect(page.locator('.paste-preview')).toBeHidden();
  await page.getByRole('button', { name: 'Paste options' }).click();
  page.once('dialog', (dialog) => { void dialog.accept(); });
  await page.getByRole('button', { name: 'Clear', exact: true }).click();
  await expect(page.getByLabel('Markdown Text')).toBeEmpty();
  await expect(page.locator('.paste-preview h1')).toHaveCount(0);
});

test('keeps an unchanged page still during automatic refresh', async ({ page }) => {
  await page.goto(`http://127.0.0.1:${port}/?path=sample.py`);
  await expect(page.locator('article .lntd:last-child pre')).toContainText('first');
  await page.evaluate(() => {
    (window as Window & { originalContent?: Element | null }).originalContent = document.querySelector('article .code-frame');
  });
  await page.waitForTimeout(3500);
  expect(await page.evaluate(() => (window as Window & { originalContent?: Element | null }).originalContent === document.querySelector('article .code-frame'))).toBe(true);
  await expect(page.locator('#reload')).toBeEnabled();
  await expect(page.locator('#progress')).toBeHidden();
  await expect(page.locator('#content')).toHaveAttribute('aria-busy', 'false');
});

test('opens Files in the clicked pane and keeps the other document and scroll', async ({ page }, testInfo) => {
  for (const name of ['active-a', 'active-b', 'active-c']) await writeFile(join(directory, 'docs', `${name}.md`), `# ${name}\n\n${'Paragraph\n\n'.repeat(100)}`);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`http://127.0.0.1:${port}/?path=docs%2Factive-a.md&right=docs%2Factive-b.md`);
  await expect(page.locator('#content h1')).toHaveText('active-a'); await expect(page.locator('#right-content h1')).toHaveText('active-b');
  await expect(page.locator('#main .active-pane-badge')).toBeVisible();
  await page.locator('#main').evaluate((element) => { element.scrollTop = 300; });
  const scroll = await page.locator('#main').evaluate((element) => element.scrollTop);
  await page.locator('#right-content h1').click();
  await expect(page.locator('#right-pane .active-pane-badge')).toBeVisible();
  await expect(page.locator('#tree a[aria-current]')).toHaveAttribute('href', '/?path=docs%2Factive-b.md');
  await page.locator('#tree a[href="/?path=docs%2Factive-c.md"]').click();
  await expect(page.locator('#right-content h1')).toHaveText('active-c'); await expect(page.locator('#content h1')).toHaveText('active-a');
  expect(await page.locator('#main').evaluate((element) => element.scrollTop)).toBe(scroll);
  await page.locator('#reload').click(); await expect(page.locator('#right-pane .active-pane-badge')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('selected-right-pane.png') });
  await page.locator('#file-title .breadcrumbs strong').click(); await expect(page.locator('#main .active-pane-badge')).toBeVisible();
  await page.locator('#tree a[href="/?path=docs%2Factive-b.md"]').click();
  await expect(page.locator('#content h1')).toHaveText('active-b'); await expect(page.locator('#right-content h1')).toHaveText('active-c');
});

test('opens filename and content search line targets in the keyboard-selected pane', async ({ page }) => {
  const path = 'docs/active-deep/nested/active-search.md';
  await mkdir(join(directory, 'docs', 'active-deep', 'nested'), { recursive: true });
  await writeFile(join(directory, path), '# Search target\n\nactive search needle\n');
  await page.setViewportSize({ width: 1440, height: 900 }); await page.goto(`http://127.0.0.1:${port}/?path=README.md&right=sample.py`);
  await expect(page.locator('#right-content')).toHaveAttribute('aria-busy', 'false');
  await page.locator('#right-copy').focus(); await page.keyboard.press('/');
  const search = page.locator('#search'); await expect(search).toBeFocused(); await search.fill(`${path}:3`);
  await expect(page.locator('#tree .search-results a')).toHaveCount(1); await page.keyboard.press('Enter');
  await expect(page.locator('#right-source')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#right-content .line.selected-code-line')).toHaveCount(1); await expect(page.locator('#content h1')).toHaveText('Demo');
  expect(new URL(page.url()).searchParams.get('right')).toBe(path);
  const searchContents = page.locator('#content-search'); await searchContents.locator('summary').click();
  await page.locator('#content-query').fill('active search needle'); await page.locator('#content-folder').fill('docs');
  await searchContents.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(page.locator('.content-search-results a')).toHaveCount(1); await page.locator('.content-search-results a').click();
  await expect(page.locator('#right-content .line.selected-code-line')).toHaveCount(1); await expect(page.locator('#content h1')).toHaveText('Demo');
  await search.fill(''); await expect(page.locator('#tree a[aria-current]')).toHaveAttribute('href', `/?path=${encodeURIComponent(path)}`);
  for (const folder of ['docs', 'docs/active-deep', 'docs/active-deep/nested']) await expect(page.locator(`#tree details[data-path="${folder}"]`)).toHaveAttribute('open', '');
});

test('iframe focus, divider operations and browser navigation preserve the file destination', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  for (const file of ['docs/first.html', 'docs/sample.pdf']) {
    await page.goto(`http://127.0.0.1:${port}/?path=README.md&right=${encodeURIComponent(file)}`);
    await expect(page.locator('#right-content iframe')).toBeVisible();
    await expect(page.locator('#main .active-pane-badge')).toBeVisible();
    await page.locator('#right-content iframe').click({ position: { x: 60, y: 70 } });
    await expect(page.locator('#right-pane .active-pane-badge')).toBeVisible();
    const divider = page.getByRole('separator', { name: 'Resize file panes' }); await divider.focus(); await page.keyboard.press('ArrowLeft');
    await expect(page.locator('#right-pane .active-pane-badge')).toBeVisible();
    await page.locator('#tree a[href="/?path=sample.py"]').click();
    await expect(page.locator('#right-path strong')).toHaveText('sample.py'); await expect(page.locator('#content h1')).toHaveText('Demo');
    await page.goBack(); await expect(page.locator('#right-content iframe')).toBeVisible();
    await expect(page.locator('#tree a[aria-current]')).toHaveAttribute('href', `/?path=${encodeURIComponent(file)}`);
    await page.goForward(); await expect(page.locator('#right-path strong')).toHaveText('sample.py');
  }
});

test('keeps the selected destination after swapping and uses stacked panes on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 600, height: 900 }); await page.goto(`http://127.0.0.1:${port}/?path=README.md&right=sample.py`);
  await expect(page.locator('#right-content')).toHaveAttribute('aria-busy', 'false');
  await page.locator('#right-path').click(); await expect(page.locator('#right-pane .active-pane-badge')).toBeVisible();
  await page.getByRole('button', { name: 'File actions', exact: true }).last().click();
  await page.locator('#right-pane').getByRole('menuitem', { name: 'Swap panes' }).click();
  await expect(page.locator('#right-content h1')).toHaveText('Demo'); await expect(page.locator('#right-pane .active-pane-badge')).toBeVisible();
  await page.locator('#drawer-toggle').click(); await page.locator('#tree details[data-path="docs"] > summary').click(); await page.locator('#tree a[href="/?path=docs%2Fsample.pdf"]').click();
  await expect(page.locator('#right-content .pdf-preview')).toBeVisible();
  expect(new URL(page.url()).searchParams.get('path')).toBe('sample.py');
  await page.getByRole('button', { name: 'File actions', exact: true }).last().click();
  await page.locator('#right-pane').getByRole('menuitem', { name: 'Close split view' }).click();
  await expect(page.locator('#right-pane')).toBeHidden();
  await page.locator('#drawer-toggle').click(); await page.locator('#tree a[href="/?path=README.md"]').click(); await expect(page.locator('#content h1')).toHaveText('Demo');
});

test('resizes file panes, restores their ratio and keeps mobile stacking', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 800 });
  await page.goto(`http://127.0.0.1:${port}/?path=README.md&right=sample.py`);
  const handle = page.getByRole('separator', { name: 'Resize file panes' });
  await expect(handle).toBeVisible();
  const width = () => page.locator('#main').evaluate((element) => element.getBoundingClientRect().width);
  const before = await width(); const box = (await handle.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + 100); await page.mouse.down();
  await page.mouse.move(box.x + 144, box.y + 100, { steps: 8 }); await page.mouse.up();
  expect(await width()).toBeGreaterThan(before + 100);
  await expect(page.locator('.split-resize-shield')).toHaveCount(0);
  const ratio = await handle.getAttribute('aria-valuenow');
  await page.reload(); await expect(handle).toHaveAttribute('aria-valuenow', ratio!);
  await page.locator('#sidebar-toggle').click(); await expect(handle).toHaveAttribute('aria-valuenow', ratio!);
  await page.getByRole('button', { name: 'Swap panes' }).click(); await expect(handle).toHaveAttribute('aria-valuenow', ratio!);
  await handle.focus(); const previous = await width(); await page.keyboard.press('ArrowLeft');
  expect(await width()).toBeCloseTo(previous - 10, 0);
  await page.keyboard.press('Home'); expect(await width()).toBeCloseTo(200, 0);
  await page.keyboard.press('End'); expect(await page.locator('#right-pane').evaluate((element) => element.getBoundingClientRect().width)).toBeCloseTo(200, 0);
  await handle.dblclick(); await expect(handle).toHaveAttribute('aria-valuenow', '50');
  await page.screenshot({ path: testInfo.outputPath('resizable-file-panes.png') });
  await page.setViewportSize({ width: 600, height: 800 }); await expect(handle).toBeHidden();
  const left = (await page.locator('#main').boundingBox())!; const right = (await page.locator('#right-pane').boundingBox())!;
  expect(right.y).toBeGreaterThanOrEqual(left.y + left.height);
  await page.setViewportSize({ width: 1440, height: 800 }); await expect(handle).toHaveAttribute('aria-valuenow', '50');
  await page.getByRole('button', { name: 'Close split view' }).click(); await expect(handle).toBeHidden();
});

test('keeps divider dragging over HTML and PDF frames', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  for (const file of ['docs/first.html', 'docs/sample.pdf']) {
    await page.goto(`http://127.0.0.1:${port}/?path=README.md&right=${encodeURIComponent(file)}`);
    await expect(page.locator('#right-content iframe')).toBeVisible();
    const handle = page.getByRole('separator', { name: 'Resize file panes' }); await handle.dblclick();
    const box = (await handle.boundingBox())!;
    await page.mouse.move(box.x + 4, box.y + 200); await page.mouse.down();
    await page.mouse.move(box.x + 150, box.y + 200, { steps: 10 }); await page.mouse.up();
    expect(Number(await handle.getAttribute('aria-valuenow'))).toBeGreaterThan(60);
    await expect(page.locator('.split-resize-shield')).toHaveCount(0);
  }
});

test('resizes Paste Split independently and preserves text, selection and view changes', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 }); await page.goto(`http://127.0.0.1:${port}/?view=paste`);
  const input = page.getByLabel('Markdown Text'); await input.fill('# Draft\n\nSome text');
  await page.getByRole('button', { name: 'Split', exact: true }).click();
  await expect(page.locator('.paste-preview h1')).toHaveText('Draft');
  await input.evaluate((element: HTMLTextAreaElement) => element.setSelectionRange(2, 5));
  const handle = page.getByRole('separator', { name: 'Resize Text and preview' }); const box = (await handle.boundingBox())!;
  const before = await input.evaluate((element) => element.getBoundingClientRect().width);
  await page.mouse.move(box.x + 4, box.y + 100); await page.mouse.down(); await page.mouse.move(box.x - 100, box.y + 100, { steps: 6 }); await page.mouse.up();
  expect(await input.evaluate((element) => element.getBoundingClientRect().width)).toBeLessThan(before - 90);
  await expect(input).toHaveValue('# Draft\n\nSome text');
  expect(await input.evaluate((element: HTMLTextAreaElement) => [element.selectionStart, element.selectionEnd])).toEqual([2, 5]);
  const ratio = await handle.getAttribute('aria-valuenow');
  await page.getByRole('button', { name: 'Text', exact: true }).click(); await expect(handle).toBeHidden();
  await page.getByRole('button', { name: 'Split', exact: true }).click(); await expect(handle).toHaveAttribute('aria-valuenow', ratio!);
  await page.reload(); await page.getByRole('button', { name: 'Split', exact: true }).click(); await expect(handle).toHaveAttribute('aria-valuenow', ratio!);
  expect(await page.evaluate(() => localStorage.getItem('markport-file-split-ratio'))).toBeNull();
  await handle.focus(); await page.keyboard.press('ArrowRight'); await handle.dblclick(); await expect(handle).toHaveAttribute('aria-valuenow', '50');
  await page.screenshot({ path: testInfo.outputPath('resizable-paste-panes.png') });
  await page.setViewportSize({ width: 1100, height: 800 }); await expect(handle).toBeHidden(); await expect(page.getByRole('button', { name: 'Text', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.setViewportSize({ width: 1440, height: 900 }); await page.getByRole('button', { name: 'Split', exact: true }).click(); await expect(handle).toHaveAttribute('aria-valuenow', '50');
});

test('opens and refreshes two independently scrolling files', async ({ page }) => {
  await writeFile(join(directory, 'split-left.md'), `# Left\n${'Left line\n\n'.repeat(150)}`);
  await writeFile(join(directory, 'split-right.md'), `# Right\n${'Right line\n\n'.repeat(150)}`);
  await page.setViewportSize({ width: 1440, height: 800 });
  await page.goto(`http://127.0.0.1:${port}/?path=split-left.md`);
  await expect(page.locator('#content h1')).toHaveText('Left');
  await page.locator('#main').evaluate((pane) => { pane.scrollTop = 350; });
  const leftScroll = await page.locator('#main').evaluate((pane) => pane.scrollTop);
  await page.getByRole('button', { name: 'Open split-right.md on right' }).click();
  await expect(page.locator('#right-content h1')).toHaveText('Right');
  expect(await page.locator('#main').evaluate((pane) => pane.scrollTop)).toBe(leftScroll);
  await page.locator('#right-pane').evaluate((pane) => { pane.scrollTop = 480; });
  expect(await page.locator('#right-pane').evaluate((pane) => pane.scrollTop)).toBeGreaterThan(0);
  expect(await page.locator('#main').evaluate((pane) => pane.scrollTop)).toBe(leftScroll);
  await writeFile(join(directory, 'split-left.md'), `# Left updated\n${'Left line\n\n'.repeat(150)}`);
  await writeFile(join(directory, 'split-right.md'), `# Right updated\n${'Right line\n\n'.repeat(150)}`);
  await expect(page.locator('#content h1')).toHaveText('Left updated', { timeout: 15000 });
  await expect(page.locator('#right-content h1')).toHaveText('Right updated', { timeout: 15000 });
  expect(await page.locator('#main').evaluate((pane) => pane.scrollTop)).toBe(leftScroll);
  expect(await page.locator('#right-pane').evaluate((pane) => pane.scrollTop)).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Close split view' }).click();
  await expect(page.locator('#right-pane')).toBeHidden();
  await expect(page.locator('#content h1')).toHaveText('Left updated');
});

test('split pane titles, controls, and navigation keep file context', async ({ page }, testInfo) => {
  await mkdir(join(directory, 'docs'), { recursive: true });
  await writeFile(join(directory, 'docs', 'split-left.md'), `# Left\n\n## First\n\n## Second\n\n${'Left line\n\n'.repeat(100)}`);
  await writeFile(join(directory, 'docs', 'split-right.md'), `# Right\n\n## First\n\n## Second\n\n${'Right line\n\n'.repeat(100)}`);
  for (const width of [1280, 1400, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`http://127.0.0.1:${port}/?path=docs%2Fsplit-left.md&right=docs%2Fsplit-right.md`);
    await expect(page.locator('#right-content h1')).toHaveText('Right');
    await expect(page.locator('#file-title .breadcrumbs strong')).toHaveText('split-left.md');
    await expect(page.locator('#right-path strong')).toHaveText('split-right.md');
    for (const selector of ['#file-title .breadcrumbs strong', '#right-path strong']) {
      const visible = await page.locator(selector).evaluate((element) => {
        const box = element.getBoundingClientRect(); const pane = element.closest('#main, #right-pane')!.getBoundingClientRect();
        return box.left >= pane.left && box.right <= pane.right && box.width > 0;
      });
      expect(visible, `${selector} at ${width}px`).toBe(true);
    }
    expect(await page.locator('.content-layout').evaluate((element) => getComputedStyle(element).display)).toBe('block');
    await page.screenshot({ path: testInfo.outputPath(`split-${width}.png`) });
  }
  await expect(page.locator('#right-rendered')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#right-source').click();
  await expect(page.locator('#right-source')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#right-rendered').click();
  await page.locator('#right-contents').click();
  await expect(page.locator('#right-outline')).toBeVisible();
  await page.locator('#right-pane').evaluate((pane) => { pane.scrollTop = 350; });
  await page.locator('#main').evaluate((pane) => { pane.scrollTop = 250; });
  await page.getByRole('button', { name: 'Swap panes' }).click();
  await expect(page.locator('#content h1')).toHaveText('Right');
  await expect(page.locator('#right-content h1')).toHaveText('Left');
  expect(new URL(page.url()).searchParams.get('path')).toBe('docs/split-right.md');
  expect(new URL(page.url()).searchParams.get('right')).toBe('docs/split-left.md');
  expect(await page.locator('#main').evaluate((pane) => pane.scrollTop)).toBeGreaterThan(0);
  expect(await page.locator('#right-pane').evaluate((pane) => pane.scrollTop)).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Show this file only' }).click();
  await expect(page.locator('#right-pane')).toBeHidden();
  await expect(page.locator('#content h1')).toHaveText('Left');
  expect(new URL(page.url()).searchParams.get('right')).toBeNull();
});

test('scrolls long code and table lines inside narrow panes', async ({ page }) => {
  const longLine = `value = '${'x'.repeat(200)}END'`;
  await writeFile(join(directory, 'long-lines.md'), `# Long lines\n\n\`\`\`python\n${longLine}\n\`\`\`\n\n| Column |\n|---|\n| ${longLine} |\n`);
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto(`http://127.0.0.1:${port}/?path=long-lines.md`);
  await expect(page.locator('#content .code-frame>.chroma')).toContainText('END');
  const scrollToEnd = async (selector: string): Promise<void> => {
    const dimensions = await page.locator(selector).evaluate((element) => {
      element.scrollLeft = element.scrollWidth;
      return { width: element.clientWidth, content: element.scrollWidth, offset: element.scrollLeft };
    });
    expect(dimensions.content).toBeGreaterThan(dimensions.width);
    expect(dimensions.offset).toBeGreaterThan(0);
  };
  await scrollToEnd('#content .code-frame>.chroma');
  await scrollToEnd('#content .table-wrap');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);

  await page.setViewportSize({ width: 900, height: 800 });
  await page.getByRole('button', { name: 'Open long-lines.md on right' }).click();
  await expect(page.locator('#right-content .code-frame>.chroma')).toContainText('END');
  await scrollToEnd('#right-content .code-frame>.chroma');
  await scrollToEnd('#right-content .table-wrap');
});

test('scrolls large tables, wraps cells on request, and expands them into an overlay', async ({ page }) => {
  const sentence = 'A fairly long sentence that should wrap inside its table cell';
  const wide = `| ${Array.from({ length: 8 }, (_, index) => `Column ${index}`).join(' | ')} |\n|${'---|'.repeat(8)}\n| ${Array.from({ length: 8 }, () => sentence).join(' | ')} |\n| [Link](small.md) |${' x |'.repeat(7)}`;
  await writeFile(join(directory, 'wide-table.md'), `# Tables\n\n| Small | Table |\n|---|---|\n| a | b |\n\n${wide}\n`);
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto(`http://127.0.0.1:${port}/?path=wide-table.md`);
  const small = page.locator('#content .table-frame').nth(0);
  const large = page.locator('#content .table-frame').nth(1);
  await expect(large).toHaveClass(/\bwide\b/);
  await expect(small).not.toHaveClass(/\bwide\b/);
  const measure = (): Promise<{ article: number; frames: number[]; mainOverflow: number; cellHeight: number; lineHeight: number }> => page.evaluate(() => {
    const main = document.querySelector('#main')!;
    const frames = [...document.querySelectorAll('#content .table-frame')].map((frame) => frame.getBoundingClientRect().width);
    const cell = document.querySelector('#content .table-frame:nth-of-type(2) td')!;
    return { article: document.querySelector('#content')!.getBoundingClientRect().width, frames, mainOverflow: main.scrollWidth - main.clientWidth, cellHeight: cell.getBoundingClientRect().height, lineHeight: parseFloat(getComputedStyle(cell).lineHeight) };
  });
  const sizes = await measure();
  for (const width of sizes.frames) expect(Math.abs(width - sizes.article)).toBeLessThan(1);
  expect(sizes.mainOverflow).toBeLessThanOrEqual(0);
  expect(sizes.cellHeight).toBeLessThan(sizes.lineHeight * 2);

  const wrap = large.locator('.table-wrap');
  const wrapCells = large.getByRole('button', { name: 'Wrap cells' });
  await expect(wrapCells).toHaveAttribute('aria-pressed', 'false');
  await expect(large).toHaveClass(/\boverflows-right\b/);
  await expect(wrap).toHaveAttribute('tabindex', '0');
  await wrap.evaluate((element) => { element.scrollLeft = element.scrollWidth; });
  await expect(large).toHaveClass(/\boverflows-left\b/);
  await expect(large).not.toHaveClass(/\boverflows-right\b/);

  const expand = large.getByRole('button', { name: 'Expand' });
  await expand.click();
  const overlay = page.getByRole('dialog', { name: 'Expanded table' });
  await expect(overlay).toBeVisible();
  await expect(overlay.locator('td').first()).toHaveCSS('white-space', 'nowrap');
  await page.keyboard.press('Escape');
  await expect(overlay).toBeHidden();
  await expect(expand).toBeFocused();

  await wrapCells.click();
  await expect(wrapCells).toHaveAttribute('aria-pressed', 'true');
  const wrapped = await measure();
  expect(wrapped.cellHeight).toBeGreaterThan(wrapped.lineHeight * 2);
  expect(wrapped.mainOverflow).toBeLessThanOrEqual(0);
  await page.reload();
  await expect(page.locator('#content .table-frame').nth(1).getByRole('button', { name: 'Wrap cells' })).toHaveAttribute('aria-pressed', 'true');

  await writeFile(join(directory, 'small.md'), '# Small target');
  await page.locator('#content .table-frame').nth(1).getByRole('button', { name: 'Expand' }).click();
  await expect(overlay.locator('td').first()).toHaveCSS('white-space', 'normal');
  await overlay.getByRole('link', { name: 'Link' }).click();
  await expect(overlay).toBeHidden();
  await expect(page.locator('#content h1')).toHaveText('Small target');
});

test('keeps the HTML preview sandbox in the right pane and works on a narrow screen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto(`http://127.0.0.1:${port}/?path=README.md`);
  await page.getByRole('button', { name: 'Open file list' }).click();
  await page.locator('details[data-path="docs"] > summary').click();
  await page.getByRole('button', { name: 'Open docs/first.html on right' }).click();
  const frame = page.locator('#right-content .html-preview');
  await expect(frame).toHaveAttribute('sandbox', 'allow-same-origin');
  await expect(page.frameLocator('#right-content .html-preview').locator('h1')).toHaveText('HTML preview');
  expect(await page.frameLocator('#right-content .html-preview').locator('body').evaluate((body) => (body.ownerDocument.defaultView as Window & { previewScriptRan?: boolean }).previewScriptRan)).toBeUndefined();
  await expect(page.locator('#main')).toBeVisible();
  await expect(page.locator('#right-pane')).toBeVisible();
  const scrollable = await page.locator('#right-pane').evaluate((pane) => getComputedStyle(pane).overflowY);
  expect(scrollable).toBe('auto');
  await page.frameLocator('#right-content .html-preview').getByRole('link', { name: 'Next HTML' }).click();
  await expect(page.locator('#right-path')).toHaveAttribute('title', 'docs/second.htm');
  await expect(page.locator('#content h1')).toHaveText('Demo');
  await page.locator('#right-title').getByRole('button', { name: 'File actions', exact: true }).click();
  await page.locator('#right-title').getByRole('menuitemradio', { name: 'Source', exact: true }).click();
  await expect(page.locator('#right-content .lntd:last-child pre')).toContainText('Second HTML');
  await page.getByRole('button', { name: 'Close split view' }).click();
  await expect(page.locator('#right-pane')).toBeHidden();
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
  await expect(page.locator('#tree details[data-path="docs"] > summary')).toBeFocused();
  expect(page.url()).toBe(url);

  await page.setViewportSize({ width: 390, height: 800 });
  await page.locator('#file-title').getByRole('button', { name: 'File actions' }).click();
  await page.getByRole('menuitem', { name: 'Show parent folder' }).click();
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
  await page.locator('#file-title .view-segment').getByRole('button', { name: 'Source' }).click();
  await expect(page.locator('article .lntd:last-child pre')).toContainText('HTML preview');
  await page.locator('#file-title .view-segment').getByRole('button', { name: 'Preview' }).click();
  await frame.locator('a', { hasText: 'Next HTML' }).click();
  await expect(page).toHaveURL(/path=docs%2Fsecond\.htm/);
  await expect(page.frameLocator('.html-preview').locator('h1')).toHaveText('Second HTML');
  await writeFile(join(directory, 'docs', 'second.htm'), '<!doctype html><html><body><h1>Updated HTML</h1></body></html>');
  await expect(page.frameLocator('.html-preview').locator('h1')).toHaveText('Updated HTML', { timeout: 15000 });
});

test('enables interactive HTML per file and keeps it isolated', async ({ page }) => {
  await page.goto(`http://127.0.0.1:${port}/?path=docs%2Finteractive.html`);
  const frame = page.frameLocator('#content .html-preview');
  const toggle = page.locator('#file-title .interactive-toggle');
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await expect(frame.locator('body')).not.toHaveAttribute('data-local-script', 'ready');
  await toggle.click();
  await expect(toggle).toHaveText('Disable JavaScript');
  await expect(page.locator('#content .html-preview')).toHaveAttribute('sandbox', 'allow-scripts allow-modals');
  await expect(frame.locator('body')).toHaveAttribute('data-local-script', 'ready');
  await expect(frame.locator('body')).toHaveAttribute('data-module-script', 'ready');
  await expect(frame.locator('body')).toHaveAttribute('data-parent-access', 'false');
  await expect(frame.locator('body')).toHaveAttribute('data-network-access', 'blocked');
  await expect(frame.locator('body')).not.toHaveAttribute('data-external-script', 'ready');
  expect(await page.locator('#content .html-preview').evaluate((element: HTMLIFrameElement) => element.contentDocument)).toBeNull();
  await frame.getByRole('button', { name: 'Public' }).click();
  await expect(frame.getByRole('button', { name: 'Public' })).toHaveAttribute('aria-pressed', 'true');
  await expect(frame.locator('[data-flow="internal"]')).toHaveClass('dim');
  await frame.locator('body').evaluate((body) => { body.ownerDocument.defaultView!.addEventListener('beforeprint', () => { body.dataset.printCalled = 'true'; }); });
  await frame.getByRole('button', { name: 'Print' }).click();
  await expect(frame.locator('body')).toHaveAttribute('data-print-called', 'true');
  await page.reload();
  await expect(frame.locator('body')).toHaveAttribute('data-local-script', 'ready');
  await frame.getByRole('link', { name: 'Next HTML' }).click();
  await expect(page).toHaveURL(/path=docs%2Fsecond\.htm/);
  await expect(page.locator('#file-title .interactive-toggle')).toHaveAttribute('aria-pressed', 'false');
  await page.goto(`http://127.0.0.1:${port}/?path=docs%2Finteractive.html`);
  await expect(frame.locator('body')).toHaveAttribute('data-local-script', 'ready');
  await page.locator('#file-title .interactive-toggle').click();
  await expect(frame.locator('body')).not.toHaveAttribute('data-local-script', 'ready');
});

test('enables interactive HTML in the right pane', async ({ page }) => {
  await page.goto(`http://127.0.0.1:${port}/?path=README.md&right=docs%2Finteractive.html`);
  const frame = page.frameLocator('#right-content .html-preview');
  await expect(frame.locator('body')).not.toHaveAttribute('data-local-script', 'ready');
  await page.locator('#right-interactive').click();
  await expect(frame.locator('body')).toHaveAttribute('data-local-script', 'ready');
  await frame.getByRole('link', { name: 'Next HTML' }).click();
  await expect(page.locator('#right-path')).toHaveAttribute('title', 'docs/second.htm');
  await expect(page.locator('#right-interactive')).toHaveAttribute('aria-pressed', 'false');
});

test('renders GFM, Mermaid and code, then tracks files', async ({ page }) => {
  const externalRequests: string[] = [];
  page.on('request', (request) => { const url = new URL(request.url()); if ((url.protocol === 'http:' || url.protocol === 'https:') && url.origin !== `http://127.0.0.1:${port}`) externalRequests.push(request.url()); });
  await page.goto(`http://127.0.0.1:${port}/?path=README.md`);
  await expect(page.locator('article h1')).toHaveText('Demo');
  await expect(page.locator('article table')).toContainText('1');
  await expect(page.locator('article input[type=checkbox]')).toBeChecked();
  await expect(page.locator('.mermaid-source .diagram-image svg')).toBeVisible({ timeout: 15000 });
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

test('expanded Mermaid diagrams fit, zoom, pan, and restore focus', async ({ page }) => {
  const directions = ['LR', 'TB'];
  for (const direction of directions) {
    const diagram = `flowchart ${direction}\n${Array.from({ length: 12 }, (_, index) => `N${index}[Node ${index}] --> N${index + 1}[Node ${index + 1}]`).join('\n')}`;
    await writeFile(join(directory, `diagram-${direction}.md`), `# Diagram\n\n\`\`\`mermaid\n${diagram}\n\`\`\`\n`);
  }
  for (const theme of ['light', 'dark']) {
    await page.addInitScript((value) => localStorage.setItem('markport-theme', value), theme);
    for (const direction of directions) {
      await page.setViewportSize({ width: 900, height: 650 });
      await page.goto(`http://127.0.0.1:${port}/?path=diagram-${direction}.md`);
      const expand = page.getByRole('button', { name: 'Expand' });
      await expect(expand).toBeVisible({ timeout: 15000 });
      await expand.click();
      const dialog = page.getByRole('dialog', { name: 'Expanded Mermaid diagram' });
      await expect(dialog).toBeVisible();
      await expect(page.locator('#overlay-close')).toBeFocused();
      await expect(page.locator('#overlay-zoom-status')).not.toHaveText('');
      const bounds = await page.locator('#overlay-viewport').evaluate((viewport) => {
        const image = viewport.querySelector('#overlay-content')!.getBoundingClientRect(); const space = viewport.getBoundingClientRect();
        return { left: image.left - space.left, top: image.top - space.top, right: space.right - image.right, bottom: space.bottom - image.bottom };
      });
      expect(Math.min(...Object.values(bounds))).toBeGreaterThanOrEqual(-2);
      const sourceFill = await page.locator('.diagram-image svg .node').first().evaluate((node) => getComputedStyle(node).fill);
      const overlayFill = await page.locator('#overlay-content svg .node').first().evaluate((node) => getComputedStyle(node).fill);
      expect(overlayFill).toBe(sourceFill);
      await page.getByRole('button', { name: 'Zoom in' }).click();
      const zoomed = await page.locator('#overlay-zoom-status').textContent();
      await page.getByRole('button', { name: '100%' }).click();
      await expect(page.locator('#overlay-zoom-status')).toHaveText('100%');
      await page.getByRole('button', { name: 'Fit diagram' }).click();
      await expect(page.locator('#overlay-zoom-status')).not.toHaveText(zoomed ?? '');
      if (theme === 'light' && direction === 'LR') {
        const fitted = await page.locator('#overlay-zoom-status').textContent();
        const center = (await page.locator('#overlay-viewport').boundingBox())!;
        await page.mouse.move(center.x + center.width / 2, center.y + center.height / 2);
        await page.keyboard.down('Control'); await page.mouse.wheel(0, -180); await page.keyboard.up('Control');
        await expect(page.locator('#overlay-zoom-status')).not.toHaveText(fitted ?? '');
        const client = await page.context().newCDPSession(page);
        const x = center.x + center.width / 2; const y = center.y + center.height / 2;
        await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x - 20, y, id: 1 }, { x: x + 20, y, id: 2 }] });
        const beforePinch = await page.locator('#overlay-zoom-status').textContent();
        await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x - 45, y, id: 1 }, { x: x + 45, y, id: 2 }] });
        await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await expect(page.locator('#overlay-zoom-status')).not.toHaveText(beforePinch ?? '');
        await client.detach();
      }
      const before = await page.locator('#overlay-content').evaluate((element) => getComputedStyle(element).transform);
      const viewport = page.locator('#overlay-viewport');
      const box = (await viewport.boundingBox())!;
      await page.mouse.move(box.x + 100, box.y + 100);
      await page.mouse.down(); await page.mouse.move(box.x + 140, box.y + 130); await page.mouse.up();
      const after = await page.locator('#overlay-content').evaluate((element) => getComputedStyle(element).transform);
      expect(after).not.toBe(before);
      await page.keyboard.press('Tab');
      expect(await page.evaluate(() => document.activeElement?.closest('dialog')?.id)).toBe('diagram-overlay');
      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();
      await expect(expand).toBeFocused();
    }
  }
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

test('opens and refreshes PDF previews in both panes', async ({ page }) => {
  await page.goto(`http://127.0.0.1:${port}/?path=README.md`);
  await page.getByRole('link', { name: 'PDF', exact: true }).click();
  await expect(page).toHaveURL(/path=docs%2Fsample.pdf/);
  const preview = page.locator('#content .pdf-preview');
  await expect(preview).toBeVisible();
  await expect(preview).not.toHaveAttribute('sandbox');
  await expect(page.locator('#file-title .kind-badge')).toHaveText('PDF');
  await expect(page.locator('#file-title .view-segment').getByRole('button', { name: 'Source' })).toHaveCount(0);
  const firstURL = await preview.getAttribute('src');
  expect(firstURL).toContain('/api/pdf?path=docs%2Fsample.pdf');
  const response = await page.request.get(`http://127.0.0.1:${port}${firstURL}`);
  expect(response.headers()['content-type']).toBe('application/pdf');
  expect((await response.body()).subarray(0, 8).toString()).toBe('%PDF-1.4');
  await page.getByRole('button', { name: 'Open docs/sample.pdf on right' }).click();
  const rightPreview = page.locator('#right-content .pdf-preview');
  await expect(rightPreview).toBeVisible();
  const rightFirstURL = await rightPreview.getAttribute('src');
  await expect(page.locator('#right-views')).toBeHidden();
  await writeFile(join(directory, 'docs', 'sample.pdf'), pdfFixture('Updated PDF with more text'));
  await expect.poll(() => preview.getAttribute('src'), { timeout: 15000 }).not.toBe(firstURL);
  await expect.poll(() => rightPreview.getAttribute('src'), { timeout: 15000 }).not.toBe(rightFirstURL);
  const popup = page.waitForEvent('popup');
  await page.locator('#file-title').getByRole('button', { name: 'Open PDF in new tab' }).click();
  const opened = await popup;
  // Headless Chromium opens native PDFs through a blank popup, so navigation is covered by the unit test.
  expect(opened).toBeTruthy();
  await opened.close();
  const download = page.waitForEvent('download');
  await page.locator('#file-title').getByRole('button', { name: 'Download' }).click();
  expect((await download).suggestedFilename()).toBe('sample.pdf');
});

test('tracks imported descendants and an in-root directory move', async ({ page }) => {
  const source = await mkdtemp(join(tmpdir(), 'markport-import-'));
  await mkdir(join(source, 'folder', 'child'), { recursive: true });
  await writeFile(join(source, 'folder', 'child', 'nested.md'), '# Nested first\n');
  await page.goto(`http://127.0.0.1:${port}/`);
  await expect(page.locator('#connection')).toHaveText('Live · auto-refresh on');
  await expect(page.locator('#connection')).toHaveAttribute('title', 'Live · auto-refresh on');
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
  await page.goto(`http://127.0.0.1:${port}/?path=docs%2Finteractive.html`);
  await page.locator('#file-title .interactive-toggle').click();
  await expect(page.frameLocator('#content .html-preview').locator('body')).toHaveAttribute('data-local-script', 'ready');
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
  await page.goto(`http://127.0.0.1:${port}/?path=docs%2Finteractive.html`);
  await expect(page.locator('#file-title .interactive-toggle')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.frameLocator('#content .html-preview').locator('body')).not.toHaveAttribute('data-local-script', 'ready');
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
  await expect(page.locator('.mermaid-source .diagram-image svg')).toBeVisible({ timeout: 15000 });
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 800 });
    for (const theme of ['light', 'dark']) {
      await page.evaluate((value) => { localStorage.setItem('markport-theme', value); }, theme);
      await page.reload();
      await expect(page.locator('.mermaid-source .diagram-image svg')).toBeVisible({ timeout: 15000 });
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      const brand = page.locator('.brand-symbol');
      await expect(brand).toBeVisible();
      await expect(page.getByRole('img', { name: 'markport' })).toBeVisible();
      await expect(page.locator('header .brand img')).toHaveCount(1);
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
  if (!(await page.locator('#theme-toggle').isVisible())) await page.getByRole('button', { name: 'App settings' }).click();
  await page.getByRole('button', { name: 'Theme: Light' }).click();
  await page.getByRole('menuitemradio', { name: 'Dark' }).click();
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
  await page.getByRole('button', { name: 'Preview' }).click();
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
  await page.locator('.code-toolbar').getByRole('button', { name: 'Copy', exact: true }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toMatch(/^print\(/);
});

test('highlights linked code lines and keeps wrapped line numbers aligned', async ({ page }) => {
  const file = join(directory, 'long-wrap.ts');
  await writeFile(file, `const first = 1;\nconst long = '${'x'.repeat(300)}';\nconst third = 3;\nconst fourth = 4;\nconst fifth = 5;\n`);
  await page.setViewportSize({ width: 900, height: 700 });
  await page.goto(`http://127.0.0.1:${port}/?path=long-wrap.ts#L2`);
  await expect(page.locator('#content .lnt.selected-code-line')).toHaveCount(1);
  await expect(page.locator('#content .line.selected-code-line')).toHaveCount(1);
  await page.locator('#content .lnlinks[href="#L5"]').click({ modifiers: ['Shift'] });
  await expect(page).toHaveURL(/#L2-L5$/);
  await expect(page.locator('#content .line.selected-code-line')).toHaveCount(4);
  await expect(page.locator('#content .copy-line-link')).toBeVisible();
  await page.getByRole('button', { name: 'Wrap lines' }).click();
  await expect(page.getByRole('button', { name: 'Wrap lines' })).toHaveAttribute('aria-pressed', 'true');
  const alignment = await page.locator('#content .lntd:last-child .line').evaluateAll((lines) => {
    const second = lines[1].getBoundingClientRect(); const third = lines[2].getBoundingClientRect();
    const number = lines[1].querySelector('.wrapped-line-number')!.getBoundingClientRect();
    return { lineTop: second.top, numberTop: number.top, lineHeight: second.height, nextTop: third.top, overflow: document.querySelector('#content .code-frame')!.scrollWidth > document.querySelector('#content .code-frame')!.clientWidth };
  });
  expect(alignment.numberTop).toBe(alignment.lineTop);
  expect(alignment.lineHeight).toBeGreaterThan(30);
  expect(alignment.nextTop).toBeGreaterThanOrEqual(alignment.lineTop + alignment.lineHeight);
  expect(alignment.overflow).toBe(false);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Wrap lines' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#content .line.selected-code-line')).toHaveCount(4);
  await writeFile(file, `const first = 1;\nconst long = '${'y'.repeat(300)}';\nconst third = 3;\nconst fourth = 4;\nconst fifth = 5;\n`);
  await expect(page.locator('#content .lntd:last-child .line').nth(1)).toContainText('yyyy', { timeout: 15000 });
  await expect(page.locator('#content .line.selected-code-line')).toHaveCount(4);
});

test('shows accessible icon tools and unclipped tooltips in documents and expanded views', async ({ page, context }, testInfo) => {
  const wide = `| ${Array.from({ length: 8 }, (_, i) => `Column ${i}`).join(' | ')} |\n|${'---|'.repeat(8)}\n|${' long cell value |'.repeat(8)}\n`;
  await writeFile(join(directory, 'icon-tools.md'), '# Icon tools\n\n```mermaid\nflowchart LR\n A[Start] --> B[Done]\n```\n\n```typescript\nconst message = "Hello";\n```\n\n' + wide + '\n$$x^2$$\n');
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto(`http://127.0.0.1:${port}/?path=icon-tools.md&right=icon-tools.md`);
  const tooltipFor = async (selector: string, label: string): Promise<void> => {
    const button = page.locator(selector); await button.focus();
    const tooltip = page.locator(`#${await button.getAttribute('aria-describedby')}`);
    await expect(tooltip).toBeVisible(); await expect(tooltip).toHaveText(label);
    expect(await tooltip.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return rect.left >= 0 && rect.top >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight && element.matches(':popover-open');
    })).toBe(true);
  };
  for (const pane of ['#content', '#right-content']) {
    await expect(page.locator(`${pane} .diagram-image svg`)).toBeVisible();
    await expect(page.locator(`${pane} .math-frame .katex`)).toBeVisible();
    const buttons = page.locator(`${pane} .tool-icon`);
    expect(await buttons.evaluateAll((elements) => elements.every((button) => button.getAttribute('aria-label') && !button.textContent?.trim() && button.querySelector('svg[aria-hidden="true"]')))).toBe(true);
    await expect(page.locator(`${pane} .code-wrap-toggle`)).toHaveAttribute('aria-pressed', pane === '#content' ? 'false' : 'true');
    await tooltipFor(`${pane} .code-wrap-toggle`, 'Wrap lines');
    await page.keyboard.press('Enter');
    await expect(page.locator('#content .code-wrap-toggle')).toHaveAttribute('aria-pressed', pane === '#content' ? 'true' : 'false');
    await expect(page.locator('#right-content .code-wrap-toggle')).toHaveAttribute('aria-pressed', pane === '#content' ? 'true' : 'false');
  }
  await page.locator('#right-content .code-wrap-toggle').evaluate((element: HTMLButtonElement) => element.blur());
  const hover = page.locator('#content .code-wrap-toggle'); await hover.hover();
  const hoverTooltip = page.locator(`#${await hover.getAttribute('aria-describedby')}`);
  const hoverBox = (await hoverTooltip.boundingBox())!;
  await page.mouse.move(hoverBox.x + hoverBox.width / 2, hoverBox.y + hoverBox.height / 2, { steps: 8 });
  await expect(hoverTooltip).toBeVisible();
  await page.mouse.move(0, 0); await expect(hoverTooltip).toHaveCount(0);
  await tooltipFor('#content [data-diagram-action="source"]', 'Source');
  await page.keyboard.press('Enter');
  await expect(page.locator('#content .diagram-source')).toBeVisible();
  await expect(page.locator('#content [data-diagram-action="source"]')).toHaveAttribute('aria-label', 'Diagram');
  await expect(page.locator('#content [data-diagram-action="source"]')).toHaveAttribute('data-icon', 'diagram');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Escape'); await expect(page.locator('.tool-tooltip')).toHaveCount(0);
  const expand = page.locator('#content [data-diagram-action="expand"]');
  await expand.click();
  await tooltipFor('#overlay-fit', 'Fit diagram');
  await page.keyboard.press('Enter');
  const fitted = await page.locator('#overlay-zoom-status').textContent();
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await expect(page.locator('#overlay-zoom-status')).not.toHaveText(fitted!);
  await page.getByRole('button', { name: '100%', exact: true }).click();
  await expect(page.locator('#overlay-zoom-status')).toHaveText('100%');
  await page.locator('#diagram-overlay').screenshot({ path: testInfo.outputPath('diagram-icons.png') });
  await page.keyboard.press('Escape'); await expect(expand).toBeFocused();
  await page.locator('#content .table-expand').click();
  await tooltipFor('#table-overlay .component-copy', 'Copy');
  await page.keyboard.press('Enter');
  await expect(page.locator('#table-overlay .tool-status')).toHaveText('Copied');
  await page.keyboard.press('Escape');
  await expect(page.locator('#content .table-expand')).toBeFocused();
  await page.locator('#content .table-expand').click();
  await expect(page.locator('#table-overlay .component-copy')).toHaveAttribute('data-icon', 'copy');
  await expect(page.locator('#table-overlay .component-copy')).not.toHaveAttribute('data-feedback');
  await page.keyboard.press('Escape');
  for (const theme of ['Light', 'Dark', 'Nord']) {
    await page.getByRole('button', { name: /^Theme:/ }).click();
    await page.getByRole('menuitemradio', { name: theme, exact: true }).click();
    await page.screenshot({ path: testInfo.outputPath(`tools-${theme.toLowerCase()}.png`) });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await tooltipFor('#content .code-wrap-toggle', 'Wrap lines');
  const button = page.locator('#content .code-wrap-toggle');
  const dimensions = await button.evaluate((element) => ({ width: element.getBoundingClientRect().width, height: element.getBoundingClientRect().height }));
  expect(dimensions).toEqual({ width: 40, height: 40 });
  await page.screenshot({ path: testInfo.outputPath('tools-mobile.png'), animations: 'disabled' });
});

test('copies component sources in both panes, expanded views, and after refresh', async ({ page, context }) => {
  test.setTimeout(60000);
  const diagram = 'flowchart LR\n A[日本語] --> B[Done]\n';
  const table = '| Name | Value |\n| :--- | ---: |\n| **bold** | [original](small.md) |\n| a\\|b | $x_1$ |\n';
  const wide = `| ${Array.from({ length: 8 }, (_, i) => `Column ${i}`).join(' | ')} |\n|${'---|'.repeat(8)}\n|${' long cell value |'.repeat(8)}\n`;
  const formula = '\\[\nx_1 + \\frac{1}{2}\n\\]';
  const markdown = `# Copy components\n\n\`\`\`mermaid\n${diagram}\`\`\`\n\n${table}\n${wide}\n${formula}\n\nInline $x_2$.\n`;
  await writeFile(join(directory, 'copy-components.md'), markdown);
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto(`http://127.0.0.1:${port}/?path=copy-components.md&right=copy-components.md`);
  const copy = async (selector: string, expected: string): Promise<void> => {
    const button = page.locator(selector).locator('.component-copy');
    await button.click(); await expect(button).toHaveAttribute('data-feedback', 'Copied');
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(expected);
  };
  for (const pane of ['#content', '#right-content']) {
    await expect(page.locator(`${pane} [data-mermaid] .diagram-image svg`)).toBeVisible();
    await expect(page.locator(`${pane} .math-frame .katex`)).toHaveCount(1);
    await expect(page.locator(`${pane} .math-frame`)).toHaveCount(1);
    await copy(`${pane} [data-mermaid]`, diagram);
    await copy(`${pane} .table-frame >> nth=0`, table);
    await copy(`${pane} .math-frame`, formula);
    await page.locator(`${pane} [data-mermaid]`).getByRole('button', { name: 'Source', exact: true }).click();
    await copy(`${pane} [data-mermaid]`, diagram);
    await page.locator(`${pane} [data-mermaid]`).getByRole('button', { name: 'Expand', exact: true }).click();
    await copy('#diagram-overlay', diagram);
    await page.keyboard.press('Escape');
    await page.locator(`${pane} .table-frame`).nth(1).getByRole('button', { name: 'Expand', exact: true }).click();
    await copy('#table-overlay', wide);
    await page.keyboard.press('Escape');
  }
  await page.getByRole('button', { name: /^Theme:/ }).click();
  await page.getByRole('menuitemradio', { name: 'Nord', exact: true }).click();
  await expect(page.locator('#content .diagram-source')).toBeVisible();
  await copy('#content [data-mermaid]', diagram);
  await expect(page.locator('#content .diagram-actions .component-copy')).toHaveCount(1);
  await writeFile(join(directory, 'copy-components.md'), markdown.replace('**bold**', '**updated**'));
  for (const pane of ['#content', '#right-content']) {
    await expect(page.locator(`${pane} .table-frame`).first()).toContainText('updated');
    await copy(`${pane} .table-frame >> nth=0`, table.replace('**bold**', '**updated**'));
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await copy('#content .table-frame >> nth=0', table.replace('**bold**', '**updated**'));
});

test('copies pasted component sources and rendering errors without duplicating controls', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const diagram = 'flowchart LR\n A -->\n';
  const table = '| A | B |\n|---|---|\n| [local](other.md) | **bold** |\n';
  const formula = '$$\\notARealCommand{x}$$';
  await page.goto(`http://127.0.0.1:${port}/?view=paste`);
  await page.getByLabel('Markdown Text').fill(`\`\`\`mermaid\n${diagram}\`\`\`\n\n${table}\n${formula}`);
  await page.getByRole('button', { name: 'Rendered', exact: true }).click();
  await expect(page.locator('.paste-preview .diagram-error')).toBeVisible();
  await expect(page.locator('.paste-preview .math-error')).toBeVisible();
  for (const [selector, expected] of [['[data-mermaid]', diagram], ['.table-frame', table], ['.math-frame', formula]]) {
    const button = page.locator(`.paste-preview ${selector} .component-copy`);
    await button.focus(); await page.keyboard.press('Enter'); await expect(button).toHaveAttribute('data-feedback', 'Copied');
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(expected);
  }
  for (const view of ['Text', 'Rendered', 'Split']) await page.getByRole('button', { name: view, exact: true }).click();
  await expect(page.locator('.paste-preview .component-copy')).toHaveCount(3);
  await page.setViewportSize({ width: 390, height: 844 });
  // Paste Split falls back to Text on narrow screens; reopen its preview.
  await page.getByRole('button', { name: 'Rendered', exact: true }).click();
  await expect(page.locator('.paste-preview .table-frame .component-copy')).toBeVisible();
});

test('copies components with the fallback inside expanded modals and reports failures', async ({ page, context }) => {
  test.setTimeout(60000);
  const diagram = 'flowchart LR\n A --> B\n';
  const table = `| ${Array.from({ length: 8 }, (_, i) => `Column ${i}`).join(' | ')} |\n|${'---|'.repeat(8)}\n|${' long cell value |'.repeat(8)}\n`;
  const formula = '$$x^2$$';
  const errors: string[] = []; page.on('pageerror', (error) => errors.push(error.message));
  await writeFile(join(directory, 'copy-fallback-components.md'), `\`\`\`mermaid\n${diagram}\`\`\`\n\n${table}\n${formula}`);
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto(`http://127.0.0.1:${port}/?path=copy-fallback-components.md`);
  await expect(page.locator('[data-mermaid] .diagram-image svg')).toBeVisible();
  const copy = async (selector: string, expected: string): Promise<void> => {
    await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined }));
    const button = page.locator(selector).locator('.component-copy'); await button.click();
    await expect(button).toHaveAttribute('data-feedback', 'Copied'); await expect(button).toBeFocused();
    expect(await page.evaluate(() => { Reflect.deleteProperty(navigator, 'clipboard'); return navigator.clipboard.readText(); })).toBe(expected);
  };
  await copy('#content [data-mermaid]', diagram);
  await copy('#content .table-frame', table);
  await copy('#content .math-frame', formula);
  await page.locator('[data-mermaid]').getByRole('button', { name: 'Expand' }).click();
  await copy('#diagram-overlay', diagram); await page.keyboard.press('Escape');
  await page.locator('.table-frame').getByRole('button', { name: 'Expand' }).click();
  await copy('#table-overlay', table);
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined }); document.execCommand = () => false;
  });
  await page.locator('#table-overlay .component-copy').click();
  await expect(page.locator('#table-overlay .component-copy')).toHaveAttribute('data-feedback', 'Copy failed');
  await expect(page.locator('#table-overlay textarea')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('copies Markdown blocks, code files, and paths without the Clipboard API', async ({ page, context }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await writeFile(join(directory, 'copy.md'), '```python\nprint("markdown")\n```\n\n```\nplain <text>\n```\n');
  await writeFile(join(directory, 'copy.py'), 'print("code file")\n');
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const hideClipboard = async () => page.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
  });
  const readClipboard = async () => page.evaluate(async () => {
    Reflect.deleteProperty(navigator, 'clipboard');
    return navigator.clipboard.readText();
  });

  await page.goto(`http://127.0.0.1:${port}/?path=copy.md`);
  const copyButtons = page.locator('.code-toolbar').getByRole('button', { name: 'Copy', exact: true });
  await expect(copyButtons).toHaveCount(2);
  await hideClipboard();
  await copyButtons.first().click();
  await expect(page.locator('.code-toolbar').first().getByRole('button', { name: 'Copy', exact: true })).toHaveAttribute('data-feedback', 'Copied');
  expect(await readClipboard()).toBe('print("markdown")\n');

  await hideClipboard();
  await copyButtons.last().click();
  await expect(page.locator('.code-toolbar').last().getByRole('button', { name: 'Copy', exact: true })).toHaveAttribute('data-feedback', 'Copied');
  expect(await readClipboard()).toBe('plain <text>\n');

  await page.goto(`http://127.0.0.1:${port}/?path=copy.py`);
  await hideClipboard();
  await page.locator('.code-toolbar').getByRole('button', { name: 'Copy', exact: true }).click();
  await expect(page.locator('.code-toolbar').getByRole('button', { name: 'Copy', exact: true })).toHaveAttribute('data-feedback', 'Copied');
  expect(await readClipboard()).toBe('print("code file")\n');

  await hideClipboard();
  await page.getByRole('button', { name: 'Copy path' }).click();
  await expect(page.getByRole('button', { name: 'Copy path', exact: true })).toHaveAttribute('title', 'Copied');
  expect(await readClipboard()).toBe('copy.py');

  await hideClipboard();
  await page.evaluate(() => { document.execCommand = () => false; });
  await page.locator('.code-toolbar').getByRole('button', { name: 'Copy', exact: true }).click();
  await expect(page.locator('.code-toolbar').getByRole('button', { name: 'Copy', exact: true })).toHaveAttribute('data-feedback', 'Copy failed');
  expect(pageErrors).toEqual([]);
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

test('filename search keeps names readable in a narrow sidebar', async ({ page }) => {
  await mkdir(join(directory, 'search-names', 'one'), { recursive: true });
  await mkdir(join(directory, 'search-names', 'two'), { recursive: true });
  const name = 'distinctive-long-filename.md';
  await writeFile(join(directory, 'search-names', 'one', name), '# One');
  await writeFile(join(directory, 'search-names', 'two', name), '# Two');
  await page.goto(`http://127.0.0.1:${port}/`);
  await page.evaluate(() => { localStorage.setItem('markport-sidebar-width', '200'); document.documentElement.style.setProperty('--sidebar-width', '200px'); });
  await page.locator('#search').fill(name);
  await expect(page.locator('#tree .search-results a')).toHaveCount(2);
  const rows = page.locator('#tree .search-results li');
  await expect(rows.nth(0).locator('.node-file-name')).toHaveText(name);
  await expect(rows.nth(1).locator('.node-file-name')).toHaveText(name);
  expect(await rows.nth(0).locator('.node-file-name').evaluate((element) => getComputedStyle(element).textOverflow === 'ellipsis' && getComputedStyle(element).whiteSpace === 'nowrap')).toBe(true);
  expect(await rows.nth(0).locator('.node-parent-path').textContent()).not.toBe(await rows.nth(1).locator('.node-parent-path').textContent());
  await page.locator('#search').press('ArrowDown');
  await expect(rows.nth(0).locator('a')).toBeFocused();
  await rows.nth(0).locator('.open-right').focus();
  await expect(rows.nth(0).locator('.open-right')).toBeFocused();
  await page.locator('#search').focus();
  await page.locator('#search').press('Escape');
  await expect(page.locator('#tree .search-results')).toHaveCount(0);
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

test('collapses all file folders on desktop and mobile without losing the selected file', async ({ page }) => {
  await page.goto(`http://127.0.0.1:${port}/?path=docs%2Fstyle.css`);
  const docs = page.locator('details[data-path="docs"]');
  const collapse = page.getByRole('button', { name: 'Collapse all folders' });
  await expect(docs).toHaveAttribute('open');
  await expect(collapse).toBeEnabled();
  await collapse.focus();
  await page.keyboard.press('Enter');
  await expect(docs).not.toHaveAttribute('open');
  await expect(page.getByRole('searchbox', { name: 'Search files' })).toBeFocused();
  await expect(collapse).toBeDisabled();
  await expect(page.locator('#content')).toContainText('color');
  await page.reload();
  await expect(docs).not.toHaveAttribute('open');
  await expect(collapse).toBeDisabled();

  await page.locator('#file-title .crumb').click();
  await expect(docs).toHaveAttribute('open');
  await page.getByRole('searchbox', { name: 'Search files' }).fill('style');
  await expect(collapse).toBeDisabled();
  await page.getByRole('searchbox', { name: 'Search files' }).fill('');
  await page.setViewportSize({ width: 390, height: 720 });
  await page.getByRole('button', { name: 'Open file list' }).click();
  await expect(collapse).toBeVisible();
  await collapse.click();
  await expect(docs).not.toHaveAttribute('open');
  await expect(page.locator('#content')).toContainText('color');
});

test('shows Git changes and refreshes a file diff', async ({ page }) => {
  const git = (...args: string[]): void => { execFileSync('git', ['-C', directory, ...args]); };
  git('init', '-q');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'Test');
  git('add', '.');
  git('commit', '-qm', 'initial');
  const committedSample = (await readFile(join(directory, 'sample.py'), 'utf8')).trim();
  await writeFile(join(directory, 'sample.py'), 'print("changed")\n');
  await writeFile(join(directory, 'new-diff.md'), `<script>alert(1)</script>${'x'.repeat(200)}END\n`);
  await page.goto(`http://127.0.0.1:${port}/?view=changes`);
  await expect(page.locator('#content .change-path', { hasText: 'sample.py' })).toBeVisible();
  await expect(page.locator('#content .change-path', { hasText: 'new-diff.md' })).toBeVisible();
  await page.setViewportSize({ width: 375, height: 800 });
  await page.getByRole('button', { name: 'Open file list' }).click();
  await page.getByRole('tab', { name: 'Changes' }).click();
  const reviewButton = page.locator('#changes-tree .review-toggle').first();
  await expect(reviewButton).toHaveAttribute('aria-label', /Mark reviewed:/);
  const row = page.locator('#changes-tree .change-list li').first();
  const positions = await row.evaluate((item) => {
    const link = item.querySelector('a')!.getBoundingClientRect();
    const button = item.querySelector('button')!.getBoundingClientRect();
    return { linkTop: link.top, buttonTop: button.top, linkWidth: link.width };
  });
  expect(positions.buttonTop).toBe(positions.linkTop);
  expect(positions.linkWidth).toBeGreaterThan(100);
  await page.getByRole('button', { name: 'Close file list' }).click();
  const count = page.locator('#content .review-count');
  await expect(count).toContainText('0 of');
  await page.locator('#content a[href*="new-diff.md"]').click();
  await expect(page.locator('.diff-added .diff-code')).toContainText('<script>alert(1)</script>');
  const diffScroll = await page.locator('.diff-frame').evaluate((frame) => {
    frame.scrollLeft = frame.scrollWidth;
    return { width: frame.clientWidth, content: frame.scrollWidth, offset: frame.scrollLeft };
  });
  expect(diffScroll.content).toBeGreaterThan(diffScroll.width);
  expect(diffScroll.offset).toBeGreaterThan(0);
  await page.setViewportSize({ width: 1280, height: 800 });
  expect(await page.locator('#content script').count()).toBe(0);
  await page.locator('#file-title .review-toggle').click();
  await expect(page.locator('#file-title .review-toggle')).toHaveAttribute('aria-pressed', 'true');
  await page.reload();
  await expect(page.locator('#file-title .review-toggle')).toHaveAttribute('aria-pressed', 'true');
  await page.waitForTimeout(3500);
  await expect(page.locator('#file-title .review-toggle')).toHaveAttribute('aria-pressed', 'true');
  await writeFile(join(directory, 'new-diff.md'), '<script>alert(2)</script>\n');
  await expect(page.locator('#file-title .review-toggle')).toHaveAttribute('aria-pressed', 'false', { timeout: 15000 });
  await expect(page.locator('.diff-added .diff-code')).toContainText('alert(2)');
  await page.getByRole('tab', { name: 'Changes' }).click();
  await expect(page.locator('#content .review-count')).toContainText('0 of');
  await page.locator('#content').getByLabel('Unreviewed only').check();
  await expect(page.locator('#content .change-path', { hasText: 'new-diff.md' })).toBeVisible();
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
  await expect(page.locator('#tree details[data-path="docs"] > summary')).toBeFocused();
  await page.getByRole('button', { name: 'Refresh' }).click();
  await expect(page.locator('#files-panel')).toBeVisible();
  await expect(page.locator('.diff-added .diff-code')).toContainText('color: red');
  await page.getByRole('tab', { name: 'History' }).click();
  await expect(page.locator('#history-tree .history-list a[href*="view=history"]')).toContainText('initial');
  await expect(page.locator('#content .history-files')).toBeVisible();
  await page.locator('#content .history-files a[href*="sample.py"]').click();
  await expect(page.locator('#content .diff-added .diff-code')).toContainText(committedSample);
  await page.locator('#content .history-back').click();
  await expect(page.locator('#content .history-files')).toBeVisible();
  const initialID = execFileSync('git', ['-C', directory, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  await page.locator('#history-tree .history-compare').first().click();
  await expect(page).toHaveURL(new RegExp(`view=changes&base=${initialID}`));
  await expect(page.locator('#content .change-path', { hasText: 'sample.py' })).toBeVisible();
  await page.locator('#content a[href*="sample.py"]').click();
  await expect(page.locator('.diff-added .diff-code')).toContainText('changed again');
  await expect(page.locator('.comparison-current')).toContainText(initialID.slice(0, 12));
  await page.getByRole('button', { name: 'Use HEAD' }).click();
  await expect(page).toHaveURL(/\?view=changes$/);
  await page.getByLabel('Compare with current from').fill(initialID.slice(0, 9));
  await page.getByRole('button', { name: 'Compare', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`view=changes&base=${initialID}`));
});

test('reviews changed files in order with counts and a folder tree', async ({ page }) => {
  const expectDiffReady = async (path: string): Promise<void> => {
    await expect(page).toHaveURL((url) => url.searchParams.get('path') === path);
    await expect(page.locator('#file-title .breadcrumbs strong')).toHaveText(path.split('/').at(-1)!);
    await expect(page.locator('#content')).toHaveAttribute('aria-busy', 'false');
  };
  const changes = [
    { path: 'a.md', status: 'modified', revision: 'a1', added: 1, deleted: 2 },
    { path: 'b.md', status: 'added', revision: 'b1', added: 3, deleted: 0 },
    { path: 'docs/c.md', status: 'deleted', revision: 'c1', added: 0, deleted: 4 },
  ];
  await page.route('**/api/git/changes', (route) => route.fulfill({ json: { available: true, rootId: 'review-navigation-test', changes } }));
  await page.route('**/api/git/diff?**', (route) => {
    const path = new URL(route.request().url()).searchParams.get('path')!;
    return route.fulfill({ json: { path, kind: 'text', patch: `diff --git a/${path} b/${path}\n@@ -1 +1 @@\n-old\n+new\n` } });
  });
  await page.goto(`http://127.0.0.1:${port}/?view=changes`);
  await expect(page.locator('#content a[href*="a.md"] .change-lines')).toContainText('+1 −2');
  await expect(page.locator('#content').getByLabel('Folder tree')).toBeChecked();
  await expect(page.locator('#content .change-folder > details > summary .node-label')).toHaveText(['docs']);
  await page.locator('#content details[data-path="docs"] > summary').click();
  await expect(page.locator('#content details[data-path="docs"]')).not.toHaveAttribute('open');
  await expect(page.locator('#changes-tree details[data-path="docs"]')).not.toHaveAttribute('open');
  await page.locator('#content details[data-path="docs"] > summary').click();
  await page.locator('#content a[href*="docs%2Fc.md"]').click();
  await expectDiffReady('docs/c.md');
  await page.keyboard.press('n');
  await expectDiffReady('a.md');
  await page.getByRole('tab', { name: 'Changes' }).click();
  await page.locator('#content').getByLabel('Folder tree').uncheck();
  await page.locator('#content a[href*="b.md"]').click();
  await expectDiffReady('b.md');
  await expect(page.locator('#file-title .diff-navigation')).toBeVisible();
  await page.keyboard.press('n');
  await expectDiffReady('docs/c.md');
  await expect(page.getByRole('button', { name: 'Next (n)' })).toBeDisabled();
  await page.keyboard.press('p');
  await expectDiffReady('b.md');
  await page.keyboard.press('r');
  await expectDiffReady('docs/c.md');
  await expect(page.locator('#changes-tree .review-count')).toContainText('1 of 3 reviewed');
  await page.locator('#changes-tree').getByLabel('Unreviewed only').check();
  await page.keyboard.press('p');
  await expectDiffReady('a.md');
  await page.locator('#changes-tree .review-filter input').first().focus();
  await expect(page.locator('#changes-tree .review-filter input').first()).toBeFocused();
  await page.keyboard.press('n');
  expect(new URL(page.url()).searchParams.get('path')).toBe('a.md');
  await page.locator('#changes-tree .review-filter input').first().blur();
  await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', isComposing: true, bubbles: true })));
  expect(new URL(page.url()).searchParams.get('path')).toBe('a.md');
});

test('uses the available paste viewport and aligns the native editor with Markdown highlights', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`http://127.0.0.1:${port}/?view=paste`);
  const input = page.getByLabel('Markdown Text');
  await expect(input).toBeFocused();
  const box = (await input.boundingBox())!;
  expect(box.width).toBeGreaterThan(800); expect(box.height).toBeGreaterThan(690); expect(box.y + box.height).toBeLessThanOrEqual(890);
  const markdown = '# 日本語 Heading\n\n**strong** *emphasis* `code` [link](https://example.com)\n\n```ts\nconst text = "safe";\n```\n' + '- 日本語 and long text '.repeat(30) + '\n' + 'line\n'.repeat(150);
  await input.fill(markdown);
  await expect(page.locator('.paste-highlight .paste-heading')).toHaveText('# 日本語 Heading');
  await expect(page.locator('.paste-highlight .paste-code-block')).toHaveText('const text = "safe";');
  const geometry = await input.evaluate((node) => {
    const pre = document.querySelector<HTMLElement>('.paste-highlight')!; const a = getComputedStyle(node); const b = getComputedStyle(pre);
    return { height: node.scrollHeight, highlightHeight: pre.scrollHeight, shared: ['font', 'lineHeight', 'padding', 'borderWidth', 'whiteSpace', 'overflowWrap', 'tabSize', 'letterSpacing'].every((key) => a.getPropertyValue(key.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase())) === b.getPropertyValue(key.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase()))) };
  });
  expect(geometry.shared).toBe(true); expect(Math.abs(geometry.height - geometry.highlightHeight)).toBeLessThanOrEqual(2);
  await input.evaluate((node) => { node.scrollTop = 900; node.dispatchEvent(new Event('scroll')); });
  expect(await page.locator('.paste-highlight').evaluate((node) => node.scrollTop)).toBe(await input.evaluate((node) => node.scrollTop));
  await page.getByRole('button', { name: 'Paste options' }).click(); await page.getByLabel('Monospace font').uncheck(); await page.getByLabel('Readable width').check();
  await expect(page.locator('#content')).toHaveClass(/paste-proportional/); await expect(page.locator('#content')).toHaveClass(/paste-readable/);
  await input.focus(); await input.press('Control+Enter');
  await expect(page.getByRole('button', { name: 'Rendered', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.paste-preview h1')).toHaveText('日本語 Heading');
  expect((await page.locator('.paste-preview').boundingBox())!.width).toBeLessThanOrEqual(736);
  await page.getByRole('button', { name: 'Rendered', exact: true }).press('Control+Enter');
  await expect(page.getByRole('button', { name: 'Text', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(input).toHaveValue(markdown);
  await expect(page.locator('.paste-editor-surface > .paste-highlight')).toBeVisible();
  await expect(page.locator('.paste-editor .code-frame')).toHaveCount(0);
});

test('continues lists, indents selections, preserves Undo and exits the paste editor on Escape', async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 800 });
  await page.goto(`http://127.0.0.1:${port}/?view=paste`);
  const input = page.getByLabel('Markdown Text'); await input.fill('- [x] done'); await input.press('End'); await input.press('Enter');
  await expect(input).toHaveValue('- [x] done\n- [ ] ');
  await input.press('Control+z'); await expect(input).toHaveValue('- [x] done');
  await input.press('Control+Shift+z'); await expect(input).toHaveValue('- [x] done\n- [ ] ');
  await input.press('Enter'); await expect(input).toHaveValue('- [x] done\n');
  await input.fill('one\ntwo'); await input.press('Control+a'); await input.press('Tab'); await expect(input).toHaveValue('  one\n  two');
  await input.press('Shift+Tab'); await expect(input).toHaveValue('one\ntwo');
  await input.press('Escape'); await expect(input).not.toBeFocused(); await page.keyboard.press('Tab'); await expect(page.getByRole('button', { name: 'Rendered', exact: true })).toBeFocused();
  await input.focus(); await input.evaluate((node) => (node as HTMLTextAreaElement).setSelectionRange(2, 4)); await page.reload();
  await expect(input).toBeFocused(); expect(await input.evaluate((node) => [(node as HTMLTextAreaElement).selectionStart, (node as HTMLTextAreaElement).selectionEnd])).toEqual([2, 4]);
});

test('debounces Split preview and follows headings', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 }); await page.goto(`http://127.0.0.1:${port}/?view=paste`);
  let requests = 0;
  await page.route('**/api/render', async (route) => { requests++; await route.continue(); });
  const input = page.getByLabel('Markdown Text'); await input.fill('# First'); await page.getByRole('button', { name: 'Split', exact: true }).click();
  await expect(page.locator('.paste-preview h1')).toHaveText('First'); await expect(input).toBeVisible();
  await input.fill('# Second'); await input.fill('# Latest');
  await page.waitForTimeout(150); expect(requests).toBe(1);
  await expect(page.locator('.paste-preview h1')).toHaveText('Latest'); expect(requests).toBe(2);
  const long = '# Top\n\n' + 'paragraph\n\n'.repeat(70) + '# Middle\n\n' + 'paragraph\n\n'.repeat(70) + '# Bottom\n';
  await input.fill(long); await expect(page.locator('.paste-preview h1')).toHaveCount(3);
  await input.evaluate((node) => { node.scrollTop = node.scrollHeight / 2; node.dispatchEvent(new Event('scroll')); });
  expect(await page.locator('.paste-preview').evaluate((node) => node.scrollTop)).toBeGreaterThan(0);
  await page.locator('.paste-preview').evaluate((node) => { node.scrollTop = 0; node.dispatchEvent(new Event('scroll')); });
  await expect.poll(() => input.evaluate((node) => node.scrollTop)).toBe(0);
  await page.setViewportSize({ width: 600, height: 800 }); await expect(page.getByRole('button', { name: 'Split', exact: true })).toBeHidden(); await expect(page.getByRole('button', { name: 'Text', exact: true })).toHaveAttribute('aria-pressed', 'true');
});

test('offers confirmed Clear, copying, download and opt-in browser persistence', async ({ page, context }) => {
  await page.goto(`http://127.0.0.1:${port}/?view=paste`); const input = page.getByLabel('Markdown Text'); await input.fill('# Private note');
  expect(await page.evaluate(() => localStorage.getItem('markport-pasted-markdown'))).toBeNull();
  await page.getByRole('button', { name: 'Paste options' }).click(); await page.getByLabel('Save in this browser').check();
  const other = await context.newPage(); await other.goto(`http://127.0.0.1:${port}/?view=paste`); await expect(other.getByLabel('Markdown Text')).toHaveValue('# Private note'); await other.close();
  await page.getByLabel('Save in this browser').uncheck(); expect(await page.evaluate(() => localStorage.getItem('markport-pasted-markdown'))).toBeNull();
  const downloadPromise = page.waitForEvent('download'); await page.getByRole('button', { name: 'Save as .md' }).click(); const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('pasted-markdown.md'); expect(await readFile((await download.path())!, 'utf8')).toBe('# Private note');
  await context.grantPermissions(['clipboard-read', 'clipboard-write']); await page.getByRole('button', { name: 'Paste options' }).click(); await page.getByRole('button', { name: 'Copy all' }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('# Private note');
  await page.getByRole('button', { name: 'Paste options' }).click(); page.once('dialog', (dialog) => { void dialog.dismiss(); }); await page.getByRole('button', { name: 'Clear', exact: true }).click(); await expect(input).toHaveValue('# Private note');
  await page.getByRole('button', { name: 'Paste options' }).click(); page.once('dialog', (dialog) => { void dialog.accept(); }); await page.getByRole('button', { name: 'Clear', exact: true }).click(); await expect(input).toBeEmpty();
});

test('keeps the paste surface visible on mobile and when the visual viewport shrinks', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto(`http://127.0.0.1:${port}/?view=paste`); const input = page.getByLabel('Markdown Text');
  await input.fill('# Mobile\n\n日本語のメモ'); await expect(input).toBeFocused();
  const box = (await input.boundingBox())!; expect(box.width).toBeGreaterThan(340); expect(box.height).toBeGreaterThan(600);
  await page.evaluate(() => { Object.defineProperty(window.visualViewport!, 'height', { configurable: true, value: 420 }); window.visualViewport!.dispatchEvent(new Event('resize')); });
  await expect.poll(async () => { const visible = (await input.boundingBox())!; return visible.y + visible.height; }).toBeLessThanOrEqual(420);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await input.press('Control+Enter'); await expect(page.locator('.paste-preview h1')).toHaveText('Mobile');
});
