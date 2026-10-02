// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ServerInfo } from '../src/serverInfo';

const info = { rootPath: '/notes/作業 <script> & "quoted"', workingDirectory: '/work', version: 'dev' };
const response = (body: unknown = info, ok = true) => ({ ok, json: async () => body }) as Response;
const flush = async () => { await new Promise((resolve) => setTimeout(resolve, 0)); };
let controller: ServerInfo;
let button: HTMLButtonElement;
const dialog = () => document.querySelector<HTMLDialogElement>('#server-info-dialog')!;
const click = (text: string) => [...dialog().querySelectorAll('button')].find((item) => item.textContent === text)!.click();

beforeEach(() => {
  document.body.replaceChildren();
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: function (this: HTMLDialogElement) { this.open = true; } });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value: function (this: HTMLDialogElement) { this.open = false; this.dispatchEvent(new Event('close')); } });
  button = document.createElement('button'); document.body.append(button); controller = new ServerInfo(button);
});
afterEach(() => { controller.dispose(); vi.unstubAllGlobals(); });

describe('server info', () => {
  it('loads on demand and displays paths as text with the browser connection URL', async () => {
    const fetch = vi.fn(async () => response()); vi.stubGlobal('fetch', fetch);
    expect(fetch).not.toHaveBeenCalled();
    button.click(); expect(dialog().textContent).toContain('Loading server info'); await flush();
    expect([...dialog().querySelectorAll('dd')].map((item) => item.textContent)).toEqual([info.rootPath, info.workingDirectory, info.version, location.origin]);
    expect(dialog().querySelector('script')).toBeNull();
    expect(fetch).toHaveBeenCalledWith('/api/info', expect.objectContaining({ cache: 'no-store', signal: expect.any(AbortSignal) }));
    click('Close'); expect(dialog().open).toBe(false); expect(document.activeElement).toBe(button);
    button.click(); await flush(); expect(fetch).toHaveBeenCalledTimes(2);
  });

  it.each(['network', 'http', 'invalid'])('retries after a %s failure', async (failure) => {
    const fetch = vi.fn();
    if (failure === 'network') fetch.mockRejectedValueOnce(new Error('offline'));
    else fetch.mockResolvedValueOnce(failure === 'http' ? response({}, false) : response({ version: 'dev' }));
    fetch.mockResolvedValue(response()); vi.stubGlobal('fetch', fetch);
    button.click(); await flush(); expect(dialog().textContent).toContain('Cannot load server info'); expect(dialog().querySelectorAll('dd')).toHaveLength(0);
    click('Retry'); await flush(); expect(dialog().querySelectorAll('dd')).toHaveLength(4);
  });

  it('ignores delayed responses after closing or reopening', async () => {
    let resolve!: (value: Response) => void;
    const fetch = vi.fn().mockImplementationOnce(() => new Promise<Response>((done) => { resolve = done; })).mockResolvedValue(response({ ...info, rootPath: '/new' }));
    vi.stubGlobal('fetch', fetch);
    button.click(); click('Close'); button.click(); await flush();
    resolve(response()); await flush(); expect(dialog().querySelector('dd')?.textContent).toBe('/new');
    expect((fetch.mock.calls[0][1] as RequestInit).signal?.aborted).toBe(true);
  });

  it('clears stale data when the server changes and does not fetch when closed', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(response()).mockResolvedValue(response({ ...info, rootPath: '/new', version: 'v1.2.3' }));
    vi.stubGlobal('fetch', fetch);
    button.click(); await flush();
    const loading = controller.reloadIfOpen(); expect(dialog().querySelectorAll('dd')).toHaveLength(0); await loading;
    expect(dialog().querySelector('dd')?.textContent).toBe('/new'); expect(dialog().textContent).toContain('v1.2.3');
    click('Close'); await controller.reloadIfOpen(); expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('ignores a delayed response after disposal', async () => {
    let resolve!: (value: Response) => void;
    vi.stubGlobal('fetch', () => new Promise<Response>((done) => { resolve = done; }));
    button.click(); controller.dispose(); resolve(response()); await flush();
    expect(dialog().querySelectorAll('dd')).toHaveLength(0);
  });

  it('renders server links safely and refreshes the list on demand', async () => {
    const first = { rootPath: '/notes/<script>', version: 'v1.0.0', url: 'http://127.0.0.1:4000/', current: false };
    const current = { rootPath: '/work', version: 'dev', url: 'http://127.0.0.1:3000/', current: true };
    const local = { rootPath: '/private', version: 'dev', url: '', current: false, unavailableReason: 'Local access only' };
    const fetch = vi.fn().mockResolvedValueOnce(response({ ...info, instances: [current, first, local] }))
      .mockResolvedValue(response({ ...info, instances: [current] }));
    vi.stubGlobal('fetch', fetch);
    button.click(); await flush();
    const section = dialog().querySelector('section')!;
    const links = [...section.querySelectorAll('a')];
    expect(links.map((link) => link.getAttribute('href'))).toEqual([current.url, first.url]);
    expect(links[1].textContent).toBe(first.rootPath);
    expect(links[1].hasAttribute('target')).toBe(false);
    expect(section.querySelector('script')).toBeNull();
    expect(section.textContent).toContain('Current'); expect(section.textContent).toContain('Local access only');
    expect(section.querySelectorAll('li')).toHaveLength(3);
    click('Refresh'); await flush();
    expect(section.querySelectorAll('li')).toHaveLength(1); expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('keeps current server details and links when discovery partly fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(response({ ...info,
      instances: [{ rootPath: '/self', version: 'dev', url: 'http://127.0.0.1:3000/', current: true }],
      instancesError: 'Cannot load the complete server list. Please try again.',
    })).mockResolvedValue(response({ ...info, instances: [] })));
    button.click(); await flush();
    expect(dialog().querySelectorAll('dd')).toHaveLength(4);
    expect(dialog().textContent).toContain('Cannot load the complete server list');
    expect(dialog().querySelector('section a')).not.toBeNull();
    click('Retry'); await flush(); expect(dialog().textContent).not.toContain('Cannot load the complete server list');
  });

  it.each(['javascript:alert(1)', 'https://evil.example/', 'http://user:password@127.0.0.1:3000/', 'http://127.0.0.1:3000/?path=bad'])('rejects an unsafe instance link %s without hiding current details', async (url) => {
    vi.stubGlobal('fetch', async () => response({ ...info, instances: [{ rootPath: '/bad', version: 'dev', url, current: false }] }));
    button.click(); await flush();
    expect(dialog().querySelectorAll('dd')).toHaveLength(4);
    expect(dialog().querySelector('section a')).toBeNull();
    expect(dialog().textContent).toContain('Server discovery is unavailable');
  });

  const current = { rootPath: '/self', version: 'dev', url: 'http://127.0.0.1:3000/', current: true };
  const other = { rootPath: '/other', version: 'dev', url: 'http://127.0.0.1:4000/', current: false };
  const press = (key: string, options: KeyboardEventInit = {}) => {
    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...options });
    document.activeElement!.dispatchEvent(event);
    return event;
  };

  it('selects links with arrows, skips unavailable servers and stops at the ends', async () => {
    vi.stubGlobal('fetch', async () => response({ ...info, instances: [current,
      { ...other, url: '', unavailableReason: 'Local access only' }, other] }));
    controller.open(); await flush();
    const links = [...dialog().querySelectorAll('a')];
    expect(document.activeElement).toBe(links[0]);
    expect(press('ArrowUp').defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(links[0]);
    press('ArrowDown'); expect(document.activeElement).toBe(links[1]);
    press('ArrowDown'); expect(document.activeElement).toBe(links[1]);
    press('ArrowUp'); expect(document.activeElement).toBe(links[0]);
    const close = dialog().querySelector<HTMLButtonElement>('.server-info-actions button:last-child')!;
    close.focus(); press('ArrowUp'); expect(document.activeElement).toBe(links[1]);
    close.focus(); press('ArrowDown'); expect(document.activeElement).toBe(links[0]);
    for (const options of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }, { shiftKey: true }, { isComposing: true }, { keyCode: 229 }]) {
      expect(press('ArrowDown', options).defaultPrevented).toBe(false);
      expect(document.activeElement).toBe(links[0]);
    }
  });

  it('does not replace a focus choice made while the initial request is pending', async () => {
    let resolve!: (value: Response) => void;
    vi.stubGlobal('fetch', () => new Promise<Response>((done) => { resolve = done; }));
    controller.open();
    dialog().tabIndex = -1; dialog().focus();
    const close = dialog().querySelector<HTMLButtonElement>('.server-info-actions button:last-child')!;
    close.focus();
    resolve(response({ ...info, instances: [current] })); await flush();
    expect(document.activeElement).toBe(close);
  });

  it('restores the selected URL on refresh, then falls back to the first link or Close', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(response({ ...info, instances: [current, other] }))
      .mockResolvedValueOnce(response({ ...info, instances: [other, current] }))
      .mockResolvedValueOnce(response({ ...info, instances: [current] }))
      .mockResolvedValueOnce(response({ ...info, instances: [] }))
      .mockRejectedValue(new Error('offline'));
    vi.stubGlobal('fetch', fetch);
    controller.open(); await flush(); press('ArrowDown');
    await controller.reloadIfOpen(); expect((document.activeElement as HTMLAnchorElement).href).toBe(other.url);
    await controller.reloadIfOpen(); expect((document.activeElement as HTMLAnchorElement).href).toBe(current.url);
    await controller.reloadIfOpen(); expect(document.activeElement?.textContent).toBe('Close');
    expect(press('ArrowDown').defaultPrevented).toBe(false);
    await controller.reloadIfOpen(); expect(document.activeElement?.textContent).toBe('Close');
    expect(press('ArrowUp').defaultPrevented).toBe(false);
  });

  it('preserves Refresh focus and leaves text editing alone', async () => {
    vi.stubGlobal('fetch', async () => response({ ...info, instances: [current, other] }));
    controller.open(); await flush();
    const refresh = [...dialog().querySelectorAll('button')].find((item) => item.textContent === 'Refresh')!;
    refresh.focus(); await controller.reloadIfOpen(); expect(document.activeElement).toBe(refresh);
    const input = document.createElement('input'); dialog().append(input); input.focus();
    expect(press('ArrowDown').defaultPrevented).toBe(false); expect(document.activeElement).toBe(input);
  });

});
