type Options = {
  container: HTMLElement;
  left: HTMLElement;
  right: HTMLElement;
  handle: HTMLElement;
  storageKey: string;
  horizontal: () => boolean;
  start?: () => number;
};

export function createSplitResize({ container, left, right, handle, storageKey, horizontal, start: regionStart }: Options): { setActive: (active: boolean) => void; dispose: () => void } {
  const lifetime = new window.AbortController();
  const { signal } = lifetime;
  let active = false;
  let ratio = 0.5;
  let pointer: number | undefined;
  let offset = 0;
  let shield: HTMLElement | undefined;
  try {
    const saved = localStorage.getItem(storageKey);
    const value = saved === null ? NaN : Number(saved);
    if (saved?.trim() && Number.isFinite(value) && value > 0 && value < 1) ratio = value;
  } catch { /* Resizing remains available without browser storage. */ }
  handle.classList.add('split-resize');
  handle.setAttribute('role', 'separator');
  handle.setAttribute('aria-orientation', 'vertical');
  handle.tabIndex = 0;

  function bounds(): { start: number; width: number; min: number; gap: number } {
    const start = regionStart?.() ?? left.getBoundingClientRect().left;
    const style = getComputedStyle(container);
    const gap = parseFloat(style.columnGap) || 0;
    const end = container.getBoundingClientRect().right - (parseFloat(style.paddingRight) || 0) - (parseFloat(style.borderRightWidth) || 0);
    const width = Math.max(0, end - start - handle.getBoundingClientRect().width - gap * 2);
    return { start, width, min: Math.min(200, width / 2), gap };
  }
  function finish(): void {
    const captured = pointer; pointer = undefined;
    if (captured !== undefined && handle.hasPointerCapture(captured)) handle.releasePointerCapture(captured);
    handle.classList.remove('dragging'); shield?.remove(); shield = undefined;
  }
  function update(): void {
    handle.hidden = !active || !horizontal();
    if (handle.hidden) { finish(); return; }
    const { width, min } = bounds();
    if (!width) return;
    const value = Math.max(min, Math.min(width - min, ratio * width)) / width;
    container.style.setProperty('--split-left', `${value}fr`);
    container.style.setProperty('--split-right', `${1 - value}fr`);
    handle.setAttribute('aria-valuemin', String(Math.round(min / width * 100)));
    handle.setAttribute('aria-valuemax', String(Math.round((width - min) / width * 100)));
    handle.setAttribute('aria-valuenow', String(Math.round(value * 100)));
    handle.setAttribute('aria-valuetext', `Left ${Math.round(value * 100)}%, right ${Math.round((1 - value) * 100)}%`);
  }
  function change(pixels: number): void {
    const { width, min } = bounds();
    if (!width) return;
    ratio = Math.max(min, Math.min(width - min, pixels)) / width;
    update();
    try { localStorage.setItem(storageKey, String(ratio)); } catch { /* Keep the current width when saving fails. */ }
  }
  handle.addEventListener('pointerdown', (event) => {
    if (handle.hidden || event.button !== 0 || pointer !== undefined) return;
    event.preventDefault(); handle.focus({ preventScroll: true });
    pointer = event.pointerId;
    offset = event.clientX - handle.getBoundingClientRect().left;
    handle.setPointerCapture(pointer); handle.classList.add('dragging');
    shield = document.createElement('div'); shield.className = 'split-resize-shield'; document.body.append(shield);
  }, { signal });
  handle.addEventListener('pointermove', (event) => {
    const { start, gap } = bounds();
    if (pointer === event.pointerId) change(event.clientX - start - offset - gap);
  }, { signal });
  for (const event of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) handle.addEventListener(event, finish, { signal });
  handle.addEventListener('keydown', (event) => {
    if (handle.hidden || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault(); event.stopPropagation();
    const { width } = bounds();
    const current = width * parseFloat(container.style.getPropertyValue('--split-left'));
    change(event.key === 'Home' ? 0 : event.key === 'End' ? width : current + (event.key === 'ArrowRight' ? 10 : -10));
  }, { signal });
  handle.addEventListener('dblclick', () => { if (!handle.hidden) change(bounds().width / 2); }, { signal });
  window.addEventListener('resize', update, { signal });
  window.addEventListener('blur', finish, { signal });
  const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(update);
  for (const element of [container, left, right]) observer?.observe(element);
  update();
  return {
    setActive: (value) => { active = value; update(); },
    dispose: () => { finish(); lifetime.abort(); observer?.disconnect(); },
  };
}
