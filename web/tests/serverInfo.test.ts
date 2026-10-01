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
});
