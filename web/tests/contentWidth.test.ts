// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createContentWidth } from '../src/contentWidth';

let controller: ReturnType<typeof createContentWidth>;
let callbacks: Map<number, FrameRequestCallback>;
let serial: number;
function flush(): void {
  const queued = [...callbacks.values()]; callbacks.clear(); queued.forEach((callback) => callback(0));
}
function button(): HTMLButtonElement {
  const control = controller.createButton(); document.body.append(control); return control;
}
function choose(control: HTMLButtonElement, name: string): void {
  control.click();
  [...document.querySelectorAll<HTMLButtonElement>('#content-width-menu button')].find((item) => item.textContent === name)!.click();
}

beforeEach(() => {
  localStorage.clear(); document.body.replaceChildren(); serial = 0; callbacks = new Map();
  delete document.documentElement.dataset.contentWidth;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { callbacks.set(++serial, callback); return serial; });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => callbacks.delete(id));
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue([{}] as unknown as DOMRectList);
});
afterEach(async () => {
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  controller?.dispose(); document.body.replaceChildren(); await Promise.resolve();
  vi.restoreAllMocks(); vi.unstubAllGlobals();
});

describe('Markdown width preference', () => {
  it.each([['wide', 'wide'], ['full', 'full'], ['unknown', 'standard'], ['', 'standard']])('restores %s as %s', (saved, expected) => {
    localStorage.setItem('markport-content-width', saved); controller = createContentWidth();
    expect(document.documentElement.dataset.contentWidth).toBe(expected);
  });

  it('saves a choice and synchronizes every pane control, including controls created later', () => {
    controller = createContentWidth(); const left = button(); const right = button();
    choose(left, 'Wide');
    expect(localStorage.getItem('markport-content-width')).toBe('wide');
    expect(right.getAttribute('aria-label')).toBe('Content width: Wide');
    expect(button().dataset.tooltip).toBe('Content width: Wide');
    expect(document.activeElement).toBe(left);
    expect(document.querySelector('[role=menuitemradio][aria-checked=true]')?.textContent).toBe('Wide');
  });

  it('keeps the choice in this tab when browser storage is blocked', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    controller = createContentWidth(); choose(button(), 'Full');
    expect(document.documentElement.dataset.contentWidth).toBe('full');
    expect(button().getAttribute('aria-label')).toBe('Content width: Full');
  });

  it('updates on cross-tab storage changes and resets on storage clear', () => {
    controller = createContentWidth(); const control = button();
    localStorage.setItem('markport-content-width', 'wide'); window.dispatchEvent(new StorageEvent('storage', { key: 'markport-content-width' }));
    expect(control.getAttribute('aria-label')).toBe('Content width: Wide');
    localStorage.clear(); window.dispatchEvent(new StorageEvent('storage', { key: null }));
    expect(control.getAttribute('aria-label')).toBe('Content width: Standard');
  });

  it('supports arrow keys, Home, End, Escape and focus return', () => {
    controller = createContentWidth(); const control = button();
    control.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
    const menu = document.querySelector<HTMLElement>('#content-width-menu')!;
    expect(document.activeElement?.textContent).toBe('Standard');
    for (const [key, expected] of [['ArrowDown', 'Wide'], ['End', 'Full'], ['ArrowDown', 'Standard'], ['ArrowUp', 'Full'], ['Home', 'Standard']]) {
      menu.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true })); expect(document.activeElement?.textContent).toBe(expected);
    }
    menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(menu.hidden).toBe(true); expect(control.getAttribute('aria-expanded')).toBe('false'); expect(document.activeElement).toBe(control);
  });

  it('dismisses on outside click and disposes its menu and scheduled work', () => {
    controller = createContentWidth(); const control = button(); control.click();
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(document.querySelector<HTMLElement>('#content-width-menu')!.hidden).toBe(true);
    controller.dispose(); expect(document.querySelector('#content-width-menu')).toBeNull(); expect(callbacks.size).toBe(0);
  });
});

describe('Markdown block widths', () => {
  it('expands only long top-level blocks, recalculates on width selection, and leaves source structure intact', async () => {
    controller = createContentWidth(); const control = button();
    const root = document.createElement('article'); root.dataset.kind = 'markdown'; root.style.fontSize = '16px';
    root.innerHTML = '<p>日本語の本文</p><div data-language="text"><div class="code-frame wrapped"><pre>long source</pre></div></div><div class="code-frame"><pre>short</pre></div><blockquote><div class="code-frame"><pre>nested</pre></div></blockquote>';
    document.body.append(root); Object.defineProperty(root, 'clientWidth', { value: 1600 });
    Object.defineProperty(root.querySelector('pre')!, 'scrollWidth', { value: 900 });
    controller.decorate(root); flush();
    expect(root.querySelector('[data-language]')?.classList.contains('wide-content')).toBe(true);
    expect(root.querySelector('.wrapped')).not.toBeNull();
    expect(root.querySelector('blockquote .wide-content')).toBeNull();
    expect(root.querySelectorAll('.wide-content')).toHaveLength(1);
    expect(root.textContent).toBe('日本語の本文long sourceshortnested');
    choose(control, 'Wide'); flush(); expect(root.querySelector('.wide-content')).toBeNull();
    choose(control, 'Standard'); flush(); expect(root.querySelector('[data-language].wide-content')).not.toBeNull();
    root.dataset.kind = 'code'; await Promise.resolve(); flush(); expect(root.classList.contains('markdown-layout')).toBe(false);
  });
});
