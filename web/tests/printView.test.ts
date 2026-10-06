// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrintView, printFile, printMarkdown } from '../src/printView';

const renders = vi.hoisted(() => ({ diagram: vi.fn(), math: vi.fn() }));
vi.mock('../src/mermaid', () => ({ drawMermaid: renders.diagram }));
vi.mock('../src/math', () => ({ drawMath: renders.math }));
const flush = async (): Promise<void> => { await new Promise((resolve) => setTimeout(resolve, 0)); };
const submit = (): HTMLButtonElement => document.querySelector('#print-submit')!;
const frameDocument = (): Document => document.querySelector<HTMLIFrameElement>('#print-view iframe')!.contentDocument!;
let view: ReturnType<typeof createPrintView>;
let opener: HTMLButtonElement;
Object.defineProperties(HTMLDialogElement.prototype, {
  showModal: { configurable: true, value() { this.open = true; } },
  close: { configurable: true, value() { this.open = false; this.dispatchEvent(new Event('close')); } },
});

beforeEach(() => {
  vi.clearAllMocks();
  document.body.innerHTML = '<button id="opener">Open print view</button>';
  opener = document.querySelector('#opener')!;
  renders.diagram.mockResolvedValue(undefined); renders.math.mockResolvedValue(undefined);
  view = createPrintView();
});
afterEach(() => { view?.close(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('print preparation', () => {
  it('waits for both renderers and fonts before printing only the frame', async () => {
    let diagramDone!: () => void; let mathDone!: () => void; let fontsDone!: () => void;
    renders.diagram.mockImplementation((article: HTMLElement) => {
      Object.defineProperty(article.ownerDocument, 'fonts', { value: { ready: new Promise<void>((resolve) => { fontsDone = resolve; }), [Symbol.iterator]: function* () {} } });
      return new Promise<void>((resolve) => { diagramDone = resolve; });
    });
    renders.math.mockImplementation(() => new Promise<void>((resolve) => { mathDone = resolve; }));
    view.open({ title: '日本語.md', load: async () => '<h1>日本語</h1><details><summary>More</summary>Included</details>' }, opener);
    await flush(); expect(submit().disabled).toBe(true);
    expect(frameDocument().title).toBe('日本語.md');
    expect(renders.diagram).toHaveBeenCalledWith(expect.anything(), expect.any(Function), undefined, true);
    diagramDone(); await flush(); expect(submit().disabled).toBe(true);
    mathDone(); await flush(); expect(submit().disabled).toBe(true);
    fontsDone(); await flush(); expect(submit().disabled).toBe(false);
    expect(frameDocument().querySelector('details')!.open).toBe(true);
    const win = frameDocument().defaultView!; const print = vi.spyOn(win, 'print').mockImplementation(() => {}); vi.spyOn(win, 'focus').mockImplementation(() => {});
    submit().click(); expect(print).toHaveBeenCalledOnce();
    expect(document.querySelector<HTMLDialogElement>('#print-view')!.open).toBe(true);
    view.close(); expect(document.activeElement).toBe(opener);
  });

  it('shows fetch errors, disables printing, and retries', async () => {
    const load = vi.fn().mockRejectedValueOnce(new Error('Offline')).mockResolvedValue('<h1>Recovered</h1>');
    view.open({ title: 'file.md', load }, opener); await flush();
    expect(submit().disabled).toBe(true); expect(document.querySelector('.print-status')!.textContent).toBe('Offline');
    document.querySelector<HTMLButtonElement>('#print-retry')!.click(); await flush();
    expect(submit().disabled).toBe(false); expect(frameDocument().querySelector('h1')!.textContent).toBe('Recovered');
  });

  it('disables printing on font failure and retries the captured HTML without fetching newer content', async () => {
    const load = vi.fn(async () => '<h1>Captured</h1>');
    renders.diagram.mockImplementationOnce(async (article: HTMLElement) => {
      Object.defineProperty(article.ownerDocument, 'fonts', { value: { ready: Promise.resolve(), [Symbol.iterator]: function* () { yield { status: 'error' }; } } });
    });
    view.open({ title: 'fonts.md', load }, opener); await flush();
    expect(submit().disabled).toBe(true); expect(document.querySelector('.print-status')!.textContent).toContain('Fonts could not be loaded');
    load.mockResolvedValue('<h1>Newer content</h1>');
    document.querySelector<HTMLButtonElement>('#print-retry')!.click(); await flush();
    expect(submit().disabled).toBe(false); expect(frameDocument().querySelector('h1')!.textContent).toBe('Captured'); expect(load).toHaveBeenCalledOnce();
  });

  it('does not let a closed request replace or contaminate a new snapshot', async () => {
    let oldReply!: (value: string) => void;
    const old = vi.fn((signal: AbortSignal) => { expect(signal.aborted).toBe(false); return new Promise<string>((resolve) => { oldReply = resolve; }); });
    view.open({ title: 'old.md', load: old }, opener); view.close();
    view.open({ title: 'new.md', load: async () => '<h1>New</h1>' }, opener); await flush();
    oldReply('<h1>Stale</h1>'); await flush();
    expect(frameDocument().querySelector('h1')!.textContent).toBe('New');
    // A retry must still use the new snapshot, not the late old response.
    document.querySelector<HTMLButtonElement>('#print-retry')!.click(); await flush();
    expect(frameDocument().querySelector('h1')!.textContent).toBe('New');
    expect(old.mock.calls[0][0].aborted).toBe(true);
  });

  it('replaces unavailable images and reports individual rendering errors', async () => {
    renders.diagram.mockImplementation(async (article: HTMLElement) => {
      article.querySelector('[data-mermaid]')!.innerHTML = '<p class="diagram-error">Invalid diagram</p><details><pre>original source</pre></details>';
      Object.defineProperty(article.querySelector('img'), 'decode', { value: () => Promise.reject(new Error('Missing')) });
    });
    view.open({ title: 'errors.md', load: async () => '<div data-mermaid="true"></div><img src="/missing.png" alt="Missing figure">' }, opener); await flush();
    expect(submit().disabled).toBe(false); expect(frameDocument().querySelector('.image-error')!.textContent).toContain('Missing figure');
    expect(frameDocument().querySelector('details')!.open).toBe(true); expect(document.querySelector('.print-status')!.textContent).toContain('errors are included');
  });

  it('stops waiting for an image after 15 seconds', async () => {
    vi.useFakeTimers();
    renders.diagram.mockImplementation(async (article: HTMLElement) => {
      Object.defineProperty(article.querySelector('img'), 'decode', { value: () => new Promise(() => {}) });
    });
    view.open({ title: 'slow.md', load: async () => '<img src="/slow.png" alt="Slow image">' }, opener);
    await vi.advanceTimersByTimeAsync(0); expect(submit().disabled).toBe(true);
    await vi.advanceTimersByTimeAsync(15000); expect(submit().disabled).toBe(false);
    expect(frameDocument().querySelector('.image-error')!.textContent).toContain('Slow image');
  });

  it('loads rendered files without source mode and captures pasted input before requesting', async () => {
    const fetch = vi.fn(async () => ({ ok: true, json: async () => ({ type: 'markdown', html: '<h1>Rendered</h1>' }) }));
    vi.stubGlobal('fetch', fetch); const signal = new AbortController().signal;
    await printFile('docs/a & b.md').load(signal);
    expect(fetch).toHaveBeenLastCalledWith('/api/file?path=docs%2Fa%20%26%20b.md', { cache: 'no-store', signal });
    let text = '# Captured'; const input = printMarkdown(text); text = '# New input'; await input.load(signal);
    expect(fetch).toHaveBeenLastCalledWith('/api/render', expect.objectContaining({ body: JSON.stringify({ markdown: '# Captured' }), signal }));
  });
});
