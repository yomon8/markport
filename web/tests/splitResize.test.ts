// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { createSplitResize } from '../src/splitResize';

let cleanup = () => {};
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); localStorage.clear(); document.body.replaceChildren(); });

function setup(saved?: string) {
  if (saved !== undefined) localStorage.setItem('test-ratio', saved);
  let callback = () => {};
  const disconnect = vi.fn();
  vi.stubGlobal('ResizeObserver', class { constructor(fn: () => void) { callback = fn; } observe() {} disconnect = disconnect; });
  const container = document.createElement('div'); const left = document.createElement('div'); const right = document.createElement('div'); const handle = document.createElement('div');
  container.append(left, handle, right); document.body.append(container);
  let width = 1008; let horizontal = true;
  container.getBoundingClientRect = () => ({ right: width } as DOMRect);
  left.getBoundingClientRect = () => ({ left: 0 } as DOMRect);
  handle.getBoundingClientRect = () => ({ left: 500, width: 8 } as DOMRect);
  const release = vi.fn(); handle.hasPointerCapture = () => true; handle.releasePointerCapture = release; handle.setPointerCapture = vi.fn();
  const control = createSplitResize({ container, left, right, handle, storageKey: 'test-ratio', horizontal: () => horizontal });
  cleanup = control.dispose; control.setActive(true);
  const key = (key: string) => handle.dispatchEvent(new KeyboardEvent('keydown', { key, cancelable: true }));
  return { container, handle, control, disconnect, release, key, resize: (next: number) => { width = next; callback(); }, narrow: () => { horizontal = false; callback(); } };
}

it('restores a ratio and constrains it to available space without overwriting the preference', () => {
  const ui = setup('0.75'); expect(ui.handle.getAttribute('aria-valuenow')).toBe('75');
  ui.resize(408); expect(ui.handle.getAttribute('aria-valuenow')).toBe('50');
  expect(localStorage.getItem('test-ratio')).toBe('0.75');
  ui.resize(1008); expect(ui.handle.getAttribute('aria-valuenow')).toBe('75');
});

it.each(['', 'broken', 'Infinity', '0', '1', '-0.5'])('ignores invalid saved ratio %s', (value) => {
  expect(setup(value).handle.getAttribute('aria-valuenow')).toBe('50');
});

it('supports keyboard limits, persistence and resetting to equal widths', () => {
  const ui = setup(); ui.key('ArrowRight'); expect(localStorage.getItem('test-ratio')).toBe('0.51');
  ui.key('Home'); expect(ui.handle.getAttribute('aria-valuenow')).toBe('20');
  ui.key('End'); expect(ui.handle.getAttribute('aria-valuenow')).toBe('80');
  ui.handle.dispatchEvent(new MouseEvent('dblclick')); expect(localStorage.getItem('test-ratio')).toBe('0.5');
  ui.control.setActive(false); expect(ui.handle.hidden).toBe(true);
  ui.control.setActive(true); ui.narrow(); expect(ui.handle.hidden).toBe(true);
});

it('keeps resizing available when storage throws', () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
  const ui = setup(); ui.key('ArrowLeft'); expect(ui.handle.getAttribute('aria-valuenow')).toBe('49');
});

it('accounts for grid gaps during dragging and ignores movements after release', () => {
  const ui = setup(); ui.container.style.columnGap = '4px'; ui.resize(1016);
  ui.handle.getBoundingClientRect = () => ({ left: 504, width: 8 } as DOMRect);
  const pointer = (type: string, clientX: number) => {
    const event = new MouseEvent(type, { button: 0, clientX }); Object.defineProperty(event, 'pointerId', { value: 1 }); ui.handle.dispatchEvent(event);
  };
  pointer('pointerdown', 508); pointer('pointermove', 608);
  expect(ui.handle.getAttribute('aria-valuenow')).toBe('60');
  pointer('pointermove', 2000); expect(ui.handle.getAttribute('aria-valuenow')).toBe('80');
  pointer('pointerup', 2000); pointer('pointermove', 308);
  expect(ui.handle.getAttribute('aria-valuenow')).toBe('80');
});

it('cleans up pointer capture and the iframe shield on cancellation, hiding and disposal', () => {
  const ui = setup();
  const down = () => {
    const event = new MouseEvent('pointerdown', { button: 0 }); Object.defineProperty(event, 'pointerId', { value: 1 }); ui.handle.dispatchEvent(event);
    expect(document.querySelector('.split-resize-shield')).not.toBeNull();
  };
  down(); ui.handle.dispatchEvent(new Event('pointercancel')); expect(document.querySelector('.split-resize-shield')).toBeNull();
  down(); ui.control.setActive(false); expect(document.querySelector('.split-resize-shield')).toBeNull();
  ui.control.setActive(true); down(); ui.control.dispose(); expect(document.querySelector('.split-resize-shield')).toBeNull();
  expect(ui.disconnect).toHaveBeenCalled(); expect(ui.release).toHaveBeenCalledTimes(3);
});
