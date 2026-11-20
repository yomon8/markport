// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bindDropdownMenu } from '../src/dropdownMenu';

afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); });

function setup() {
  document.body.innerHTML = '<button id="trigger" type="button" aria-expanded="false">Menu</button><div id="menu" role="menu" hidden><button id="first" type="button" disabled>Disabled</button><button id="second" type="button">Second</button><button id="third" type="button">Third</button></div><button id="outside" type="button">Outside</button>';
  const button = document.querySelector<HTMLButtonElement>('#trigger')!;
  const menu = document.querySelector<HTMLElement>('#menu')!;
  const outside = document.querySelector<HTMLButtonElement>('#outside')!;
  const controller = new AbortController();
  const api = bindDropdownMenu({ button, menu, signal: controller.signal });
  return { button, menu, outside, controller, api };
}

describe('dropdown menu binding', () => {
  it('opens on click, skips disabled items on focus/arrows, and closes on outside pointerdown without stealing focus', () => {
    const { button, menu, outside, controller } = setup();
    button.click();
    expect(menu.hidden).toBe(false);
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement?.id).toBe('second');

    menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(document.activeElement?.id).toBe('third');
    menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(document.activeElement?.id).toBe('second');

    // Inside click keeps menu open.
    menu.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(menu.hidden).toBe(false);

    // Outside click closes menu without returning focus to trigger.
    outside.focus();
    outside.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(menu.hidden).toBe(true);
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(outside);
    controller.abort();
  });

  it('closes on Escape and restores focus unless a nested submenu is open', () => {
    const { button, menu, controller } = setup();
    const nested = document.createElement('div');
    nested.setAttribute('role', 'menu');
    nested.hidden = false;
    menu.append(nested);

    button.click();
    menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(menu.hidden).toBe(false);

    nested.hidden = true;
    menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(menu.hidden).toBe(true);
    expect(document.activeElement).toBe(button);
    controller.abort();
  });

  it('stops responding after the AbortSignal is aborted', () => {
    const { button, menu, outside, controller } = setup();
    button.click();
    controller.abort();
    outside.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(menu.hidden).toBe(false);
  });
});
