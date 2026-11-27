// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createContentWidth } from '../src/contentWidth';

let controller: ReturnType<typeof createContentWidth>;
function button(): HTMLButtonElement {
  const control = controller.createButton(); document.body.append(control); return control;
}
function choose(control: HTMLButtonElement, name: string): void {
  control.click();
  [...document.querySelectorAll<HTMLButtonElement>('#content-width-menu button')].find((item) => item.textContent === name)!.click();
}

beforeEach(() => {
  localStorage.clear(); document.body.replaceChildren();
  delete document.documentElement.dataset.contentWidth;
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue([{}] as unknown as DOMRectList);
});
afterEach(async () => {
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  controller?.dispose(); document.body.replaceChildren(); await Promise.resolve();
  vi.restoreAllMocks(); vi.unstubAllGlobals();
});

describe('Markdown width preference', () => {
  it.each([['standard', 'standard'], ['wide', 'wide'], ['full', 'full'], ['unknown', 'full'], ['', 'full']])('restores %s as %s', (saved, expected) => {
    localStorage.setItem('markport-content-width', saved); controller = createContentWidth();
    expect(document.documentElement.dataset.contentWidth).toBe(expected);
  });

  it('defaults to Full and cycles all widths without moving focus', () => {
    controller = createContentWidth(); const left = button(); const right = button(); left.focus();
    expect(document.documentElement.dataset.contentWidth).toBe('full');
    expect(localStorage.getItem('markport-content-width')).toBeNull();
    for (const [value, name] of [['standard', 'Standard'], ['wide', 'Wide'], ['full', 'Full']]) {
      controller.cycle();
      expect(document.documentElement.dataset.contentWidth).toBe(value);
      expect(localStorage.getItem('markport-content-width')).toBe(value);
      expect(right.getAttribute('aria-label')).toBe(`Content width: ${name}`);
      expect(document.querySelector('[role=menuitemradio][aria-checked=true]')?.textContent).toBe(name);
      expect(document.activeElement).toBe(left);
    }
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
    controller = createContentWidth();
    expect(document.documentElement.dataset.contentWidth).toBe('full');
    controller.cycle();
    expect(button().getAttribute('aria-label')).toBe('Content width: Standard');
    choose(button(), 'Wide');
    expect(document.documentElement.dataset.contentWidth).toBe('wide');
    expect(button().getAttribute('aria-label')).toBe('Content width: Wide');
  });

  it('updates on cross-tab storage changes and resets on storage clear', () => {
    controller = createContentWidth(); const control = button();
    localStorage.setItem('markport-content-width', 'wide'); window.dispatchEvent(new StorageEvent('storage', { key: 'markport-content-width' }));
    expect(control.getAttribute('aria-label')).toBe('Content width: Wide');
    localStorage.clear(); window.dispatchEvent(new StorageEvent('storage', { key: null }));
    expect(control.getAttribute('aria-label')).toBe('Content width: Full');
  });

  it('supports arrow keys, Home, End, Escape and focus return', () => {
    localStorage.setItem('markport-content-width', 'standard');
    controller = createContentWidth(); const control = button();
    const menu = document.querySelector<HTMLElement>('#content-width-menu')!;
    // jsdom hides popovers but does not implement showPopover to reveal them.
    menu.style.display = 'block';
    control.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
    expect(document.activeElement?.textContent).toBe('Standard');
    for (const [key, expected] of [['ArrowDown', 'Wide'], ['End', 'Full'], ['ArrowDown', 'Standard'], ['ArrowUp', 'Full'], ['Home', 'Standard']]) {
      menu.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true })); expect(document.activeElement?.textContent).toBe(expected);
    }
    menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(menu.hidden).toBe(true); expect(control.getAttribute('aria-expanded')).toBe('false'); expect(document.activeElement).toBe(control);
  });

  it('dismisses on outside click and disposes its menu and listeners', () => {
    controller = createContentWidth(); const control = button(); control.click();
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(document.querySelector<HTMLElement>('#content-width-menu')!.hidden).toBe(true);
    controller.dispose(); expect(document.querySelector('#content-width-menu')).toBeNull();
    localStorage.setItem('markport-content-width', 'wide');
    window.dispatchEvent(new StorageEvent('storage', { key: 'markport-content-width' }));
    expect(document.documentElement.dataset.contentWidth).toBe('full');
  });
});
