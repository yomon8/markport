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
const diagramDefinitions = [
  'flowchart TB\n subgraph Work[処理の流れ]\n A[開始] --> B{"内容を確認<br/>次の処理を選択"}\n B -->|はい| C[日本語の長いラベルを含む処理の説明]\n B -->|いいえ| D[終了]\n C --> D\n end',
  'sequenceDiagram\n participant A as 利用者\n participant B as サーバー\n A->>B: 文書を要求\n B-->>A: 描画した文書',
  'stateDiagram-v2\n [*] --> 待機\n 待機 --> 処理中: 開始\n 処理中 --> 完了\n 完了 --> [*]',
  'classDiagram\n class Document {\n +String title\n +render()\n }\n class Browser\n Browser --> Document: 表示',
  'erDiagram\n USER ||--o{ DOCUMENT : reads\n DOCUMENT {\n string title\n }',
  'gantt\n title 作業予定\n dateFormat YYYY-MM-DD\n section 文書\n 調査 :a, 2026-01-01, 2d\n 実装 :after a, 3d',
  'pie title 文書の種類\n "Markdown" : 60\n "Code" : 40',
  'flowchart LR\n A[指定色] --> B[標準色]\n classDef authored fill:#ffdd88,stroke:#885500,color:#222222\n class A authored\n style B fill:#ddffdd,stroke:#225522,color:#222222\n linkStyle 0 stroke:#cc3366,stroke-width:3px',
];
const diagramMarkdown = '# Mermaid appearance\n\n' + diagramDefinitions.map((definition) => `\`\`\`mermaid\n${definition}\n\`\`\``).join('\n\n');
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
  await writeFile(join(directory, 'diagrams.md'), diagramMarkdown);
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

test('renders Japanese diagrams and author styles across diagram families', async ({ page }, testInfo) => {
  test.setTimeout(60000);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto(url('?path=diagrams.md'));
  for (const theme of ['Light', 'Dark', 'Sepia', 'Nord']) {
    await expect(page.locator('#content .diagram-image svg')).toHaveCount(diagramDefinitions.length);
    const previousId = await page.locator('#content .diagram-image svg').last().getAttribute('id');
    const previousTheme = await page.locator('html').getAttribute('data-theme');
    await choose(page, theme);
    if (previousTheme !== theme.toLowerCase()) {
      await expect(page.locator('#content .diagram-image svg').last()).not.toHaveAttribute('id', previousId!);
    }
    await expect(page.locator('#content .diagram-image svg')).toHaveCount(diagramDefinitions.length);
    await expect(page.locator('#content .diagram-error')).toHaveCount(0);
    await expect(page.locator('#content .diagram-image').first()).toContainText('日本語の長いラベル');
    const authored = page.locator('#content .diagram-image').last();
    await expect(authored.locator('.node > rect').first()).toHaveCSS('fill', 'rgb(255, 221, 136)');
    await expect(authored.locator('.node > rect').last()).toHaveCSS('fill', 'rgb(221, 255, 221)');
    await expect(authored.locator('path.flowchart-link')).toHaveCSS('stroke', 'rgb(204, 51, 102)');
    const label = page.locator('#content .diagram-image .nodeLabel').first();
    await expect(label).toHaveCSS('font-size', '16px');
    await expect(label).toHaveCSS('font-family', await page.locator('html').evaluate((root) => getComputedStyle(root).fontFamily));
    const mutedColor = await page.locator('html').evaluate((root) => {
      const probe = document.createElement('span'); probe.style.color = 'var(--text-muted)'; root.append(probe);
      const color = getComputedStyle(probe).color; probe.remove(); return color;
    });
    await expect(page.locator('#content .diagram-image').nth(6).locator('path').first()).toHaveCSS('stroke', mutedColor);
    await expect(page.locator('#content .diagram-image').nth(5).locator('.taskText').first()).toHaveCSS('font-size', '16px');
    const clippedLabels = await page.locator('#content .diagram-image').first().evaluate((image) => [...image.querySelectorAll('.node')].filter((node) => {
      const shape = node.querySelector<SVGGraphicsElement>(':scope > .label-container');
      const label = node.querySelector<SVGGraphicsElement>('.label');
      if (!shape || !label) return false;
      const outer = shape.getBoundingClientRect(); const inner = label.getBoundingClientRect();
      return inner.left < outer.left - 1 || inner.right > outer.right + 1 || inner.top < outer.top - 1 || inner.bottom > outer.bottom + 1;
    }).length);
    expect(clippedLabels).toBe(0);
    await page.screenshot({ path: testInfo.outputPath(`mermaid-${theme.toLowerCase()}.png`), fullPage: true });
    for (const [index, diagram] of (await page.locator('#content [data-mermaid]').all()).entries()) {
      await diagram.screenshot({ path: testInfo.outputPath(`mermaid-${theme.toLowerCase()}-${index + 1}.png`) });
    }
    await page.locator('#main').evaluate((main) => { main.scrollTop = 0; });
  }
});

