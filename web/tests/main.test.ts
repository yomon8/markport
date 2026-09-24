// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/mermaid', () => ({ drawMermaid: vi.fn(async () => {}) }));

class FakeEvents extends EventTarget {
  static instance: FakeEvents;
  onerror: (() => void) | null = null;
  constructor() { super(); FakeEvents.instance = this; }
  emit(name: string): void { this.dispatchEvent(new Event(name)); }
}

const flush = async (): Promise<void> => { await new Promise((resolve) => setTimeout(resolve, 0)); };
const reply = (body: unknown, status = 200): Response => ({ ok: status < 400, status, json: async () => body }) as Response;

beforeEach(() => {
  vi.resetModules();
  localStorage.clear();
  document.body.innerHTML = '<div id="app"></div>';
  history.replaceState(null, '', '/');
  vi.stubGlobal('EventSource', FakeEvents);
});

describe('browser refresh', () => {
  it('waits for SSE ready, filters tree, and restores URL selection', async () => {
    history.replaceState(null, '', '/?path=docs%2Freadme.md');
    const fetch = vi.fn(async (url: string) => url === '/api/tree'
      ? reply({ entries: [{ name: 'docs', path: 'docs', type: 'directory', children: [{ name: 'readme.md', path: 'docs/readme.md', type: 'file' }] }] })
      : reply({ path: 'docs/readme.md', type: 'markdown', html: '<h1>Readme</h1>' }));
    vi.stubGlobal('fetch', fetch);
    await import('../src/main');
    expect(fetch).not.toHaveBeenCalled();
    FakeEvents.instance.emit('ready'); await flush();
    expect(document.querySelector('#content')?.textContent).toContain('Readme');
    expect(document.querySelector('nav a[aria-current]')?.textContent).toBe('readme.md');
    const search = document.querySelector<HTMLInputElement>('#search')!;
    search.value = 'missing'; search.dispatchEvent(new Event('input'));
    expect(document.querySelector('nav a')).toBeNull();
    search.value = 'docs'; search.dispatchEvent(new Event('input'));
    expect(document.querySelector('nav a')?.textContent).toBe('docs/readme.md');
    expect(document.querySelector('nav mark')?.textContent).toBe('d');
  });

  it('retries when an event arrives during an in-flight refresh', async () => {
    let releaseFirst: ((value: Response) => void) | undefined;
    let calls = 0;
    const fetch = vi.fn((url: string) => {
      if (url === '/api/tree' && ++calls === 1) return new Promise<Response>((resolve) => { releaseFirst = resolve; });
      return Promise.resolve(reply({ entries: [{ name: 'new.md', path: 'new.md', type: 'file' }] }));
    });
    vi.stubGlobal('fetch', fetch);
    await import('../src/main');
    FakeEvents.instance.emit('ready'); await flush();
    FakeEvents.instance.emit('refresh');
    releaseFirst?.(reply({ entries: [{ name: 'old.md', path: 'old.md', type: 'file' }] }));
    await flush(); await flush();
    expect(document.querySelector('nav')?.textContent).toContain('new.md');
    expect(document.querySelector('nav')?.textContent).not.toContain('old.md');
  });

  it('shows disconnect and recovers on ready', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => reply({ entries: [] })));
    await import('../src/main');
    FakeEvents.instance.onerror?.();
    expect(document.querySelector('#connection')?.textContent).toContain('再接続中');
    FakeEvents.instance.emit('ready'); await flush();
    expect(document.querySelector('#connection')?.textContent).toBe('自動更新中');
    FakeEvents.instance.emit('watch-error');
    expect(document.querySelector('#connection')?.textContent).toContain('監視エラー');
    FakeEvents.instance.emit('watch-ok');
    expect(document.querySelector('#connection')?.textContent).toBe('自動更新中');
  });

  it('resets scroll on navigation and preserves content DOM when HTML is unchanged', async () => {
    const fetch = vi.fn(async (url: string) => url === '/api/tree'
      ? reply({ entries: [{ name: 'a.md', path: 'a.md', type: 'file' }, { name: 'b.md', path: 'b.md', type: 'file' }] })
      : reply({ path: url.includes('a.md') ? 'a.md' : 'b.md', type: 'markdown', html: url.includes('a.md') ? '<h1>A</h1>' : '<h1>B</h1>' }));
    vi.stubGlobal('fetch', fetch);
    history.replaceState(null, '', '/?path=a.md');
    await import('../src/main'); FakeEvents.instance.emit('ready'); await flush();
    const main = document.querySelector<HTMLElement>('main')!;
    const first = document.querySelector('#content h1');
    main.scrollTop = 150;
    FakeEvents.instance.emit('changed'); await flush();
    expect(document.querySelector('#content h1')).toBe(first);
    expect(main.scrollTop).toBe(150);
    document.querySelector<HTMLAnchorElement>('nav a[href="/?path=b.md"]')!.click(); await flush();
    expect(main.scrollTop).toBe(0);
    expect(document.querySelector('#content')?.textContent).toContain('B');
  });

  it('starts collapsed and keeps a manually opened folder open across refresh and reload', async () => {
    localStorage.setItem('markport-closed-folders', '[]');
    vi.stubGlobal('fetch', vi.fn(async (url: string) => url === '/api/tree'
      ? reply({ entries: [{ name: 'docs', path: 'docs', type: 'directory', children: [{ name: 'a.md', path: 'docs/a.md', type: 'file' }] }] })
      : reply({ path: 'docs/a.md', type: 'markdown', html: '<p>A</p>' })));
    await import('../src/main'); FakeEvents.instance.emit('ready'); await flush();
    expect(document.querySelector<HTMLDetailsElement>('details[data-path="docs"]')?.open).toBe(false);
    document.querySelector('summary')!.click();
    FakeEvents.instance.emit('changed'); await flush();
    expect(document.querySelector<HTMLDetailsElement>('details[data-path="docs"]')?.open).toBe(true);
    expect(localStorage.getItem('markport-open-folders-v2')).toBe('["docs"]');
    vi.resetModules(); document.body.innerHTML = '<div id="app"></div>';
    await import('../src/main'); FakeEvents.instance.emit('ready'); await flush();
    expect(document.querySelector<HTMLDetailsElement>('details[data-path="docs"]')?.open).toBe(true);
  });

  it('opens only the selected ancestors without storing them as manually opened', async () => {
    history.replaceState(null, '', '/?path=docs%2Fdeep%2Fa.md');
    vi.stubGlobal('fetch', vi.fn(async (url: string) => url === '/api/tree'
      ? reply({ entries: [
        { name: 'other', path: 'other', type: 'directory', children: [{ name: 'x.md', path: 'other/x.md', type: 'file' }] },
        { name: 'docs', path: 'docs', type: 'directory', children: [{ name: 'deep', path: 'docs/deep', type: 'directory', children: [{ name: 'a.md', path: 'docs/deep/a.md', type: 'file' }] }] },
      ] })
      : reply({ path: 'docs/deep/a.md', type: 'markdown', html: '<p>A</p>' })));
    await import('../src/main'); FakeEvents.instance.emit('ready'); await flush();
    expect(document.querySelector<HTMLDetailsElement>('details[data-path="docs"]')?.open).toBe(true);
    expect(document.querySelector<HTMLDetailsElement>('details[data-path="docs/deep"]')?.open).toBe(true);
    expect(document.querySelector<HTMLDetailsElement>('details[data-path="other"]')?.open).toBe(false);
    expect(localStorage.getItem('markport-open-folders-v2')).toBeNull();
    history.pushState(null, '', '/?path=other%2Fx.md'); window.dispatchEvent(new PopStateEvent('popstate')); await flush();
    expect(document.querySelector<HTMLDetailsElement>('details[data-path="docs"]')?.open).toBe(false);
    expect(document.querySelector<HTMLDetailsElement>('details[data-path="other"]')?.open).toBe(true);
  });

  it('sorts each tree level with folders first and natural names', async () => {
    const entries = [
      { name: 'file10.md', path: 'file10.md', type: 'file' },
      { name: 'folder10', path: 'folder10', type: 'directory', children: [{ name: 'child10.md', path: 'folder10/child10.md', type: 'file' }, { name: 'child2.md', path: 'folder10/child2.md', type: 'file' }] },
      { name: 'file2.md', path: 'file2.md', type: 'file' },
      { name: 'folder2', path: 'folder2', type: 'directory', children: [] },
    ];
    vi.stubGlobal('fetch', vi.fn(async () => reply({ entries })));
    await import('../src/main'); FakeEvents.instance.emit('ready'); await flush();
    expect([...document.querySelectorAll('#tree > ul > li')].map((item) => item.querySelector(':scope > details > summary .node-label, :scope > a .node-label')?.textContent)).toEqual(['folder2', 'folder10', 'file2.md', 'file10.md']);
    document.querySelector<HTMLElement>('details[data-path="folder10"] > summary')!.click();
    expect([...document.querySelectorAll('details[data-path="folder10"] > ul > li')].map((item) => item.textContent?.trim())).toEqual(['child2.md', 'child10.md']);
  });
});
