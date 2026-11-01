// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { createVimKeys, scrollVim, vimBlocked } from '../src/vimNavigation';

const key = (key: string, options: KeyboardEventInit = {}) => new KeyboardEvent('keydown', { key, ...options });
describe('Vim navigation', () => {
  it('allows closed overlay dialogs and blocks open dialogs', () => {
    document.body.innerHTML = '<dialog id="diagram-overlay"></dialog><dialog id="table-overlay"></dialog>';
    expect(vimBlocked()).toBe(false);
    document.querySelector('dialog')!.setAttribute('open', '');
    expect(vimBlocked()).toBe(true); document.body.replaceChildren();
  });
  it('distinguishes G, ignores modifiers and composition, and supports Ctrl only half pages', () => {
    const keys = createVimKeys();
    expect(keys.read(key('G', { shiftKey: true }))).toBe('last');
    expect(keys.read(key('d', { ctrlKey: true }))).toBe('halfDown');
    expect(keys.read(key('u', { ctrlKey: true }))).toBe('halfUp');
    for (const options of [{ metaKey: true }, { altKey: true }, { ctrlKey: true }, { shiftKey: true }, { isComposing: true }, { keyCode: 229 }]) expect(keys.read(key('j', options))).toBeUndefined();
  });
  it('expires and resets prefixes, and does not accept auto-repeat', () => {
    const keys = createVimKeys(); const now = vi.spyOn(Date, 'now').mockReturnValue(1000);
    expect(keys.read(key('g'))).toBe('pending'); expect(keys.read(key('g'))).toBe('first');
    keys.read(key('g')); now.mockReturnValue(1801); expect(keys.read(key('g'))).toBe('pending');
    keys.reset(); expect(keys.read(key('g'))).toBe('pending');
    expect(keys.read(key('g', { repeat: true }))).toBeUndefined(); expect(keys.read(key('g'))).toBe('pending');
    keys.read(key('x')); expect(keys.read(key('g'))).toBe('pending'); now.mockRestore();
  });
  it('scrolls by fixed and viewport distances and jumps to edges', () => {
    const pane = document.createElement('div');
    Object.defineProperties(pane, { clientHeight: { value: 600 }, scrollHeight: { value: 2000 } });
    scrollVim(pane, 'down'); expect(pane.scrollTop).toBe(40);
    scrollVim(pane, 'halfDown'); expect(pane.scrollTop).toBe(340);
    scrollVim(pane, 'halfUp'); expect(pane.scrollTop).toBe(40);
    scrollVim(pane, 'up'); expect(pane.scrollTop).toBe(0);
    scrollVim(pane, 'last'); expect(pane.scrollTop).toBe(2000);
    scrollVim(pane, 'first'); expect(pane.scrollTop).toBe(0);
    expect(scrollVim(pane, 'left')).toBe(false);
  });
});