for (const width of [1280, 390, 320]) {
  test(`keeps diagrams readable and scrollable at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.emulateMedia({ colorScheme: 'light' });
    await page.goto(url('?path=demo.md&right=demo.md'));
    for (const pane of ['#content', '#right-content']) {
      const diagram = page.locator(`${pane} .diagram-image`);
      await expect(diagram.locator('svg')).toBeVisible();
      await expect(diagram.locator('.nodeLabel').first()).toHaveCSS('font-size', '16px');
      await expect(page.locator(`${pane} [data-mermaid]`)).toHaveCSS('padding', '16px');
      await expect(page.locator(`${pane} [data-mermaid]`)).toHaveCSS('border-radius', '12px');
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.locator('#content [data-diagram-action=expand]').click();
    await expect(page.locator('#overlay-content .nodeLabel').first()).toHaveCSS('font-size', '16px');
    await page.keyboard.press('Escape');
    if (!(await page.locator('#paste-toggle').isVisible())) await page.getByRole('button', { name: 'App settings' }).click();
    await page.locator('#paste-toggle').click();
    await page.locator('#paste-input').fill(diagramMarkdown);
    await page.getByRole('button', { name: 'Rendered', exact: true }).click();
    await expect(page.locator('#content .diagram-image svg')).toHaveCount(diagramDefinitions.length);
    await expect(page.locator('#content .diagram-error')).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const wide = page.locator('#content .diagram-image').last();
    expect(await wide.evaluate((image) => {
      if (image.scrollWidth <= image.clientWidth) return true;
      image.scrollLeft = 20; return image.scrollLeft > 0;
    })).toBe(true);
  });
}

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
  await page.getByRole('button', { name: 'Rendered' }).click();
  await expect(page.locator('#content .diagram-image svg')).toBeVisible();
  await page.locator('#content [data-diagram-action=source]').click();
  await expect(page.locator('.diagram-source')).toBeVisible();
  await page.locator('.paste-preview').evaluate((main) => { main.scrollTop = 300; });
  for (const preset of presets.slice(2)) {
    await choose(page, preset.label);
    await expect(page.locator('#content .diagram-image .node rect').first()).toHaveCSS('fill', preset.node);
    await expect(page.locator('.diagram-source')).toBeVisible();
    expect(await page.locator('.paste-preview').evaluate((main) => main.scrollTop)).toBe(300);
  }
  await page.getByRole('button', { name: 'Text', exact: true }).click();
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

test('recolors pasted Markdown immediately in every theme without rebuilding the highlight layer', async ({ page }) => {
  await page.goto(url('?view=paste')); await page.getByLabel('Markdown Text').fill('# Heading\n\n`code` **strong** *em* ~~gone~~ $x$ <!-- comment -->');
  await expect(page.locator('.paste-heading')).toBeVisible();
  await page.locator('.paste-highlight').evaluate((node) => {
    (window as unknown as { pasteHighlightMutations: number }).pasteHighlightMutations = 0;
    new MutationObserver(() => (window as unknown as { pasteHighlightMutations: number }).pasteHighlightMutations++).observe(node, { childList: true, subtree: true });
  });
  for (const label of ['Light', 'Dark', ...presets.map((preset) => preset.label)]) {
    await choose(page, label);
    const colors = await page.locator('.paste-highlight').evaluate((node) => {
      const pairs = [['.paste-heading', '--accent'], ['.paste-inline-code', '--syntax-string'], ['.paste-strong', '--syntax-keyword'], ['.paste-emphasis', '--syntax-constant'], ['.paste-strike', '--syntax-symbol'], ['.paste-math', '--syntax-function'], ['.paste-comment', '--syntax-comment']];
      return pairs.map(([selector, token]) => {
        const highlighted = node.querySelector(selector)!; const probe = document.createElement('span'); probe.style.color = `var(${token})`; document.body.append(probe);
        const same = getComputedStyle(highlighted).color === getComputedStyle(probe).color; probe.remove(); return same;
      });
    });
    expect(colors.every(Boolean)).toBe(true);
    expect(await page.evaluate(() => (window as unknown as { pasteHighlightMutations: number }).pasteHighlightMutations)).toBe(0);
  }
});
