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
    expect(document.querySelector('nav a')).toBeNull();
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
});
