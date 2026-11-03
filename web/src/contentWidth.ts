import { createToolButton, setToolButton } from './toolButtons';
import { measureNaturalWidths } from './layoutMeasurements';

type Width = 'standard' | 'wide' | 'full';
const storageKey = 'markport-content-width';
const choices: { id: Width; label: string; em: number }[] = [
  { id: 'standard', label: 'Standard', em: 46 },
  { id: 'wide', label: 'Wide', em: 64 },
  { id: 'full', label: 'Full', em: Infinity },
];

/** One preference and menu shared by every Markdown preview in this tab. */
export function createContentWidth(): {
  createButton: () => HTMLButtonElement;
  cycle: () => void;
  decorate: (root: HTMLElement) => void;
  refresh: () => void;
  dispose: () => void;
} {
  const lifetime = new window.AbortController(); const { signal } = lifetime;
  let selected: Width = read(); let frame = 0; let origin: HTMLButtonElement | undefined;
  const buttons = new Set<HTMLButtonElement>();
  const roots = new Map<HTMLElement, MutationObserver>();
  const dirtyRoots = new Set<HTMLElement>();
  const widths = new WeakMap<Element, number>();
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
  const resize = typeof ResizeObserver === 'function' ? new ResizeObserver((entries) => {
    // Observe the full preview, not the blocks whose width we change. Ignore height changes.
    for (const entry of entries) {
      if (widths.get(entry.target) === entry.contentRect.width) continue;
      widths.set(entry.target, entry.contentRect.width); schedule();
    }
  }) : undefined;

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
    schedule();
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
  function schedule(): void {
    for (const root of roots.keys()) dirtyRoots.add(root);
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      const pending = [...dirtyRoots]; dirtyRoots.clear();
      for (const root of pending) {
        if (!root.isConnected) { roots.get(root)?.disconnect(); resize?.unobserve(root); roots.delete(root); continue; }
        layout(root);
      }
      position();
    });
  }
  function layout(root: HTMLElement): void {
    const markdown = root.dataset.kind === 'markdown' || root.classList.contains('paste-preview');
    root.classList.toggle('markdown-layout', markdown);
    if (!markdown) return;
    const children = [...root.children].filter((child): child is HTMLElement => child instanceof HTMLElement);
    for (const child of children) child.classList.remove('wide-content');
    // Full width needs no geometry reads, including when diagrams finish rendering.
    if (selected === 'full') { root.style.setProperty('--reading-width', '100%'); return; }
    const style = getComputedStyle(root);
    const measure = choices.find((choice) => choice.id === selected)!.em * parseFloat(style.fontSize);
    // Resolve em on the preview, so larger heading fonts use the same column as paragraphs.
    root.style.setProperty('--reading-width', `${measure}px`);
    if (!root.clientWidth) return;
    const available = root.clientWidth - parseFloat(style.paddingLeft || '0') - parseFloat(style.paddingRight || '0');
    const limit = Math.min(available, measure);
    // Only top-level blocks may extend beyond prose. Keep lists, quotes and details intact.
    const blocks = measureNaturalWidths(children.filter((child) => child.matches('.table-frame,.code-frame,.mermaid-source,[data-language]')));
    for (const { element, width } of blocks) element.classList.toggle('wide-content', width > limit + 1);
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
  window.addEventListener('resize', () => { schedule(); position(); }, { signal });
  window.addEventListener('storage', (event) => {
    if (event.key === storageKey || event.key === null) { selected = read(); apply(); }
  }, { signal });
  document.fonts?.addEventListener('loadingdone', schedule, { signal });
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
    decorate: (root) => {
      if (!roots.has(root)) {
        const observer = new MutationObserver(schedule);
        observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-kind', 'data-rendered'] });
        roots.set(root, observer); resize?.observe(root);
      }
      dirtyRoots.delete(root); layout(root);
    },
    refresh: schedule,
    dispose: () => {
      close(); lifetime.abort(); cancelAnimationFrame(frame); resize?.disconnect();
      for (const observer of roots.values()) observer.disconnect();
      roots.clear(); dirtyRoots.clear(); buttons.clear(); menu.remove();
    },
  };
}
