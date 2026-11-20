// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerGlobalShortcuts } from '../src/globalShortcuts';
import type { AppMode } from '../src/navigation';

afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); });

function setup(mode: AppMode = 'file') {
  document.body.innerHTML = '<main id="main"></main><section id="right-pane"></section><aside id="sidebar" class="collapsed"><input id="search"></aside><nav id="outline" class="open"></nav><button id="drawer-toggle"></button><button id="sidebar-toggle"></button><button id="paste-toggle"></button><button id="header-more"></button><div id="header-extras"><button id="theme-toggle"></button></div>';
  const callbacks = {
    diffNeighbor: vi.fn(() => ({ path: 'next.md', status: 'modified' as const, revision: 'r1' })),
    markReviewedAndNext: vi.fn(),
    navigate: vi.fn(),
    showFilesSidebar: vi.fn(),
    cycleContentWidth: vi.fn(),
    openServerInfo: vi.fn(),
    openShortcutHelp: vi.fn(),
    closeOverlays: vi.fn(),
  };
  let currentMode = mode;
  const dispose = registerGlobalShortcuts({
    main: document.querySelector('#main')!,
    rightPane: document.querySelector('#right-pane')!,
    sidebar: document.querySelector('#sidebar')!,
    outline: document.querySelector('#outline')!,
    search: document.querySelector('#search')!,
    drawerToggle: document.querySelector('#drawer-toggle')!,
    sidebarToggle: document.querySelector('#sidebar-toggle')!,
    pasteToggle: document.querySelector('#paste-toggle')!,
    headerMore: document.querySelector('#header-more')!,
    headerExtras: document.querySelector('#header-extras')!,
    activePane: () => 'left',
    selected: () => 'a.md',
    selectedMode: () => currentMode,
    selectedBase: () => 'abc1234',
    onlyUnreviewed: () => false,
    ...callbacks,
  });
  return { callbacks, dispose, setMode: (next: AppMode) => { currentMode = next; } };
}

describe('global shortcuts registration', () => {
  it('focuses search on /, opens help on ?, opens server info on Ctrl+I, and closes overlays on Escape', () => {
    const { callbacks, dispose } = setup();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '/', bubbles: true, cancelable: true }));
    expect(callbacks.showFilesSidebar).toHaveBeenCalledOnce();
    expect(document.querySelector('#sidebar')?.classList.contains('collapsed')).toBe(false);
    expect(document.activeElement).toBe(document.querySelector('#search'));
    document.querySelector<HTMLInputElement>('#search')!.blur();

    window.dispatchEvent(new KeyboardEvent('keydown', { key: '?', shiftKey: true, bubbles: true, cancelable: true }));
    expect(callbacks.openShortcutHelp).toHaveBeenCalledOnce();

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'i', ctrlKey: true, bubbles: true, cancelable: true }));
    expect(callbacks.openServerInfo).toHaveBeenCalledOnce();

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(callbacks.closeOverlays).toHaveBeenCalledOnce();
    expect(document.querySelector('#outline')?.classList.contains('open')).toBe(false);
    dispose();
  });

  it('handles diff review navigation shortcuts only in diff mode and stops after dispose', () => {
    const { callbacks, dispose } = setup('diff');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', bubbles: true, cancelable: true }));
    expect(callbacks.navigate).toHaveBeenCalledWith('/?path=next.md&view=diff&base=abc1234');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'r', bubbles: true, cancelable: true }));
    expect(callbacks.markReviewedAndNext).toHaveBeenCalledOnce();

    dispose();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'r', bubbles: true, cancelable: true }));
    expect(callbacks.markReviewedAndNext).toHaveBeenCalledOnce();
  });
});
