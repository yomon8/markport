// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { createPasteEditor } from '../src/pasteEditor';
let editor: ReturnType<typeof createPasteEditor>;
let version: number; let input: HTMLTextAreaElement;
const flush = async () => { await new Promise((resolve) => setTimeout(resolve, 0)); };
const change = (text: string) => { input.value = text; input.dispatchEvent(new Event('input')); };
const click = (name: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent === name)!.click();
async function mount(): Promise<void> {
  document.body.innerHTML = '<div class="layout"><main><div id="title"></div><article></article></main></div>';
  version = 0;
  const { createPasteEditor } = await import('../src/pasteEditor');
  editor = createPasteEditor({ content: document.querySelector('article')!, title: document.querySelector('#title')!, main: document.querySelector('main')!,
    isActive: () => true, nextVersion: () => ++version, version: () => version, onPreview: vi.fn(), onText: vi.fn() });
  input = document.querySelector('textarea')!;
}
beforeEach(() => {
  vi.resetModules(); sessionStorage.clear(); localStorage.clear();
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => window.setTimeout(() => callback(0), 0));
  vi.stubGlobal('cancelAnimationFrame', clearTimeout);
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ html: '<h1>Rendered</h1>' }) })));
});
afterEach(() => { editor?.dispose(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
describe('paste editor', () => {
  it('restores the draft, caret and focus while using accessible native input', async () => {
    sessionStorage.setItem('markport-pasted-markdown', '# Restored'); sessionStorage.setItem('markport-pasted-markdown-caret', '[3,5,0]');
    await mount(); expect(input.value).toBe('# Restored'); expect(input.selectionStart).toBe(3); expect(input.selectionEnd).toBe(5); expect(document.activeElement).toBe(input);
    expect(document.querySelector('label[for=paste-input]')?.textContent).toBe('Markdown Text'); expect(document.querySelector('.paste-highlight')?.getAttribute('aria-hidden')).toBe('true'); expect(input.spellcheck).toBe(false);
  });
  it('updates highlighting once per frame and keeps IME composition native', async () => {
    await mount(); input.dispatchEvent(new Event('compositionstart')); change('# Composing'); await flush();
    expect(document.querySelector('.paste-heading')).toBeNull(); expect(document.querySelector('.paste-composing')).not.toBeNull();
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, isComposing: true })); expect(input.value).toBe('# Composing');
    input.dispatchEvent(new Event('compositionend')); await flush(); expect(document.querySelector('.paste-heading')?.textContent).toBe('# Composing');
  });
  it('keeps large drafts editable while enforcing the render/save limit', async () => {
    await mount(); change('# ' + 'a'.repeat(210 * 1024)); await flush(); expect(document.querySelector('.paste-plain')).not.toBeNull(); expect(document.querySelector('.paste-notice')?.textContent).toContain('Highlighting paused');
    change('a'.repeat((1 << 20) + 1)); click('Rendered'); expect(fetch).not.toHaveBeenCalled(); expect(sessionStorage.getItem('markport-pasted-markdown')).toBeNull();
    expect(document.querySelector('.paste-status')?.textContent).toContain('not saved'); expect(document.querySelector('.paste-status.warning')).not.toBeNull();
  });
  it('reports storage failure and retains the live draft', async () => {
    await mount(); vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); }); change('# Keep');
    expect(document.querySelector('.paste-status')?.textContent).toContain('Save failed'); expect(input.value).toBe('# Keep'); expect(document.querySelector('.paste-notice')?.textContent).toContain('could not save');
    editor.dispose(); await mount(); expect(input.value).toBe('# Keep');
  });
  it('requires confirmation before Clear and allows cancellation', async () => {
    await mount(); change('# Keep'); const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false); click('Clear'); expect(input.value).toBe('# Keep');
    confirm.mockReturnValue(true); click('Clear'); expect(input.value).toBe(''); expect(sessionStorage.getItem('markport-pasted-markdown')).toBeNull();
  });
  it('uses browser storage only after opt-in and deletes it when opted out', async () => {
    await mount(); change('# Private'); expect(localStorage.getItem('markport-pasted-markdown')).toBeNull();
    const checkbox = [...document.querySelectorAll<HTMLInputElement>('input[type=checkbox]')].at(-1)!;
    checkbox.checked = true; checkbox.dispatchEvent(new Event('change')); expect(localStorage.getItem('markport-pasted-markdown')).toBe('# Private');
    checkbox.checked = false; checkbox.dispatchEvent(new Event('change')); expect(localStorage.getItem('markport-pasted-markdown')).toBeNull(); expect(localStorage.getItem('markport-pasted-markdown-persistent')).toBeNull();
  });
  it('restores an explicitly saved browser draft in a fresh session', async () => {
    localStorage.setItem('markport-pasted-markdown-persistent', 'true'); localStorage.setItem('markport-pasted-markdown', '# Browser'); await mount(); expect(input.value).toBe('# Browser');
    expect(document.querySelector('.paste-status')?.textContent).toContain('Saved in this browser');
  });
  it('discards render replies after newer input and after leaving the editor', async () => {
    let resolve!: (response: unknown) => void;
    vi.stubGlobal('fetch', vi.fn(() => new Promise((done) => { resolve = done; })));
    await mount(); change('# Old'); click('Rendered'); click('Text'); change('# New');
    resolve({ ok: true, json: async () => ({ html: '<h1>Stale</h1>' }) }); await flush(); expect(document.querySelector('.paste-preview h1')).toBeNull();
    click('Rendered'); editor.dispose(); resolve({ ok: true, json: async () => ({ html: '<h1>Disposed</h1>' }) }); await flush(); expect(document.querySelector('.paste-preview h1')).toBeNull();
  });
  it('handles Ctrl/Cmd+Enter and Escape without interfering with composition', async () => {
    await mount(); change('# Draft');
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true })); await flush(); expect(document.querySelector('#paste-view-toggle')?.getAttribute('aria-pressed')).toBe('true');
    document.querySelector('#paste-view-toggle')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', metaKey: true, bubbles: true })); expect(input.hidden).toBe(false); expect(document.activeElement).toBe(input);
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); expect(document.activeElement).not.toBe(input);
  });
});
