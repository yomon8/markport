type DropdownOptions = {
  button: HTMLButtonElement;
  menu: HTMLElement;
  isOpen?: () => boolean;
  setOpen?: (open: boolean) => void;
  onBeforeOpen?: () => void;
  signal?: AbortSignal;
};

export function bindDropdownMenu(options: DropdownOptions): {
  open: () => void;
  close: (restoreFocus?: boolean) => void;
  toggle: () => void;
} {
  const { button, menu, signal } = options;
  const isOpen = options.isOpen ?? (() => !menu.hidden);
  const setOpen = options.setOpen ?? ((open: boolean) => { menu.hidden = !open; });

  const close = (restoreFocus = false): void => {
    if (!isOpen()) return;
    setOpen(false);
    button.setAttribute('aria-expanded', 'false');
    if (restoreFocus && button.isConnected) button.focus();
  };

  const open = (): void => {
    if (isOpen()) return;
    options.onBeforeOpen?.();
    setOpen(true);
    button.setAttribute('aria-expanded', 'true');
    menu.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
  };

  const toggle = (): void => {
    if (isOpen()) close(true);
    else open();
  };

  button.addEventListener('click', toggle, { signal });
  menu.addEventListener('keydown', (event) => {
    if (!isOpen()) return;
    if (event.key === 'Escape') {
      if (menu.querySelector<HTMLElement>('[role="menu"]:not([hidden])')) return;
      event.preventDefault();
      event.stopPropagation();
      close(true);
      return;
    }
    if (menu.getAttribute('role') !== 'menu' || (event.key !== 'ArrowDown' && event.key !== 'ArrowUp')) return;
    event.preventDefault();
    const items = [...menu.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
    if (!items.length) return;
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    items[(index + (event.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length]?.focus();
  }, { signal });

  document.addEventListener('pointerdown', (event) => {
    if (!isOpen() || !(event.target instanceof Node)) return;
    if (!menu.contains(event.target) && !button.contains(event.target)) close(false);
  }, { signal });

  return { open, close, toggle };
}
