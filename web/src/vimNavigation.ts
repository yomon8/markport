import { editingShortcutTarget } from './shortcuts';

export type VimAction = 'down' | 'up' | 'left' | 'right' | 'first' | 'last' | 'halfDown' | 'halfUp' | 'pending';

// Each context owns its prefix; changing focus or location invalidates it.
export function createVimKeys() {
  let prefix: { time: number; target: EventTarget | null; url: string } | undefined;
  const reset = (): void => { prefix = undefined; };
  return {
    reset,
    read(event: KeyboardEvent): VimAction | undefined {
      const previous = prefix; reset();
      if (event.defaultPrevented || event.isComposing || event.keyCode === 229 || event.altKey || event.metaKey || editingShortcutTarget(event.target)) return;
      if (event.ctrlKey) {
        if (event.shiftKey) return;
        return event.key === 'd' ? 'halfDown' : event.key === 'u' ? 'halfUp' : undefined;
      }
      if (event.key === 'g' && !event.shiftKey) {
        if (event.repeat) return;
        if (previous && Date.now() - previous.time <= 800 && previous.target === event.target && previous.url === location.href) return 'first';
        prefix = { time: Date.now(), target: event.target, url: location.href }; return 'pending';
      }
      if (event.key === 'G' && event.shiftKey) return 'last';
      if (event.shiftKey) return;
      return ({ j: 'down', k: 'up', h: 'left', l: 'right' } as const)[event.key as 'j' | 'k' | 'h' | 'l'];
    },
  };
}

export function vimBlocked(): boolean {
  return Boolean(document.querySelector('dialog[open], #diagram-overlay:not(dialog):not([hidden])'))
    || [...document.querySelectorAll<HTMLElement>('[role="menu"]')].some((menu) => menu.getClientRects().length > 0);
}

export function scrollVim(pane: HTMLElement, action: VimAction | undefined): boolean {
  if (!action || action === 'left' || action === 'right') return false;
  const delta = action === 'down' ? 40 : action === 'up' ? -40 : action === 'halfDown' ? pane.clientHeight / 2 : -pane.clientHeight / 2;
  if (action !== 'pending') pane.scrollTop = action === 'first' ? 0 : action === 'last' ? pane.scrollHeight : Math.max(0, pane.scrollTop + delta);
  return true;
}
