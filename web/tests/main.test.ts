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
    const changeLink = document.querySelector('#changes-tree a');
    document.dispatchEvent(new Event('visibilitychange')); await flush();
    expect(document.querySelector('#changes-tree a')).toBe(changeLink);
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
      if (url === '/api/search-index') return reply({ paths: ['docs/deep/a.md'] });
      return reply({ path: 'docs/deep/a.md', type: 'markdown', html: '<h1>A</h1>' });
    });
    vi.stubGlobal('fetch', fetch);
    await import('../src/main'); await flush(); await flush();
    expect(document.querySelector('#content h1')?.textContent).toBe('A');
    expect(document.querySelector<HTMLDetailsElement>('details[data-path="docs"]')?.open).toBe(true);
    expect(document.querySelector<HTMLDetailsElement>('details[data-path="docs/deep"]')?.open).toBe(true);
    expect(fetch.mock.calls.map(([url]) => url)).toContain('/api/tree?path=docs%2Fdeep&focus=a.md');
    document.querySelector<HTMLButtonElement>('#sidebar-toggle')!.click();
    const search = document.querySelector<HTMLInputElement>('#search')!;
    search.value = 'a'; search.dispatchEvent(new Event('input')); await flush();
    const locationBefore = location.href;
    document.querySelector<HTMLButtonElement>('.crumb')!.click();
    expect(search.value).toBe('');
    expect(document.querySelector('#sidebar')?.classList.contains('collapsed')).toBe(false);
    expect(document.querySelector<HTMLDetailsElement>('details[data-path="docs"]')?.open).toBe(true);
    expect(document.activeElement).toBe(document.querySelector('details[data-path="docs"] > summary'));
    expect(location.href).toBe(locationBefore);
  });

  it('loads tree pages on request but searches every file path', async () => {
    const first = Array.from({ length: 200 }, (_, i) => entry(`file${String(i).padStart(3, '0')}.md`));
    const fetch = vi.fn(async (url: string) => url === '/api/tree'
      ? reply(page(first, '1', 200))
      : url === '/api/search-index' ? reply({ paths: ['last.md', 'nested/hidden.md'] })
      : reply(page([entry('last.md')], '1', null, 200)));
    vi.stubGlobal('fetch', fetch);
    await import('../src/main'); await flush();
    expect(document.querySelectorAll('#tree a').length).toBe(200);
    const search = document.querySelector<HTMLInputElement>('#search')!;
    search.value = 'last'; search.dispatchEvent(new Event('input'));
    await flush();
    expect(document.querySelector('#result-count')?.textContent).toBe('1 match');
    expect(document.querySelector('#tree a')?.textContent).toBe('last.md');
    search.value = 'hidden'; search.dispatchEvent(new Event('input'));
    expect(document.querySelector('#tree a')?.textContent).toBe('nested/hidden.md');
    expect(fetch.mock.calls.filter(([url]) => url === '/api/search-index')).toHaveLength(1);
    search.value = ''; search.dispatchEvent(new Event('input'));
    document.querySelector<HTMLButtonElement>('button[data-offset="200"]')!.click(); await flush();
    expect(fetch.mock.calls.map(([url]) => url)).toContain('/api/tree?offset=200');
  });

  it('shows only the best 100 matches and the exact total', async () => {
    const paths = Array.from({ length: 125 }, (_, i) => `docs/item${String(i).padStart(3, '0')}.md`);
    vi.stubGlobal('fetch', vi.fn(async (url: string) => url === '/api/search-index' ? reply({ paths }) : reply(page([]))));
    await import('../src/main'); await flush();
    const search = document.querySelector<HTMLInputElement>('#search')!;
    search.value = 'item'; search.dispatchEvent(new Event('input')); await flush();
    expect(document.querySelector('#result-count')?.textContent).toBe('Showing top 100 of 125 matches');
    expect(document.querySelectorAll('#tree a')).toHaveLength(100);
    expect(document.querySelector('#tree')?.textContent).toContain('item099.md');
    expect(document.querySelector('#tree')?.textContent).not.toContain('item100.md');
  });

  it('includes a matching file even when its path is very long', async () => {
    const longPath = `${'folder/'.repeat(90)}target.md`;
    vi.stubGlobal('fetch', vi.fn(async (url: string) => url === '/api/search-index' ? reply({ paths: [longPath] }) : reply(page([]))));
    await import('../src/main'); await flush();
    const search = document.querySelector<HTMLInputElement>('#search')!;
    search.value = 't'; search.dispatchEvent(new Event('input')); await flush();
    expect(document.querySelector('#result-count')?.textContent).toBe('1 match');
    expect(document.querySelector<HTMLAnchorElement>('#tree a')?.title).toBe(longPath);
  });

  it('ignores a stale index after clearing search and retries after failure', async () => {
    let releaseFirst: ((value: Response) => void) | undefined;
    let calls = 0;
    const fetch = vi.fn((url: string) => {
      if (url === '/api/search-index') {
        calls++;
        if (calls === 1) return new Promise<Response>((resolve) => { releaseFirst = resolve; });
        if (calls === 2) return Promise.resolve(reply({ error: 'unreadable', message: 'failed' }, 403));
        return Promise.resolve(reply({ paths: ['fresh.md'] }));
      }
      return Promise.resolve(reply(page([entry('root.md')])));
    });
    vi.stubGlobal('fetch', fetch);
    await import('../src/main'); await flush();
    const search = document.querySelector<HTMLInputElement>('#search')!;
    search.value = 'old'; search.dispatchEvent(new Event('input'));
    search.value = ''; search.dispatchEvent(new Event('input'));
    releaseFirst?.(reply({ paths: ['old.md'] })); await flush();
    expect(document.querySelector('#tree')?.textContent).toContain('root.md');
    search.value = 'fresh'; search.dispatchEvent(new Event('input')); await flush();
    expect(document.querySelector('#result-count')?.textContent).toBe('Search unavailable');
    search.value = 'fresh.md'; search.dispatchEvent(new Event('input')); await flush();
    expect(document.querySelector('#tree a')?.textContent).toBe('fresh.md');
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

  it('checks in the background without loading animation or replacing unchanged content', async () => {
    history.replaceState(null, '', '/?path=a.md');
    let releaseFile: ((value: Response) => void) | undefined;
    let fileCalls = 0;
    vi.stubGlobal('fetch', vi.fn((url: string) => {
      if (url.startsWith('/api/tree')) return Promise.resolve(reply(page([entry('a.md')])));
      fileCalls++;
      if (fileCalls === 2) return new Promise<Response>((resolve) => { releaseFile = resolve; });
      return Promise.resolve(reply({ path: 'a.md', type: 'markdown', html: '<h1>Stable</h1>' }, 200, 'v1'));
    }));
    await import('../src/main'); await flush();
    const heading = document.querySelector('#content h1');
    const label = document.querySelector('#connection .connection-label');
    document.dispatchEvent(new Event('visibilitychange')); await flush();
    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(document.querySelector<HTMLButtonElement>('#reload')?.disabled).toBe(false);
    expect(document.querySelector<HTMLElement>('#progress')?.hidden).toBe(true);
    expect(document.querySelector('#content')?.getAttribute('aria-busy')).toBe('false');
    releaseFile?.(reply(null, 304)); await flush();
    expect(document.querySelector('#content h1')).toBe(heading);
    expect(document.querySelector('#connection .connection-label')).toBe(label);
  });

  it('keeps a manual refresh active when an automatic check is due', async () => {
    history.replaceState(null, '', '/?path=manual-priority.md');
    let releaseFile: ((value: Response) => void) | undefined;
    let fileCalls = 0;
    vi.stubGlobal('fetch', vi.fn((url: string) => {
      if (url.startsWith('/api/tree')) return Promise.resolve(reply(page([entry('manual-priority.md')])));
      if (url === '/api/file?path=manual-priority.md') {
        fileCalls++;
        if (fileCalls === 2) return new Promise<Response>((resolve) => { releaseFile = resolve; });
      }
      return Promise.resolve(reply({ path: 'manual-priority.md', type: 'markdown', html: '<h1>Before</h1>' }));
    }));
    await import('../src/main'); await flush();
    document.querySelector<HTMLButtonElement>('#reload')!.click(); await flush();
    expect(document.querySelector<HTMLButtonElement>('#reload')?.disabled).toBe(true);
    expect(document.querySelector('#content')?.getAttribute('aria-busy')).toBe('true');
    document.dispatchEvent(new Event('visibilitychange'));
    releaseFile?.(reply({ path: 'manual-priority.md', type: 'markdown', html: '<h1>After</h1>' })); await flush();
    expect(document.querySelector('#content h1')?.textContent).toBe('After');
    expect(document.querySelector<HTMLButtonElement>('#reload')?.disabled).toBe(false);
  });

  it('keeps the current file visible during a background connection failure', async () => {
    history.replaceState(null, '', '/?path=a.md');
    let offline = false;
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (offline) throw new Error('offline');
      return url === '/api/tree' ? reply(page([entry('a.md')])) : reply({ path: 'a.md', type: 'markdown', html: '<h1>Readable</h1>' });
    }));
    await import('../src/main'); await flush();
    const heading = document.querySelector('#content h1');
    offline = true;
    document.dispatchEvent(new Event('visibilitychange')); await flush();
    expect(document.querySelector('#content h1')).toBe(heading);
    expect(document.querySelector('#connection')?.textContent).toContain('Refresh failed');
    expect(document.querySelector('#connection-banner')?.hasAttribute('hidden')).toBe(false);
  });

  it('discards a stale listing after a newer refresh starts', async () => {
    let releaseFirst: ((value: Response) => void) | undefined;
    let calls = 0;
    vi.stubGlobal('fetch', vi.fn((url: string) => {
      if (url === '/api/tree' && ++calls === 1) return new Promise<Response>((resolve) => { releaseFirst = resolve; });
      return Promise.resolve(reply(page([entry('new.md')], '2')));
    }));
    await import('../src/main'); await flush();
    window.dispatchEvent(new Event('popstate'));
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
