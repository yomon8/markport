// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TabTitle } from '../src/tabTitle';

const rootId = 'a'.repeat(64);
const key = `markport-tab-title:${rootId}`;
let controller: TabTitle;
let button: HTMLButtonElement;
const response = (title = '', root = rootId) => ({ ok: true, json: async () => ({ title, rootId: root }) }) as Response;
const input = () => document.querySelector<HTMLInputElement>('#tab-title-input')!;
const dialog = () => document.querySelector<HTMLDialogElement>('#tab-title-dialog')!;
const click = (text: string) => [...dialog().querySelectorAll('button')].find((button) => button.textContent === text)!.click();
const flush = async () => { await new Promise((resolve) => setTimeout(resolve, 0)); };

beforeEach(() => {
  localStorage.clear(); document.body.replaceChildren();
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: function (this: HTMLDialogElement) { this.open = true; } });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value: function (this: HTMLDialogElement) { this.open = false; this.dispatchEvent(new Event('close')); } });
  button = document.createElement('button'); document.body.append(button); controller = new TabTitle(button);
});
afterEach(() => { controller.dispose(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('tab title settings', () => {
  it('keeps a startup title fixed across screen changes and resets to it', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response('作業ノート')));
    await controller.reload();
    for (const name of ['README.md — markport', 'Git changes — markport', 'Pasted Markdown — markport']) {
      controller.setFallback(name); expect(document.title).toBe('作業ノート');
    }
    button.click(); input().value = '  Browser title  '; click('Save');
    expect(document.title).toBe('Browser title'); expect(localStorage.getItem(key)).toBe('Browser title'); expect(button).toBe(document.activeElement);
    button.click(); click('Reset');
    expect(document.title).toBe('作業ノート'); expect(localStorage.getItem(key)).toBeNull();
  });

  it('preserves the existing screen title when unset, including after an empty save', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response())); await controller.reload();
    controller.setFallback('README.md — markport'); expect(document.title).toBe('README.md — markport');
    button.click(); input().value = 'Custom'; click('Save');
    button.click(); input().value = '  '; click('Save');
    expect(document.title).toBe('README.md — markport'); expect(localStorage.getItem(key)).toBeNull();
  });

  it('restores overrides after restart and isolates folders', async () => {
    let root = rootId; localStorage.setItem(key, 'Saved');
    vi.stubGlobal('fetch', vi.fn(async () => response('Startup', root))); await controller.reload();
    expect(document.title).toBe('Saved'); await controller.reload(true); expect(document.title).toBe('Saved');
    root = 'b'.repeat(64); await controller.reload(true); expect(document.title).toBe('Startup');
    root = rootId; await controller.reload(true); expect(document.title).toBe('Saved');
  });

  it('discards edits on cancel and dialog dismissal', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response('Startup'))); await controller.reload();
    button.click(); input().value = 'Draft'; click('Cancel');
    button.click(); expect(input().value).toBe(''); input().value = 'Draft'; dialog().close();
    expect(document.title).toBe('Startup'); expect(localStorage.getItem(key)).toBeNull(); expect(button).toBe(document.activeElement);
  });

  it('synchronizes storage changes for the same root only', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response('Startup'))); await controller.reload();
    localStorage.setItem(key, 'Other tab'); window.dispatchEvent(new StorageEvent('storage', { key })); expect(document.title).toBe('Other tab');
    localStorage.setItem(key, 'Ignored'); window.dispatchEvent(new StorageEvent('storage', { key: 'other' })); expect(document.title).toBe('Other tab');
    localStorage.clear(); window.dispatchEvent(new StorageEvent('storage')); expect(document.title).toBe('Startup');
  });

  it('disables editing after retrieval failure and retries when reopened', async () => {
    const fetch = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(response('Startup'));
    vi.stubGlobal('fetch', fetch); await controller.reload();
    expect(input().disabled).toBe(true); expect(document.title).toBe('markport');
    button.click(); await flush(); expect(input().disabled).toBe(false); expect(document.title).toBe('Startup');
  });

  it('applies a title for this tab and reports persistent storage failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response('Startup'))); await controller.reload();
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('storage unavailable'); });
    button.click(); input().value = '<script> & 作業'; click('Save');
    expect(document.title).toBe('<script> & 作業'); expect(dialog().open).toBe(true);
    expect(dialog().querySelector('[role="status"]')?.textContent).toContain('could not save');
    await controller.reload(); expect(document.title).toBe('<script> & 作業');
  });

  it('ignores stale responses and invalid configuration', async () => {
    let release!: (value: Response) => void;
    vi.stubGlobal('fetch', vi.fn().mockImplementationOnce(() => new Promise<Response>((resolve) => { release = resolve; })).mockResolvedValue(response('Latest')));
    const old = controller.reload(); await controller.reload(); release(response('Old')); await old; expect(document.title).toBe('Latest');
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ title: 'Bad', rootId: '' }) })));
    await controller.reload(true); expect(input().disabled).toBe(true); expect(document.title).toBe('markport');
  });
});
