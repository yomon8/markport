// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/mermaid', () => ({ drawMermaid: vi.fn(async () => {}) }));

type Entry = { name: string; path: string; type: 'directory' | 'file' };
const flush = async (): Promise<void> => { await new Promise((resolve) => setTimeout(resolve, 0)); };
const reply = (body: unknown, status = 200, tag = ''): Response => ({
  ok: status < 400, status, json: async () => body, headers: { get: () => tag },
}) as unknown as Response;
const stubFetch = (fetch: (url: string, init?: RequestInit) => Promise<Response>): void => {
  vi.stubGlobal('fetch', (url: string, init?: RequestInit) => url === '/api/config'
    ? Promise.resolve(reply({ title: '', rootId: 'a'.repeat(64) })) : fetch(url, init));
};
const page = (entries: Entry[], revision = '1', nextOffset: number | null = null, offset = 0) =>
  ({ entries, revision, offset, nextOffset, root: 'project' });
const entry = (name: string, type: 'directory' | 'file' = 'file', parent = ''): Entry =>
  ({ name, path: parent ? `${parent}/${name}` : name, type });

beforeEach(() => {
  vi.resetModules();
  localStorage.clear();
  sessionStorage.clear();
  document.body.innerHTML = '<div id="app"></div>';
  history.replaceState(null, '', '/');
});
afterEach(() => { window.dispatchEvent(new Event('pagehide')); vi.unstubAllGlobals(); });

