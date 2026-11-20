import { diffURL, type Change } from './diff';
import type { AppMode } from './navigation';
import { editingShortcutTarget, matchesShortcut, shortcutText } from './shortcuts';
import { createVimKeys, scrollVim, vimBlocked } from './vimNavigation';

type GlobalShortcutDeps = {
  main: HTMLElement;
  rightPane: HTMLElement;
  sidebar: HTMLElement;
  outline: HTMLElement;
  search: HTMLInputElement;
  drawerToggle: HTMLButtonElement;
  sidebarToggle: HTMLButtonElement;
  pasteToggle: HTMLButtonElement;
  headerMore: HTMLButtonElement;
  headerExtras: HTMLElement;
  activePane: () => 'left' | 'right';
  selected: () => string;
  selectedMode: () => AppMode;
  selectedBase: () => string;
  onlyUnreviewed: () => boolean;
  diffNeighbor: (path: string, direction: -1 | 1, unreviewedOnly: boolean) => Change | undefined;
  markReviewedAndNext: () => void;
  navigate: (url: string) => void;
  showFilesSidebar: () => void;
  cycleContentWidth: () => void;
  openServerInfo: () => void;
  openShortcutHelp: () => void;
  closeOverlays: () => void;
};

export function registerGlobalShortcuts(deps: GlobalShortcutDeps): () => void {
  const lifetime = new window.AbortController();
  const { signal } = lifetime;
  const vimKeys = createVimKeys();
  document.addEventListener('focusin', vimKeys.reset, { signal });
  window.addEventListener('blur', vimKeys.reset, { signal });
  window.addEventListener('popstate', vimKeys.reset, { signal });

  window.addEventListener('keydown', (event) => {
    const target = event.target;
    if (deps.selectedMode() === 'paste' || vimBlocked() || (target instanceof Element && target.closest('#sidebar, #sidebar-resize, #split-resize'))) {
      vimKeys.reset();
    } else if (scrollVim(deps.activePane() === 'right' ? deps.rightPane : deps.main, vimKeys.read(event))) {
      event.preventDefault();
      return;
    }
    if (event.defaultPrevented || event.isComposing || event.keyCode === 229) return;
    if (editingShortcutTarget(event.target)) return;

    if (matchesShortcut(event, 'pasteMode') || matchesShortcut(event, 'themeMenu')) {
      if (event.repeat || document.querySelector('dialog[open]')) return;
      if ([...document.querySelectorAll<HTMLElement>('[role="menu"]')].some((menu) => menu.getClientRects().length > 0)) return;
      event.preventDefault();
      if (matchesShortcut(event, 'pasteMode')) {
        if (deps.selectedMode() !== 'paste') deps.pasteToggle.click();
      } else {
        if (window.innerWidth <= 700) {
          deps.headerExtras.classList.add('open');
          deps.headerMore.setAttribute('aria-expanded', 'true');
        }
        document.querySelector<HTMLButtonElement>('#theme-toggle')!.click();
      }
      return;
    }

    if (matchesShortcut(event, 'contentWidth')) {
      if (event.repeat || window.innerWidth <= 700 || document.querySelector('dialog[open]')) return;
      if ([...document.querySelectorAll<HTMLElement>('[role="menu"]')].some((menu) => menu.getClientRects().length > 0)) return;
      if (![...document.querySelectorAll<HTMLButtonElement>('.content-width-toggle')].some((button) => !button.hidden && button.getClientRects().length > 0)) return;
      event.preventDefault();
      deps.cycleContentWidth();
      return;
    }

    if (deps.selectedMode() === 'diff' && !event.ctrlKey && !event.metaKey && !event.altKey) {
      if (matchesShortcut(event, 'nextChange') || matchesShortcut(event, 'previousChange')) {
        const next = deps.diffNeighbor(deps.selected(), matchesShortcut(event, 'nextChange') ? 1 : -1, deps.onlyUnreviewed());
        if (next) {
          event.preventDefault();
          deps.navigate(diffURL(next.path, deps.selectedBase()));
        }
        return;
      }
      if (matchesShortcut(event, 'reviewNext')) {
        event.preventDefault();
        deps.markReviewedAndNext();
        return;
      }
    }

    if (matchesShortcut(event, 'search')) {
      event.preventDefault();
      deps.showFilesSidebar();
      deps.sidebar.classList.remove('collapsed');
      deps.sidebarToggle.setAttribute('aria-expanded', 'true');
      deps.sidebarToggle.setAttribute('aria-label', 'Collapse sidebar');
      deps.sidebarToggle.title = `Collapse sidebar (${shortcutText('sidebar')})`;
      if (window.innerWidth <= 700) deps.sidebar.classList.add('open');
      deps.search.focus();
    }
    if (matchesShortcut(event, 'sidebar')) {
      event.preventDefault();
      if (window.innerWidth <= 700) deps.drawerToggle.click();
      else deps.sidebarToggle.click();
    }
    if (matchesShortcut(event, 'serverInfo')) {
      event.preventDefault();
      deps.openServerInfo();
    }
    if (matchesShortcut(event, 'help')) {
      event.preventDefault();
      deps.openShortcutHelp();
    }
    if (matchesShortcut(event, 'close')) {
      deps.sidebar.classList.remove('open');
      deps.outline.classList.remove('open');
      deps.closeOverlays();
    }
  }, { signal });

  return () => lifetime.abort();
}
