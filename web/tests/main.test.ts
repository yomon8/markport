// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/mermaid', () => ({ drawMermaid: vi.fn(async () => {}) }));

type Entry = { name: string; path: string; type: 'directory' | 'file' };
const flush = async (): Promise<void> => { await new Promise((resolve) => setTimeout(resolve, 0)); };
const reply = (body: unknown, status = 200, tag = ''): Response => ({
  ok: status < 400, status, json: async () => body, headers: { get: () => tag },
}) as unknown as Response;
const page = (entries: Entry[], revision = '1', nextOffset: number | null = null, offset = 0) =>
  ({ entries, revision, offset, nextOffset, root: 'project' });
const entry = (name: string, type: 'directory' | 'file' = 'file', parent = ''): Entry =>
  ({ name, path: parent ? `${parent}/${name}` : name, type });

beforeEach(() => {
  vi.resetModules();
  localStorage.clear();
  document.body.innerHTML = '<div id="app"></div>';
  history.replaceState(null, '', '/');
});
afterEach(() => { window.dispatchEvent(new Event('pagehide')); vi.unstubAllGlobals(); });

describe('lazy browsing and refresh', () => {
  it('lists Git changes and renders a safe, refreshing diff', async () => {
    history.replaceState(null, '', '/?view=changes');
    let patch = 'diff --git a/new.md b/new.md\n--- /dev/null\n+++ b/new.md\n@@ -0,0 +1,1 @@\n+<script>alert(1)</script>\n';
    const fetch = vi.fn(async (url: string) => {
      if (url === '/api/tree') return reply(page([entry('new.md')]));
      if (url === '/api/git/changes') return reply({ available: true, changes: [{ path: 'new.md', status: 'added' }] });
      if (url === '/api/git/diff?path=new.md') return reply({ path: 'new.md', kind: 'text', patch });
      return reply({ path: 'new.md', type: 'markdown', html: '<h1>Preview</h1>' });
    });
    vi.stubGlobal('fetch', fetch);
    await import('../src/main'); await flush();
    expect(document.querySelector('#content .change-path')?.textContent).toBe('new.md');
    expect(document.querySelector('#changes-tree .change-path')?.textContent).toBe('new.md');
    document.querySelector<HTMLAnchorElement>('#content .change-list a')!.click(); await flush();
    expect(document.querySelector('.diff-added .diff-code')?.textContent).toContain('<script>');
    expect(document.querySelector('#content script')).toBeNull();
    expect(document.querySelector('.diff-added .diff-number:nth-child(2)')?.textContent).toBe('1');
    patch = patch.replace('alert(1)', 'alert(2)');
    document.dispatchEvent(new Event('visibilitychange')); await flush();
    expect(document.querySelector('.diff-added .diff-code')?.textContent).toContain('alert(2)');
    [...document.querySelectorAll<HTMLButtonElement>('.title-actions button')].find((button) => button.textContent === 'File')!.click(); await flush();
    expect(document.querySelector('#content h1')?.textContent).toBe('Preview');
  });

  it('explains when the selected directory is not a Git repository', async () => {
    history.replaceState(null, '', '/?view=changes');
    vi.stubGlobal('fetch', vi.fn(async (url: string) => url === '/api/tree' ? reply(page([])) : reply({ available: false, reason: 'not_repository', changes: [] })));
    await import('../src/main'); await flush();
    expect(document.querySelector('#content')?.textContent).toContain('This directory is not a Git repository.');
    expect(document.querySelector('#changes-tree')?.textContent).toContain('This directory is not a Git repository.');
  });

  it('previews HTML, switches to source, and reloads the preview manually', async () => {
    history.replaceState(null, '', '/?path=page.html');
    const fetch = vi.fn(async (url: string) => {
      if (url === '/api/tree') return reply(page([entry('page.html')]));
      if (url === '/api/file?path=page.html&source=1') return reply({ path: 'page.html', type: 'html', html: '<pre>HTML source</pre>' });
      return reply({ path: 'page.html', type: 'html', previewUrl: '/api/preview/page.html?v=1' });
    });
    vi.stubGlobal('fetch', fetch);
    await import('../src/main'); await flush();
    const frame = document.querySelector<HTMLIFrameElement>('.html-preview');
    expect(frame?.getAttribute('sandbox')).toBe('allow-same-origin');
    expect(frame?.src).toContain('/api/preview/page.html?v=1&reload=0');
    expect(document.querySelector('.kind-badge')?.textContent).toBe('HTML');
    [...document.querySelectorAll<HTMLButtonElement>('.title-actions button')].find((button) => button.textContent === 'Source')!.click(); await flush();
    expect(document.querySelector('#content pre')?.textContent).toBe('HTML source');
    const previewButton = [...document.querySelectorAll<HTMLButtonElement>('.title-actions button')].find((button) => button.textContent === 'Preview')!;
    previewButton.click(); await flush();
    document.querySelector<HTMLButtonElement>('#reload')!.click(); await flush();
    expect(document.querySelector<HTMLIFrameElement>('.html-preview')?.src).toContain('/api/preview/page.html?v=1&reload=1');
  });

  it('loads only root and selected ancestors for a deep URL', async () => {
    history.replaceState(null, '', '/?path=docs%2Fdeep%2Fa.md');
    const fetch = vi.fn(async (url: string) => {
      if (url === '/api/tree') return reply(page([entry('docs', 'directory')]));
      if (url.startsWith('/api/tree?path=docs%2Fdeep')) return reply(page([entry('a.md', 'file', 'docs/deep')]));
      if (url.startsWith('/api/tree?path=docs')) return reply(page([entry('deep', 'directory', 'docs')]));
      return reply({ path: 'docs/deep/a.md', type: 'markdown', html: '<h1>A</h1>' });
    });
    vi.stubGlobal('fetch', fetch);
    await import('../src/main'); await flush(); await flush();
    expect(document.querySelector('#content h1')?.textContent).toBe('A');
    expect(document.querySelector<HTMLDetailsElement>('details[data-path="docs"]')?.open).toBe(true);
    expect(document.querySelector<HTMLDetailsElement>('details[data-path="docs/deep"]')?.open).toBe(true);
    expect(fetch.mock.calls.map(([url]) => url)).toContain('/api/tree?path=docs%2Fdeep&focus=a.md');
  });

  it('loads the next page only when requested and searches loaded files', async () => {
    const first = Array.from({ length: 200 }, (_, i) => entry(`file${String(i).padStart(3, '0')}.md`));
    const fetch = vi.fn(async (url: string) => url === '/api/tree'
      ? reply(page(first, '1', 200))
      : reply(page([entry('last.md')], '1', null, 200)));
    vi.stubGlobal('fetch', fetch);
    await import('../src/main'); await flush();
    expect(document.querySelectorAll('#tree a').length).toBe(200);
    const search = document.querySelector<HTMLInputElement>('#search')!;
    search.value = 'last'; search.dispatchEvent(new Event('input'));
    expect(document.querySelector('#result-count')?.textContent).toContain('0 matches in loaded files');
    search.value = ''; search.dispatchEvent(new Event('input'));
    document.querySelector<HTMLButtonElement>('button[data-offset="200"]')!.click(); await flush();
    search.value = 'last'; search.dispatchEvent(new Event('input'));
    expect(document.querySelector('#tree a')?.textContent).toBe('last.md');
    expect(fetch.mock.calls.map(([url]) => url)).toContain('/api/tree?offset=200');
  });

  it('polls visible data, sends the file validator, and keeps the DOM on 304', async () => {
    history.replaceState(null, '', '/?path=a.md');
    let version = 1;
    const fetch = vi.fn(async (url: string, options?: RequestInit) => {
      if (url === '/api/tree') return reply(page(version === 1 ? [entry('a.md')] : [entry('a.md'), entry('new.md')], String(version)));
      if (options?.headers && (options.headers as Record<string, string>)['If-None-Match'] === `v${version}`) return reply(null, 304);
      return reply({ path: 'a.md', type: 'markdown', html: `<h1>Version ${version}</h1>` }, 200, `v${version}`);
    });
    vi.stubGlobal('fetch', fetch);
    await import('../src/main'); await flush();
    const first = document.querySelector('#content h1');
    document.dispatchEvent(new Event('visibilitychange')); await flush();
    expect(document.querySelector('#content h1')).toBe(first);
    expect(fetch.mock.calls.some(([, options]) => (options?.headers as Record<string, string> | undefined)?.['If-None-Match'] === 'v1')).toBe(true);
    version = 2;
    document.dispatchEvent(new Event('visibilitychange')); await flush();
    expect(document.querySelector('#content h1')?.textContent).toBe('Version 2');
    expect(document.querySelector<HTMLAnchorElement>('a[href="/?path=new.md"]')).not.toBeNull();
  });

  it('discards a stale listing after a newer refresh starts', async () => {
    let releaseFirst: ((value: Response) => void) | undefined;
    let calls = 0;
    vi.stubGlobal('fetch', vi.fn((url: string) => {
      if (url === '/api/tree' && ++calls === 1) return new Promise<Response>((resolve) => { releaseFirst = resolve; });
      return Promise.resolve(reply(page([entry('new.md')], '2')));
    }));
    await import('../src/main'); await flush();
    document.dispatchEvent(new Event('visibilitychange'));
    releaseFirst?.(reply(page([entry('old.md')], '1')));
    await flush(); await flush();
    expect(document.querySelector('#tree')?.textContent).toContain('new.md');
    expect(document.querySelector('#tree')?.textContent).not.toContain('old.md');
  });

  it('releases a collapsed directory and loads it again when opened', async () => {
    const fetch = vi.fn(async (url: string) => url === '/api/tree'
      ? reply(page([entry('docs', 'directory')]))
      : reply(page([entry('a.md', 'file', 'docs')])));
    vi.stubGlobal('fetch', fetch);
    await import('../src/main'); await flush();
    document.querySelector('summary')!.click(); await flush();
    expect(document.querySelector('#tree a')?.textContent).toBe('a.md');
    document.querySelector('summary')!.click();
    document.querySelector('summary')!.click(); await flush();
    expect(fetch.mock.calls.filter(([url]) => url === '/api/tree?path=docs').length).toBe(2);
  });
});