describe('lazy browsing and refresh', () => {
  it('refreshes staging in the diff heading without changing the patch or review state', async () => {
    history.replaceState(null, '', '/?path=a.md&view=diff');
    let code = ' M';
    stubFetch(async (url) => {
      if (url === '/api/tree') return reply(page([entry('a.md')]));
      if (url === '/api/git/changes') return reply({ available: true, rootId: 'staging-root', changes: [{ path: 'a.md', status: 'modified', revision: 'same-content', gitStatuses: [code] }] });
      return reply({ path: 'a.md', kind: 'text', patch: '@@ -1 +1 @@\n-old\n+new\n' });
    });
    await import('../src/main'); await flush();
    document.querySelector<HTMLButtonElement>('#file-title .review-toggle')!.click();
    const diff = document.querySelector('.diff-frame');
    expect(document.querySelector('#file-title .breadcrumbs')?.firstElementChild?.className).toBe('git-status');
    for (const state of ['M ', 'MM', 'AM', ' M']) {
      code = state;
      document.querySelector<HTMLButtonElement>('#reload')!.click(); await flush();
      expect(document.querySelector('#file-title .git-status')?.textContent).toBe(state);
      expect(document.querySelector('#changes-tree .git-status')?.textContent).toBe(state);
      expect(document.querySelector('#file-title .review-toggle')?.getAttribute('aria-pressed')).toBe('true');
      expect(document.querySelector('.diff-frame')).toBe(diff);
    }
  });
  it('copies only standalone math source and keeps its toolbar outside rendered output', async () => {
    history.replaceState(null, '', '/?path=math.md&right=math.md');
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    stubFetch(async (url) => url === '/api/tree' ? reply(page([entry('math.md')])) : reply({
      path: 'math.md', type: 'markdown', html: '<p>Inline <span class="math-source" data-math="inline">$x_1$</span></p><div class="math-source" data-math="display">$$x^2$$</div><div class="math-source" data-math="display">\\[\\badCommand{x}\\]</div>',
    }));
    try {
      await import('../src/main'); await flush();
      await vi.waitFor(() => expect(document.querySelectorAll('.math-error')).toHaveLength(2));
      for (const pane of ['#content', '#right-content']) {
        expect(document.querySelectorAll(`${pane} .math-frame`)).toHaveLength(2);
        expect(document.querySelector(`${pane} span.math-source .component-copy`)).toBeNull();
        const controls = document.querySelectorAll<HTMLButtonElement>(`${pane} .math-frame .component-copy`);
        controls[0].click(); await flush(); expect(writeText).toHaveBeenLastCalledWith('$$x^2$$');
        controls[1].click(); await flush(); expect(writeText).toHaveBeenLastCalledWith('\\[\\badCommand{x}\\]');
        expect(document.querySelector(`${pane} .math-source .component-copy`)).toBeNull();
      }
    } finally { Reflect.deleteProperty(navigator, 'clipboard'); }
  });

  it('closes only the theme menu on Escape and keeps focus inside mobile settings', async () => {
    stubFetch(async () => reply(page([])));
    await import('../src/main'); await flush();
    document.querySelector<HTMLButtonElement>('#header-more')!.click();
    const button = document.querySelector<HTMLButtonElement>('#theme-toggle')!; button.click();
    document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(document.querySelector<HTMLElement>('#theme-menu')!.hidden).toBe(true);
    expect(document.querySelector('#header-extras')!.classList.contains('open')).toBe(true);
    expect(document.activeElement).toBe(button);
  });

  it('redraws diagrams in both panes without fetching files or replacing content on theme changes', async () => {
    history.replaceState(null, '', '/?path=a.md&right=b.md');
    const fetch = vi.fn(async (url: string) => url === '/api/tree'
      ? reply(page([entry('a.md'), entry('b.md')]))
      : reply({ path: url.includes('b.md') ? 'b.md' : 'a.md', type: 'markdown', html: '<h1>Diagram</h1><div data-mermaid="true">flowchart LR; A --> B</div>' }));
    stubFetch(fetch);
    await import('../src/main'); await flush();
    const left = document.querySelector('#content h1'); const right = document.querySelector('#right-content h1');
    const { drawMermaid } = await import('../src/mermaid');
    vi.mocked(drawMermaid).mockClear(); fetch.mockClear();
    const main = document.querySelector<HTMLElement>('#main')!; const rightPane = document.querySelector<HTMLElement>('#right-pane')!;
    main.scrollTop = 120; rightPane.scrollTop = 240;
    [...document.querySelectorAll<HTMLButtonElement>('#theme-menu button')].find((button) => button.textContent === 'Nord')!.click();
    await flush();
    expect(fetch).not.toHaveBeenCalled(); expect(drawMermaid).toHaveBeenCalledTimes(2);
    expect(document.querySelector('#content h1')).toBe(left); expect(document.querySelector('#right-content h1')).toBe(right);
    expect(main.scrollTop).toBe(120); expect(rightPane.scrollTop).toBe(240);
  });

  it('changes the pasted preview theme without rendering Markdown again or losing input', async () => {
    history.replaceState(null, '', '/?view=paste');
    const fetch = vi.fn(async (url: string) => url === '/api/render'
      ? reply({ html: '<h1>Pasted</h1><div data-mermaid="true">flowchart LR; A --> B</div>' })
      : reply(page([])));
    stubFetch(fetch);
    await import('../src/main'); await flush();
    const input = document.querySelector<HTMLTextAreaElement>('#paste-input')!;
    input.value = '# Pasted'; input.dispatchEvent(new Event('input'));
    [...document.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent === 'Rendered')!.click();
    await flush();
    const preview = document.querySelector('.paste-preview h1'); fetch.mockClear();
    [...document.querySelectorAll<HTMLButtonElement>('#theme-menu button')].find((button) => button.textContent === 'Sepia')!.click();
    await flush();
    expect(fetch).not.toHaveBeenCalled(); expect(document.querySelector('.paste-preview h1')).toBe(preview);
    expect(input.value).toBe('# Pasted'); expect(document.querySelector<HTMLElement>('.paste-preview')!.hidden).toBe(false);
  });

  it.each([
    ['docs/guide.md:123', 'docs/guide.md', '123', true],
    ['  guide.md:0012  ', 'docs/guide.md', '12', true],
    ['sample.py:2', 'sample.py', '2', false],
    ['page.html:3', 'page.html', '3', true],
    ['file:0', 'file:0', '', false],
    ['file:-1', 'file:-1', '', false],
    ['file:1.5', 'file:1.5', '', false],
    ['file:9007199254740992', 'file:9007199254740992', '', false],
  ])('searches %s and builds the matching destination', async (query, path, line, source) => {
    stubFetch(vi.fn(async (url: string) => url === '/api/search-index'
      ? reply({ paths: [path] }) : reply(page([]))));
    await import('../src/main'); await flush();
    const search = document.querySelector<HTMLInputElement>('#search')!;
    search.value = query; search.dispatchEvent(new Event('input')); await flush();
    const link = document.querySelector<HTMLAnchorElement>('#tree .search-results a')!;
    expect(link).not.toBeNull();
    const url = new URL(link.href);
    expect(url.searchParams.get('path')).toBe(path);
    expect(url.searchParams.get('source')).toBe(source ? '1' : null);
    expect(url.hash).toBe(line ? `#L${line}` : '');
    expect(link.getAttribute('aria-label')).toBe(line ? `${path}:${line}` : path);
    expect(link.textContent).toContain(line ? `${path.split('/').at(-1)}:${line}` : path);
    expect(document.querySelector<HTMLButtonElement>('#tree .open-right')?.dataset.rightLine).toBe(line || undefined);
  });

  it('explains when Git history is unavailable', async () => {
    history.replaceState(null, '', '/?view=history');
    stubFetch(vi.fn(async (url: string) => url === '/api/tree'
      ? reply(page([]))
      : reply({ available: false, reason: 'not_repository', commits: [], nextOffset: null })));
    await import('../src/main'); await flush();
    expect(document.querySelector('#history-tree')?.textContent).toContain('not a Git repository');
    expect(document.querySelector('#content')?.textContent).toContain('not a Git repository');
  });
  it('opens commit history, a historical file diff, and older commits', async () => {
    const firstID = 'a'.repeat(40); const olderID = 'b'.repeat(40);
    const fetch = vi.fn(async (url: string) => {
      if (url === '/api/tree') return reply(page([]));
      if (url === '/api/git/history') return reply({ available: true, head: firstID, commits: [{ id: firstID, subject: '<new>', author: 'A', date: '2026-01-02T00:00:00Z' }], nextOffset: 50 });
      if (url === `/api/git/history?head=${firstID}&offset=50`) return reply({ available: true, head: firstID, commits: [{ id: olderID, subject: 'old', author: 'B', date: '2026-01-01T00:00:00Z' }], nextOffset: null });
      if (url === `/api/git/commit?id=${firstID}`) return reply({ id: firstID, subject: '<new>', author: 'A', date: '2026-01-02T00:00:00Z', message: '<new>', files: [{ path: 'docs/a.md', status: 'modified' }] });
      if (url === `/api/git/commit-diff?id=${firstID}&path=docs%2Fa.md`) return reply({ path: 'docs/a.md', kind: 'text', patch: '@@ -1 +1 @@\n-old\n+<script>alert(1)</script>\n' });
      return reply({ error: 'not_found' }, 404);
    });
    stubFetch(fetch);
    await import('../src/main'); await flush();
    document.querySelector<HTMLButtonElement>('#history-tab')!.click();
    await flush(); await flush(); await flush();
    expect(location.search).toContain(`commit=${firstID}`);
    expect(document.querySelector('#history-tree')?.textContent).toContain('<new>');
    expect(document.querySelector('#content h1')?.textContent).toBe('<new>');
    expect(document.querySelector('#content script')).toBeNull();
    document.querySelector<HTMLButtonElement>('.history-more')!.click(); await flush();
    expect(document.querySelectorAll('#history-tree .history-list li')).toHaveLength(2);
    document.querySelector<HTMLAnchorElement>('.history-files a')!.click(); await flush();
    expect(location.search).toContain('path=docs%2Fa.md');
    expect(document.querySelector('#content .diff-frame')?.textContent).toContain('<script>alert(1)</script>');
    expect(document.querySelector('#content script')).toBeNull();
    document.querySelector<HTMLAnchorElement>('.history-back')!.click(); await flush();
    expect(document.querySelector('#content .history-files')).not.toBeNull();
  });
  it('compares a selected commit with current files and keeps the base across diff navigation', async () => {
    const base = 'a'.repeat(40);
    const fetch = vi.fn(async (url: string) => {
      if (url === '/api/tree') return reply(page([]));
      if (url === '/api/git/history') return reply({ available: true, head: base, commits: [{ id: base, subject: 'Initial', author: 'A', date: '2026-01-01T00:00:00Z' }], nextOffset: null });
      if (url === `/api/git/commit?id=${base}`) return reply({ id: base, subject: 'Initial', author: 'A', date: '2026-01-01T00:00:00Z', message: 'Initial', files: [{ path: 'a.md', status: 'added' }] });
      if (url === `/api/git/changes?base=${base}`) return reply({ available: true, rootId: 'root-base', base, changes: [{ path: 'a.md', status: 'modified', revision: 'a1' }, { path: 'b.md', status: 'added', revision: 'b1' }] });
      if (url === `/api/git/diff?path=a.md&base=${base}`) return reply({ path: 'a.md', kind: 'text', patch: '@@ -1 +1 @@\n-old\n+new\n' });
      if (url === `/api/git/diff?path=b.md&base=${base}`) return reply({ path: 'b.md', kind: 'text', patch: '@@ -0,0 +1 @@\n+added\n' });
      if (url === '/api/git/changes') return reply({ available: true, rootId: 'root', changes: [] });
      return reply({ error: 'not_found' }, 404);
    });
    stubFetch(fetch);
    history.replaceState(null, '', '/?view=history');
    await import('../src/main'); await flush(); await flush();
    document.querySelector<HTMLAnchorElement>('#history-tree .history-compare')!.click(); await flush();
    expect(location.search).toContain(`base=${base}`);
    expect(document.querySelector('#content .change-path')?.textContent).toBe('a.md');
    expect(document.querySelector<HTMLInputElement>('#comparison-base')?.value).toBe(base);
    document.querySelector<HTMLAnchorElement>('#content a[href*="path=a.md"]')!.click(); await flush();
    expect(location.search).toContain(`base=${base}`);
    expect(document.querySelector('#content .diff-added')?.textContent).toContain('+new');
    document.querySelector<HTMLButtonElement>('#file-title .diff-navigation button:nth-child(2)')!.click(); await flush();
    expect(location.search).toContain('path=b.md');
    expect(location.search).toContain(`base=${base}`);
    document.querySelector<HTMLButtonElement>('.comparison-controls > button')!.click(); await flush();
    expect(location.search).toBe('?view=changes');
    expect(document.querySelector('#content .hint')?.textContent).toBe('No changes.');
  });
  it('shows an invalid comparison ID without leaving the previous change list active', async () => {
    history.replaceState(null, '', '/?view=changes');
    stubFetch(vi.fn(async (url: string) => {
      if (url === '/api/tree') return reply(page([]));
      if (url === '/api/git/changes') return reply({ available: true, rootId: 'root', changes: [{ path: 'a.md', status: 'modified', revision: 'v1' }] });
      if (url === '/api/git/changes?base=deadbee') return reply({ error: 'not_found' }, 404);
      return reply({ error: 'not_found' }, 404);
    }));
    await import('../src/main'); await flush();
    expect(document.querySelector('#changes-tree .change-path')?.textContent).toBe('a.md');
    const input = document.querySelector<HTMLInputElement>('#comparison-base')!;
    input.value = 'deadbee'; input.form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); await flush();
    expect(document.querySelector('#content .file-error')?.textContent).toContain('Commit not found');
    expect(document.querySelector('#changes-tree .change-path')).toBeNull();
    document.querySelector<HTMLButtonElement>('.comparison-controls > button')!.click(); await flush();
    expect(document.querySelector('#changes-tree .change-path')?.textContent).toBe('a.md');
  });
  it('revalidates the right pane without replacing its DOM on 304', async () => {
    history.replaceState(null, '', '/?path=a.md&right=b.md');
    let rightVersion = 1;
    const fetch = vi.fn(async (url: string, options?: RequestInit) => {
      if (url === '/api/tree') return reply(page([entry('a.md'), entry('b.md')]));
      if (url === '/api/file?path=b.md') {
        if ((options?.headers as Record<string, string> | undefined)?.['If-None-Match'] === `right-${rightVersion}`) return reply(null, 304, `right-${rightVersion}`);
        return reply({ path: 'b.md', type: 'markdown', html: `<h1>Right ${rightVersion}</h1>` }, 200, `right-${rightVersion}`);
      }
      return reply({ path: 'a.md', type: 'markdown', html: '<h1>Left</h1>' });
    });
    stubFetch(fetch);
    await import('../src/main'); await flush();
    const first = document.querySelector('#right-content h1');
    document.dispatchEvent(new Event('visibilitychange')); await flush();
    expect(document.querySelector('#right-content h1')).toBe(first);
    expect(fetch.mock.calls.some(([url, options]) => url === '/api/file?path=b.md' && (options?.headers as Record<string, string> | undefined)?.['If-None-Match'] === 'right-1')).toBe(true);
    rightVersion = 2;
    document.dispatchEvent(new Event('visibilitychange')); await flush();
    expect(document.querySelector('#right-content h1')?.textContent).toBe('Right 2');
  });

  it('keeps search results and focus during background revalidation', async () => {
    let resolveRefresh: ((value: Response) => void) | undefined;
    let requests = 0;
    const fetch = vi.fn(async (url: string) => {
      if (url.startsWith('/api/search-index')) {
        requests++;
        if (requests === 2) return new Promise<Response>((resolve) => { resolveRefresh = resolve; });
        return reply({ paths: ['old.md'] }, 200, 'index-1');
      }
      return reply(page([]));
    });
    stubFetch(fetch);
    await import('../src/main'); await flush();
    const search = document.querySelector<HTMLInputElement>('#search')!;
    search.value = 'md'; search.dispatchEvent(new Event('input')); await flush();
    expect(document.querySelector('#tree a')?.textContent).toBe('old.md');
    search.focus();
    document.querySelector<HTMLButtonElement>('#reload')!.click(); await flush();
    expect(document.querySelector('#tree a')?.textContent).toBe('old.md');
    expect(document.activeElement).toBe(search);
    resolveRefresh?.(reply({ paths: ['new.md'] }, 200, 'index-2')); await flush();
    expect(document.querySelector('#tree a')?.textContent).toBe('new.md');
    expect(document.activeElement).toBe(search);
  });
  it('switches pasted Markdown between text and rendered views without losing the draft', async () => {
    const fetch = vi.fn(async (url: string, options?: RequestInit) => {
      if (url === '/api/tree') return reply({ ...page([entry('README.md')]), readme: 'README.md' });
      if (url === '/api/render') return reply({ html: `<h1>${JSON.parse(options?.body as string).markdown.slice(2)}</h1>` });
      return reply({ path: 'README.md', type: 'markdown', html: '<h1>File</h1>' });
    });
    stubFetch(fetch);
    await import('../src/main'); await flush(); await flush();
    expect(document.querySelector('#content h1')?.textContent).toBe('File');
    document.querySelector<HTMLButtonElement>('#paste-toggle')!.click(); await flush();
    const input = document.querySelector<HTMLTextAreaElement>('#paste-input')!;
    input.value = '# First'; input.dispatchEvent(new Event('input'));
    const toggle = document.querySelector<HTMLButtonElement>('#paste-view-toggle')!;
    expect(toggle.textContent).toBe('Rendered');
    expect(document.querySelector<HTMLElement>('.paste-preview')?.hidden).toBe(true);
    expect(fetch.mock.calls.filter(([url]) => url === '/api/render')).toHaveLength(0);
    toggle.click(); await flush();
    expect(document.querySelector('.paste-preview h1')?.textContent).toBe('First');
    expect(input.closest<HTMLElement>('.paste-editor')?.hidden).toBe(true);
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    expect(sessionStorage.getItem('markport-pasted-markdown')).toBe('# First');
    document.querySelector<HTMLButtonElement>('#paste-toggle')!.click();
    expect(document.querySelector('#paste-input')).toBe(input);
    document.dispatchEvent(new Event('visibilitychange')); await flush();
    expect(document.querySelector('.paste-preview h1')?.textContent).toBe('First');
    document.querySelector<HTMLButtonElement>('#paste-text-view')!.click();
    expect(input.closest<HTMLElement>('.paste-editor')?.hidden).toBe(false);
    expect(document.querySelector<HTMLElement>('.paste-preview')?.hidden).toBe(true);
    expect(document.querySelector('.paste-editor-surface > .paste-highlight')).not.toBeNull();
    expect(document.querySelector('.paste-editor .code-frame')).toBeNull();
    toggle.click(); await flush();
    expect(fetch.mock.calls.filter(([url]) => url === '/api/render')).toHaveLength(1);
    document.querySelector<HTMLButtonElement>('#paste-text-view')!.click();
    input.value = '# Second'; input.dispatchEvent(new Event('input'));
    expect(document.querySelector('.paste-preview h1')).toBeNull();
    toggle.click(); await flush();
    expect(document.querySelector('.paste-preview h1')?.textContent).toBe('Second');
    expect(fetch.mock.calls.filter(([url]) => url === '/api/render')).toHaveLength(2);
    document.querySelector<HTMLButtonElement>('#files-tab')!.click(); await flush();
    expect(document.querySelector('#content h1')?.textContent).toBe('File');
    document.querySelector<HTMLButtonElement>('#paste-toggle')!.click(); await flush();
    expect(document.querySelector<HTMLTextAreaElement>('#paste-input')?.value).toBe('# Second');
    expect(document.querySelector<HTMLElement>('.paste-preview')?.hidden).toBe(true);
    expect(document.querySelector('#paste-view-toggle')?.textContent).toBe('Rendered');
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    document.querySelector<HTMLButtonElement>('.paste-menu button')!.click();
    expect(sessionStorage.getItem('markport-pasted-markdown')).toBeNull();
    expect(document.querySelector('.paste-preview h1')).toBeNull();
  });

  it('reports a paste render error without clearing the text', async () => {
    stubFetch(vi.fn(async (url: string) => url === '/api/tree' ? reply(page([])) : reply({ error: 'render_failed', message: 'Cannot render Markdown' }, 500)));
    await import('../src/main'); await flush();
    document.querySelector<HTMLButtonElement>('#paste-toggle')!.click(); await flush();
    const input = document.querySelector<HTMLTextAreaElement>('#paste-input')!;
    input.value = '# Keep me'; input.dispatchEvent(new Event('input'));
    document.querySelector<HTMLButtonElement>('#paste-view-toggle')!.click(); await flush();
    expect(input.value).toBe('# Keep me');
    expect(input.closest<HTMLElement>('.paste-editor')?.hidden).toBe(false);
    expect(document.querySelector('#paste-view-toggle')?.textContent).toBe('Rendered');
    expect(document.querySelector('.paste-notice')?.textContent).toBe('Cannot render Markdown');
  });

  it('lists Git changes and renders a safe, refreshing diff', async () => {
    history.replaceState(null, '', '/?view=changes');
    let patch = 'diff --git a/new.md b/new.md\n--- /dev/null\n+++ b/new.md\n@@ -0,0 +1,1 @@\n+<script>alert(1)</script>\n';
    const fetch = vi.fn(async (url: string) => {
      if (url === '/api/tree') return reply(page([entry('new.md')]));
      if (url === '/api/git/changes') return reply({ available: true, rootId: 'root', changes: [{ path: 'new.md', status: 'added', revision: 'v1' }] });
      if (url === '/api/git/diff?path=new.md') return reply({ path: 'new.md', kind: 'text', patch });
      return reply({ path: 'new.md', type: 'markdown', html: '<h1>Preview</h1>' });
    });
    stubFetch(fetch);
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

  it('updates review counts and filtering as changes are edited', async () => {
    history.replaceState(null, '', '/?view=changes');
    let revision = 'v1';
    const fetch = vi.fn(async (url: string) => {
      if (url === '/api/tree') return reply(page([entry('a.md'), entry('b.md')]));
      if (url === '/api/git/changes') return reply({ available: true, rootId: 'root', changes: [
        { path: 'a.md', status: 'modified', revision }, { path: 'b.md', status: 'added', revision: 'b1' },
      ] });
      return reply({ path: 'a.md', kind: 'text', patch: 'diff --git a/a.md b/a.md\n+new\n' });
    });
    stubFetch(fetch);
    await import('../src/main'); await flush();
    expect(document.querySelector('#content .review-count')?.textContent).toBe('0 of 2 reviewed');
    const unreviewed = document.querySelector<HTMLButtonElement>('#content .review-toggle')!;
    expect(unreviewed.getAttribute('aria-label')).toBe('Mark reviewed: a.md');
    expect(unreviewed.getAttribute('aria-pressed')).toBe('false');
    expect(unreviewed.querySelectorAll('svg path')).toHaveLength(0);
    document.querySelector<HTMLButtonElement>('#content .review-toggle')!.click();
    expect(document.querySelector('#content .review-count')?.textContent).toBe('1 of 2 reviewed');
    expect(document.querySelector('#changes-tree .review-count')?.textContent).toBe('1 of 2 reviewed');
    const reviewed = document.querySelector<HTMLButtonElement>('#content .review-toggle')!;
    expect(reviewed.getAttribute('aria-label')).toBe('Mark unreviewed: a.md');
    expect(reviewed.getAttribute('aria-pressed')).toBe('true');
    expect(reviewed.querySelectorAll('svg path')).toHaveLength(1);
    document.querySelector<HTMLInputElement>('#content .review-filter input')!.click();
    expect([...document.querySelectorAll('#content .change-path')].map((item) => item.textContent)).toEqual(['b.md']);
    revision = 'v2';
    document.querySelector<HTMLButtonElement>('#reload')!.click(); await flush();
    expect(document.querySelector('#content .review-count')?.textContent).toBe('0 of 2 reviewed');
    expect([...document.querySelectorAll('#content .change-path')].map((item) => item.textContent)).toEqual(['a.md', 'b.md']);
  });

  it('shows nested Git changes in both trees and follows their visual order', async () => {
    history.replaceState(null, '', '/?view=changes');
    const changes = [
      { path: 'z.md', status: 'modified', revision: 'z' },
      { path: 'docs/b.md', status: 'added', revision: 'b' },
      { path: 'docs/nested/a.md', status: 'deleted', revision: 'a' },
    ];
    stubFetch(vi.fn(async (url: string) => {
      if (url === '/api/tree') return reply(page([]));
      if (url === '/api/git/changes') return reply({ available: true, rootId: 'root', changes });
      return reply({ path: new URL(url, location.href).searchParams.get('path'), kind: 'text', patch: '+changed\n' });
    }));
    await import('../src/main'); await flush();
    expect([...document.querySelectorAll('#content .change-path')].map((item) => item.textContent)).toEqual(['a.md', 'b.md', 'z.md']);
    const folder = document.querySelector<HTMLDetailsElement>('#content details[data-path="docs"]')!;
    expect(folder.open).toBe(true);
    expect(document.querySelector<HTMLDetailsElement>('#changes-tree details[data-path="docs/nested"]')?.open).toBe(true);
    folder.querySelector('summary')!.click(); await flush();
    expect(folder.open).toBe(false);
    expect(document.querySelector<HTMLDetailsElement>('#changes-tree details[data-path="docs"]')?.open).toBe(false);
    document.dispatchEvent(new Event('visibilitychange')); await flush();
    expect(document.querySelector<HTMLDetailsElement>('#content details[data-path="docs"]')?.open).toBe(false);
    const { orderedChanges } = await import('../src/diff');
    expect(orderedChanges(changes as Parameters<typeof orderedChanges>[0], true).map((change) => change.path)).toEqual(['docs/nested/a.md', 'docs/b.md', 'z.md']);
    document.querySelector<HTMLAnchorElement>('#changes-tree a[href*="docs%2Fb.md"]')!.click(); await flush();
    expect(new URL(location.href).searchParams.get('path')).toBe('docs/b.md');
    expect(document.querySelector<HTMLDetailsElement>('#changes-tree details[data-path="docs"]')?.open).toBe(true);
    document.querySelector<HTMLInputElement>('#changes-tree .review-filter:last-child input')!.click();
    expect([...document.querySelectorAll('#changes-tree .change-path')].map((item) => item.textContent)).toEqual(['z.md', 'docs/b.md', 'docs/nested/a.md']);
    document.querySelector<HTMLInputElement>('#changes-tree .review-filter:last-child input')!.click();
    for (const path of ['docs%2Fb.md', 'docs%2Fnested%2Fa.md']) {
      document.querySelector<HTMLAnchorElement>(`#changes-tree a[href*="${path}"]`)!.parentElement!.querySelector<HTMLButtonElement>('.review-toggle')!.click();
    }
    document.querySelectorAll<HTMLInputElement>('#changes-tree .review-filter input')[0].click();
    expect(document.querySelector('#changes-tree details[data-path="docs"]')).toBeNull();
    expect([...document.querySelectorAll('#changes-tree .change-path')].map((item) => item.textContent)).toEqual(['z.md']);
  });

  it('explains when the selected directory is not a Git repository', async () => {
    history.replaceState(null, '', '/?view=changes');
    stubFetch(vi.fn(async (url: string) => url === '/api/tree' ? reply(page([])) : reply({ available: false, reason: 'not_repository', changes: [] })));
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
    stubFetch(fetch);
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

  it('previews PDF in both panes and reloads it without HTML controls', async () => {
    history.replaceState(null, '', '/?path=sample.pdf&right=sample.pdf');
    const fetch = vi.fn(async (url: string) => {
      if (url === '/api/tree') return reply(page([entry('sample.pdf')]));
      return reply({ path: 'sample.pdf', type: 'pdf', previewUrl: '/api/pdf?path=sample.pdf&v=1' });
    });
    const open = vi.fn(); vi.stubGlobal('open', open);
    stubFetch(fetch);
    await import('../src/main'); await flush(); await flush();
    const left = document.querySelector<HTMLIFrameElement>('#content .pdf-preview');
    const right = document.querySelector<HTMLIFrameElement>('#right-content .pdf-preview');
    expect(left?.src).toContain('/api/pdf?path=sample.pdf&v=1&reload=0');
    expect(right?.src).toContain('/api/pdf?path=sample.pdf&v=1&reload=0');
    expect(left?.hasAttribute('sandbox')).toBe(false);
    expect(right?.hasAttribute('sandbox')).toBe(false);
    expect(document.querySelector('#file-title .kind-badge')?.textContent).toBe('PDF');
    expect([...document.querySelectorAll('#file-title .view-segment button')].some((button) => button.textContent === 'Source')).toBe(false);
    expect(document.querySelector<HTMLButtonElement>('#right-views')?.hidden).toBe(true);
    document.querySelector<HTMLButtonElement>('#file-title [aria-label="Open PDF in new tab"]')!.click();
    document.querySelector<HTMLButtonElement>('#right-title [aria-label="Open PDF in new tab"]')!.click();
    expect(open).toHaveBeenCalledTimes(2);
    expect(open).toHaveBeenCalledWith('/api/pdf?path=sample.pdf', '_blank', 'noopener,noreferrer');
    document.querySelector<HTMLButtonElement>('#reload')!.click(); await flush();
    expect(document.querySelector<HTMLIFrameElement>('#content .pdf-preview')?.src).toContain('&reload=1');
    expect(document.querySelector<HTMLIFrameElement>('#right-content .pdf-preview')?.src).toContain('&reload=1');
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
    stubFetch(fetch);
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
    stubFetch(fetch);
    await import('../src/main'); await flush();
    expect(document.querySelectorAll('#tree a').length).toBe(200);
    const search = document.querySelector<HTMLInputElement>('#search')!;
    search.value = 'last'; search.dispatchEvent(new Event('input'));
    await flush();
    expect(document.querySelector('#result-count')?.textContent).toBe('1 match');
    expect(document.querySelector('#tree a')?.textContent).toBe('last.md');
    search.value = 'hidden'; search.dispatchEvent(new Event('input'));
    expect(document.querySelector('#tree a')?.getAttribute('aria-label')).toBe('nested/hidden.md');
    expect(fetch.mock.calls.filter(([url]) => url === '/api/search-index')).toHaveLength(1);
    search.value = ''; search.dispatchEvent(new Event('input'));
    document.querySelector<HTMLButtonElement>('button[data-offset="200"]')!.click(); await flush();
    expect(fetch.mock.calls.map(([url]) => url)).toContain('/api/tree?offset=200');
  });

  it('shows only the best 100 matches and the exact total', async () => {
    const paths = Array.from({ length: 125 }, (_, i) => `docs/item${String(i).padStart(3, '0')}.md`);
    stubFetch(vi.fn(async (url: string) => url === '/api/search-index' ? reply({ paths }) : reply(page([]))));
    await import('../src/main'); await flush();
    const search = document.querySelector<HTMLInputElement>('#search')!;
    search.value = 'item'; search.dispatchEvent(new Event('input')); await flush();
    expect(document.querySelector('#result-count')?.textContent).toBe('Showing top 100 of 125 matches');
    expect(document.querySelectorAll('#tree a')).toHaveLength(100);
    expect(document.querySelector('#tree')?.textContent).toContain('item099.md');
    expect(document.querySelector('#tree')?.textContent).not.toContain('item100.md');
  });

  it('ranks filename matches first and shows names with parent folders', async () => {
    const paths = ['srv/archive.ts', 'docs/server.ts', 'other/server.ts'];
    stubFetch(vi.fn(async (url: string) => url === '/api/search-index' ? reply({ paths }) : reply(page([]))));
    await import('../src/main'); await flush();
    const search = document.querySelector<HTMLInputElement>('#search')!;
    search.value = 'srv'; search.dispatchEvent(new Event('input')); await flush();
    const results = [...document.querySelectorAll<HTMLAnchorElement>('#tree .search-results a')];
    expect(results).toHaveLength(3);
    expect(results.slice(0, 2).map((link) => link.getAttribute('aria-label'))).toEqual(['docs/server.ts', 'other/server.ts']);
    expect(results[0].querySelector('.node-file-name')?.textContent).toBe('server.ts');
    expect(results[0].querySelector('.node-parent-path')?.textContent).toBe('docs');
    expect([...results[0].querySelectorAll('.node-file-name mark')].map((mark) => mark.textContent)).toEqual(['s', 'rv']);
    expect(results[0].querySelectorAll('.node-parent-path mark')).toHaveLength(0);
  });

  it('shows no internal file count and a friendly connection status', async () => {
    stubFetch(vi.fn(async (url: string) => url === '/api/search-index' ? reply({ paths: ['a.md'] }) : reply(page([{ name: 'a.md', path: 'a.md', type: 'file' }]))));
    await import('../src/main'); await flush();
    expect(document.querySelector('#result-count')?.textContent).toBe('');
    expect(document.querySelector('#content .empty-state p')?.textContent).toBe('Select a file from the list, or press / to search.');
    const connection = document.querySelector<HTMLElement>('#connection')!;
    expect(connection.title).toBe('Live · auto-refresh on');
    expect(connection.getAttribute('aria-label')).toBe('Live · auto-refresh on');
  });

  it('uses labelled SVG icons for icon-only buttons and restores the icon after copying', async () => {
    history.replaceState(null, '', '/?path=a.md');
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn(async () => {}) } });
    stubFetch(vi.fn(async (url: string) => url === '/api/tree' ? reply(page([entry('a.md')])) : reply({ path: 'a.md', type: 'markdown', html: '<h1>A</h1>' })));
    await import('../src/main'); await flush();
    const copy = document.querySelector<HTMLButtonElement>('#file-title .title-icon[aria-label="Copy path"]')!;
    const iconOnly = [...document.querySelectorAll<HTMLButtonElement>('header button, #file-title .title-icon, #right-pane .title-icon, .open-right')].filter((button) => button.querySelector('svg') && !button.textContent?.trim());
    expect(iconOnly.length).toBeGreaterThan(5);
    for (const button of iconOnly) expect([button.id || button.className, button.getAttribute('aria-label'), button.title].every(Boolean)).toBe(true);
    expect([...document.querySelectorAll('button, .reload-icon')].map((button) => button.textContent).join('')).not.toMatch(/[◫↓⧉☷⇄▣↗☰◐↻⋯⇥☀☾]/);
    const before = copy.innerHTML;
    vi.useFakeTimers();
    copy.click(); await vi.advanceTimersByTimeAsync(0);
    expect(copy.dataset.icon).toBe('check'); expect(copy.title).toBe('Copied');
    await vi.advanceTimersByTimeAsync(2000);
    expect(copy.innerHTML).toBe(before); expect(copy.title).toBe('Copy path');
    vi.useRealTimers();
  });

  it.each([
    ['unfetched', undefined, false, false],
    ['changed', [{ path: 'a.md', status: 'modified', revision: 'r1' }], false, true],
    ['unchanged', [{ path: 'other.md', status: 'modified', revision: 'r1' }], true, false],
  ] as const)('handles the Diff button for %s files', async (_name, changes, disabled, marked) => {
    history.replaceState(null, '', '/?path=a.md');
    stubFetch(vi.fn(async (url: string) => {
      if (url === '/api/tree') return reply(page([entry('a.md')]));
      if (url.startsWith('/api/git/changes')) return changes ? reply({ available: true, rootId: 'r', base: 'abc', changes }) : reply({ error: 'x' }, 500);
      return reply({ path: 'a.md', type: 'markdown', html: '<h1>A</h1>' });
    }));
    await import('../src/main'); await flush(); await flush();
    const diff = [...document.querySelectorAll<HTMLButtonElement>('#file-title .view-segment button')].find((button) => button.textContent?.startsWith('Diff'))!;
    expect(diff.disabled).toBe(disabled);
    expect(Boolean(diff.querySelector('.change-dot'))).toBe(marked);
    if (disabled) expect(diff.title).toBe('No changes against HEAD');
  });

  it('keeps header controls as labelled icon buttons', async () => {
    stubFetch(vi.fn(async (url: string) => url === '/api/tree' ? reply(page([])) : reply({ paths: [] })));
    await import('../src/main'); await flush();
    const reload = document.querySelector<HTMLButtonElement>('#reload')!;
    expect(reload.getAttribute('aria-label')).toBe('Refresh'); expect(reload.title).toBe('Refresh now'); expect(reload.textContent?.trim()).toBe('');
    const paste = document.querySelector<HTMLButtonElement>('#paste-toggle')!;
    expect(paste.getAttribute('aria-label')).toBe('Paste Markdown'); expect(paste.textContent?.trim()).toBe('');
    expect(document.querySelector('#header-more')?.getAttribute('aria-label')).toBe('App settings');
  });

  it('shows ignored files last and marks them in search results', async () => {
    const paths = ['dist/main.bin', 'web/src/main.ts'];
    stubFetch(vi.fn(async (url: string) => url === '/api/search-index' ? reply({ paths, ignored: ['dist/main.bin'] }) : reply(page([]))));
    await import('../src/main'); await flush();
    const search = document.querySelector<HTMLInputElement>('#search')!;
    search.value = 'main'; search.dispatchEvent(new Event('input')); await flush();
    const links = [...document.querySelectorAll<HTMLAnchorElement>('#tree .search-results a')];
    expect(links.map((link) => link.getAttribute('aria-label'))).toEqual(['web/src/main.ts', 'dist/main.bin']);
    expect(links.map((link) => link.dataset.ignored)).toEqual([undefined, 'true']);
  });

  it('shows the unreviewed count on the Changes tab and updates it when reviewing', async () => {
    history.replaceState(null, '', '/?view=changes');
    stubFetch(vi.fn(async (url: string) => {
      if (url === '/api/tree') return reply(page([]));
      if (url === '/api/git/changes') return reply({ available: true, rootId: 'badge', changes: [{ path: 'a.md', status: 'modified', revision: 'v1', added: 2, deleted: 1 }, { path: 'b.md', status: 'added', revision: 'v2', added: 4, deleted: 0 }] });
      return reply({ error: 'not_found' }, 404);
    }));
    await import('../src/main'); await flush(); await flush();
    const tab = document.querySelector<HTMLButtonElement>('#changes-tab')!;
    expect(tab.querySelector('.tab-badge')?.textContent).toBe('2');
    expect(tab.getAttribute('aria-label')).toBe('Changes, 2 unreviewed');
    expect(document.querySelector('#content .change-summary')?.textContent).toContain('2 files changed');
    document.querySelector<HTMLButtonElement>('#content .review-toggle')!.click(); await flush();
    expect(tab.querySelector('.tab-badge')?.textContent).toBe('1');
    document.querySelectorAll<HTMLButtonElement>('#content .review-toggle')[1].click(); await flush();
    expect(tab.querySelector('.tab-badge')).toBeNull();
    expect(tab.hasAttribute('aria-label')).toBe(false);
  });

  it('offers recent commits as comparison bases and compares as soon as one is chosen', async () => {
    const commits = ['c'.repeat(40), 'b'.repeat(40), 'a'.repeat(40)].map((id, index) => ({ id, subject: `Commit ${index}`, author: 'A', date: '2026-01-01T00:00:00Z' }));
    history.replaceState(null, '', '/?view=changes');
    stubFetch(vi.fn(async (url: string) => {
      if (url === '/api/tree') return reply(page([]));
      if (url === '/api/git/history') return reply({ available: true, head: commits[0].id, commits, nextOffset: null });
      if (url.startsWith('/api/git/changes')) return reply({ available: true, rootId: 'cmp', base: url.includes('base=') ? new URL(url, location.href).searchParams.get('base') : undefined, changes: [] });
      return reply({ error: 'not_found' }, 404);
    }));
    await import('../src/main'); await flush(); await flush();
    const input = document.querySelector<HTMLInputElement>('#comparison-base')!;
    input.dispatchEvent(new Event('focus')); await flush();
    const options = [...document.querySelectorAll<HTMLOptionElement>('#comparison-options option')];
    expect(options.map((option) => option.value)).toEqual(['HEAD', 'HEAD~1', 'ccccccc', 'bbbbbbb', 'aaaaaaa']);
    expect(options[3].label).toBe('bbbbbbb Commit 1');
    input.value = 'HEAD~1'; input.dispatchEvent(new InputEvent('input', { inputType: 'insertReplacementText' })); await flush();
    expect(new URL(location.href).searchParams.get('base')).toBe('b'.repeat(40));
    input.value = 'HEAD'; input.dispatchEvent(new InputEvent('input', { inputType: 'insertText' })); await flush();
    expect(new URL(location.href).searchParams.get('base')).toBe('b'.repeat(40));
  });

  it('groups consecutive matched characters into one mark', async () => {
    stubFetch(vi.fn(async (url: string) => url === '/api/search-index' ? reply({ paths: ['web/src/main.ts'] }) : reply(page([]))));
    await import('../src/main'); await flush();
    const search = document.querySelector<HTMLInputElement>('#search')!;
    search.value = 'main'; search.dispatchEvent(new Event('input')); await flush();
    const marks = [...document.querySelectorAll('#tree .node-file-name mark')];
    expect(marks.map((mark) => mark.textContent)).toEqual(['main']);
  });

  it('includes a matching file even when its path is very long', async () => {
    const longPath = `${'folder/'.repeat(90)}target.md`;
    stubFetch(vi.fn(async (url: string) => url === '/api/search-index' ? reply({ paths: [longPath] }) : reply(page([]))));
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
    stubFetch(fetch);
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
    stubFetch(fetch);
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
    stubFetch(vi.fn((url: string) => {
      if (url.startsWith('/api/tree')) return Promise.resolve(reply(page([entry('a.md')])));
      if (url.startsWith('/api/git/')) return Promise.resolve(reply({ available: false, changes: [] }));
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
    stubFetch(vi.fn((url: string) => {
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
    stubFetch(vi.fn(async (url: string) => {
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
    stubFetch(vi.fn((url: string) => {
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
    stubFetch(fetch);
    await import('../src/main'); await flush();
    document.querySelector<HTMLElement>('#tree summary')!.click(); await flush();
    expect(document.querySelector('#tree a')?.textContent).toBe('a.md');
    document.querySelector<HTMLElement>('#tree summary')!.click();
    document.querySelector<HTMLElement>('#tree summary')!.click(); await flush();
    expect(fetch.mock.calls.filter(([url]) => url === '/api/tree?path=docs').length).toBe(2);
  });

  it('collapses every folder around the selected file and keeps them closed during refresh', async () => {
    history.replaceState(null, '', '/?path=docs%2Fdeep%2Fa.md');
    const fetch = vi.fn(async (url: string) => {
      if (url === '/api/tree') return reply(page([entry('docs', 'directory'), entry('other', 'directory')]));
      if (url.startsWith('/api/tree?path=docs%2Fdeep')) return reply(page([entry('a.md', 'file', 'docs/deep')]));
      if (url.startsWith('/api/tree?path=docs')) return reply(page([entry('deep', 'directory', 'docs')]));
      if (url.startsWith('/api/tree?path=other')) return reply(page([entry('b.md', 'file', 'other')]));
      return reply({ path: 'docs/deep/a.md', type: 'markdown', html: '<h1>A</h1>' });
    });
    stubFetch(fetch);
    await import('../src/main'); await flush(); await flush();
    document.querySelector<HTMLElement>('details[data-path="other"] > summary')!.click(); await flush();
    const collapse = document.querySelector<HTMLButtonElement>('#collapse-all')!;
    expect(collapse.disabled).toBe(false);
    collapse.click();
    expect(document.querySelector<HTMLDetailsElement>('details[data-path="docs"]')?.open).toBe(false);
    expect(document.querySelector<HTMLDetailsElement>('details[data-path="other"]')?.open).toBe(false);
    expect(document.querySelector('details[data-path="docs/deep"]')).toBeNull();
    expect(document.querySelector('#content h1')?.textContent).toBe('A');
    expect(localStorage.getItem('markport-open-folders-v2')).toBe('[]');
    expect(sessionStorage.getItem('markport-collapsed-selection')).toBe('docs/deep/a.md');
    expect(collapse.disabled).toBe(true);
    const childRequests = fetch.mock.calls.filter(([url]) => url.startsWith('/api/tree?path=')).length;
    document.querySelector<HTMLButtonElement>('#reload')!.click(); await flush();
    expect(fetch.mock.calls.filter(([url]) => url.startsWith('/api/tree?path=')).length).toBe(childRequests);
    const search = document.querySelector<HTMLInputElement>('#search')!;
    search.value = 'a'; search.dispatchEvent(new Event('input'));
    expect(collapse.disabled).toBe(true);
    search.value = ''; search.dispatchEvent(new Event('input'));
    document.querySelector<HTMLButtonElement>('.crumb')!.click(); await flush();
    expect(document.querySelector<HTMLDetailsElement>('details[data-path="docs"]')?.open).toBe(true);
    expect(sessionStorage.getItem('markport-collapsed-selection')).toBeNull();
  });
});
