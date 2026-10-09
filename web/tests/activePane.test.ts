// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { createActivePane } from '../src/activePane';

let cleanup = () => {};
afterEach(() => { cleanup(); document.body.replaceChildren(); });
function setup() {
  document.body.innerHTML = '<main><div id="left-title"></div><button id="left-button">Left</button></main><section><div id="right-title"></div><button id="right-button">Right</button><iframe></iframe></section><input id="sidebar-input">';
  const left = document.querySelector('main')!; const right = document.querySelector('section')!;
  const leftTitle = document.querySelector<HTMLElement>('#left-title')!; const rightTitle = document.querySelector<HTMLElement>('#right-title')!;
  const onChange = vi.fn(); const control = createActivePane({ left, right, leftTitle, rightTitle, onChange });
  cleanup = control.dispose; control.setSplit(true);
  return { left, right, leftTitle, rightTitle, onChange, control };
}

it('selects panes through pointer and focus while preserving the selection in the sidebar', () => {
  const ui = setup(); expect(ui.control.current()).toBe('left');
  ui.right.dispatchEvent(new Event('pointerdown', { bubbles: true })); expect(ui.control.current()).toBe('right');
  expect(ui.right.classList.contains('pane-active')).toBe(true);
  expect(ui.rightTitle.querySelector<HTMLElement>('.active-pane-badge')?.hidden).toBe(false);
  document.querySelector<HTMLInputElement>('#sidebar-input')!.focus(); expect(ui.control.current()).toBe('right');
  document.querySelector<HTMLButtonElement>('#left-button')!.focus(); expect(ui.control.current()).toBe('left');
  expect(ui.onChange).toHaveBeenCalledTimes(2);
});

it('ignores internal focus moves and restores the badge after title rendering', async () => {
  const ui = setup(); ui.control.select('right');
  ui.control.withoutActivation(() => document.querySelector<HTMLButtonElement>('#left-button')!.focus());
  expect(ui.control.current()).toBe('right');
  ui.rightTitle.innerHTML = '<div class="breadcrumbs">New file</div>'; await Promise.resolve(); await Promise.resolve();
  expect(ui.rightTitle.querySelectorAll('.active-pane-badge')).toHaveLength(1);
  expect(ui.rightTitle.querySelector<HTMLElement>('.active-pane-badge')?.hidden).toBe(false);
});

it('selects the owning pane when focus enters an iframe', async () => {
  const ui = setup(); document.querySelector('iframe')!.focus(); window.dispatchEvent(new Event('blur')); await Promise.resolve();
  expect(ui.control.current()).toBe('right');
});

it('resets to the left when split closes and cleans up listeners and rendering', async () => {
  const ui = setup(); ui.control.select('right'); ui.control.setSplit(false); await Promise.resolve();
  expect(ui.control.current()).toBe('left'); expect(document.querySelectorAll('.active-pane-badge')).toHaveLength(0);
  ui.control.setSplit(true); ui.control.dispose();
  ui.right.dispatchEvent(new Event('pointerdown', { bubbles: true })); expect(ui.control.current()).toBe('left');
  ui.leftTitle.textContent = 'Detached'; await Promise.resolve(); expect(ui.leftTitle.querySelector('.active-pane-badge')).toBeNull();
});
