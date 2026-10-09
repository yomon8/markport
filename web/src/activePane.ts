import type { Pane } from './fileGit';

type Options = {
  left: HTMLElement;
  right: HTMLElement;
  leftTitle: HTMLElement;
  rightTitle: HTMLElement;
  onChange: () => void;
};

export function createActivePane({ left, right, leftTitle, rightTitle, onChange }: Options) {
  const lifetime = new window.AbortController(); const { signal } = lifetime;
  let selected: Pane = 'left'; let split = false; let suppressed = false;
  const badges = new Map<Pane, HTMLElement>();
  for (const pane of ['left', 'right'] as const) {
    const badge = document.createElement('span'); badge.className = 'active-pane-badge'; badge.textContent = 'Active';
    badge.setAttribute('aria-label', `${pane === 'left' ? 'Left' : 'Right'} pane selected as file destination`);
    badges.set(pane, badge);
  }
  function paint(): void {
    for (const [pane, element, title] of [['left', left, leftTitle], ['right', right, rightTitle]] as const) {
      const active = split && selected === pane;
      element.classList.toggle('pane-active', active);
      const badge = badges.get(pane)!; badge.hidden = !active;
      if (split && !title.contains(badge)) (title.querySelector('.breadcrumbs') ?? title).append(badge);
      if (!split) badge.remove();
    }
  }
  function select(pane: Pane): void {
    if (!split) pane = 'left';
    if (selected === pane) return;
    selected = pane; paint(); onChange();
  }
  for (const [pane, element] of [['left', left], ['right', right]] as const) {
    element.addEventListener('pointerdown', () => { if (!suppressed) select(pane); }, { signal });
    element.addEventListener('focusin', () => { if (!suppressed) select(pane); }, { signal });
  }
  // Cross-origin previews and the native PDF viewer do not bubble events to
  // their parent. Focus entering their iframe still selects the owning pane.
  window.addEventListener('blur', () => {
    queueMicrotask(() => {
      if (signal.aborted || suppressed) return;
      const target = document.activeElement;
      if (!(target instanceof HTMLIFrameElement)) return;
      if (right.contains(target)) select('right'); else if (left.contains(target)) select('left');
    });
  }, { signal });
  const observer = new MutationObserver(paint);
  for (const title of [leftTitle, rightTitle]) observer.observe(title, { childList: true, subtree: true });
  return {
    current: (): Pane => selected,
    select,
    setSplit: (value: boolean): void => { split = value; if (!value) select('left'); paint(); },
    withoutActivation: (action: () => void): void => { suppressed = true; try { action(); } finally { suppressed = false; } },
    dispose: (): void => { lifetime.abort(); observer.disconnect(); },
  };
}
