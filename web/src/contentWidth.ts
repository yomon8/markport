import { createToolButton, setToolButton } from './toolButtons';

type Width = 'standard' | 'wide' | 'full';
const storageKey = 'markport-content-width';
const choices: { id: Width; label: string }[] = [
  { id: 'standard', label: 'Standard' },
  { id: 'wide', label: 'Wide' },
  { id: 'full', label: 'Full' },
];

/** One preference and menu shared by every Markdown preview in this tab. */
export function createContentWidth(): {
  createButton: () => HTMLButtonElement;
  cycle: () => void;
  dispose: () => void;
} {
  const lifetime = new window.AbortController(); const { signal } = lifetime;
  let selected: Width = read(); let origin: HTMLButtonElement | undefined;
  const buttons = new Set<HTMLButtonElement>();
  const menu = document.createElement('div'); menu.id = 'content-width-menu'; menu.className = 'content-width-menu';
  menu.setAttribute('role', 'menu'); menu.setAttribute('aria-label', 'Content width');
  menu.setAttribute('popover', 'manual'); menu.hidden = true; document.body.append(menu);
  const items = choices.map((choice) => {
    const item = document.createElement('button'); item.type = 'button'; item.textContent = choice.label;
    item.setAttribute('role', 'menuitemradio'); item.tabIndex = -1;
    item.addEventListener('click', () => {
      select(choice.id); close(true);
    }, { signal });
    menu.append(item); return item;
  });
  function read(): Width {
    try { const saved = localStorage.getItem(storageKey); return choices.find((choice) => choice.id === saved)?.id ?? 'full'; }
    catch { return 'full'; }
  }
  function select(width: Width): void {
    selected = width;
    try { localStorage.setItem(storageKey, selected); } catch { /* Keep the selection in this tab. */ }
    apply();
  }
  function label(): string { return `Content width: ${choices.find((choice) => choice.id === selected)!.label}`; }
  function apply(): void {
    document.documentElement.dataset.contentWidth = selected;
    for (const button of buttons) {
      if (!button.isConnected) { buttons.delete(button); continue; }
      setToolButton(button, 'contentWidth', label());
    }
    items.forEach((item, index) => item.setAttribute('aria-checked', String(choices[index].id === selected)));
  }
  function close(focus = false): void {
    if (menu.hidden) return;
    menu.hidden = true; menu.hidePopover?.(); origin?.setAttribute('aria-expanded', 'false');
    if (focus && origin?.isConnected) origin.focus({ preventScroll: true });
    origin = undefined;
  }
  function position(): void {
    if (!origin || menu.hidden) return;
    if (!origin.isConnected || origin.getClientRects().length === 0 || window.innerWidth <= 700) { close(); return; }
    const rect = origin.getBoundingClientRect(); const box = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(8, Math.min(rect.right - box.width, window.innerWidth - box.width - 8))}px`;
    menu.style.top = `${rect.bottom + box.height + 8 <= window.innerHeight ? rect.bottom + 6 : Math.max(8, rect.top - box.height - 6)}px`;
  }
  function open(button: HTMLButtonElement): void {
    if (origin === button && !menu.hidden) { close(true); return; }
    close(); origin = button; menu.hidden = false; menu.showPopover?.();
    button.setAttribute('aria-expanded', 'true'); position();
    items[choices.findIndex((choice) => choice.id === selected)].focus();
  }
  menu.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' || event.key === 'Tab') {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); }
      close(true); return;
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault(); const current = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (current + (event.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length;
    items[next].focus();
  }, { signal });
  document.addEventListener('pointerdown', (event) => {
    if (event.target instanceof Node && !menu.contains(event.target) && !origin?.contains(event.target)) close();
  }, { signal });
  document.addEventListener('focusin', (event) => {
    if (event.target instanceof Node && !menu.contains(event.target) && !origin?.contains(event.target)) close();
  }, { signal });
  document.addEventListener('scroll', position, { capture: true, signal });
  window.addEventListener('resize', position, { signal });
  window.addEventListener('storage', (event) => {
    if (event.key === storageKey || event.key === null) { selected = read(); apply(); }
  }, { signal });
  apply();
  return {
    cycle: () => select(choices[(choices.findIndex((choice) => choice.id === selected) + 1) % choices.length].id),
    createButton: () => {
      for (const button of buttons) if (!button.isConnected) buttons.delete(button);
      const button = createToolButton('contentWidth', label()); button.classList.add('content-width-toggle');
      button.setAttribute('aria-haspopup', 'menu'); button.setAttribute('aria-controls', menu.id); button.setAttribute('aria-expanded', 'false');
      button.addEventListener('click', () => open(button), { signal });
      button.addEventListener('keydown', (event) => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); open(button); }
      }, { signal });
      buttons.add(button); return button;
    },
    dispose: () => {
      close(); lifetime.abort(); buttons.clear(); menu.remove();
    },
  };
}
