export function createDiagramOverlay(): { open: (source: SVGSVGElement, opener: HTMLButtonElement) => void; close: () => void } {
  document.querySelector('#diagram-overlay')?.remove();
  const dialog = document.createElement('dialog'); dialog.id = 'diagram-overlay'; dialog.setAttribute('aria-label', 'Expanded Mermaid diagram');
  dialog.innerHTML = `<div class="overlay-toolbar"><button type="button" id="overlay-close">Close ×</button><button type="button" id="overlay-zoom-out" aria-label="Zoom out">−</button><button type="button" id="overlay-zoom-in" aria-label="Zoom in">+</button><button type="button" id="overlay-fit">Fit diagram</button><button type="button" id="overlay-actual">100%</button><output id="overlay-zoom-status" aria-live="polite"></output></div><div id="overlay-viewport" aria-label="Diagram canvas"><div id="overlay-content"></div></div>`;
  document.body.append(dialog);
  const viewport = dialog.querySelector<HTMLElement>('#overlay-viewport')!;
  const content = dialog.querySelector<HTMLElement>('#overlay-content')!;
  const status = dialog.querySelector<HTMLOutputElement>('#overlay-zoom-status')!;
  let opener: HTMLButtonElement | undefined;
  let width = 1; let height = 1; let scale = 1; let panX = 0; let panY = 0; let fitMode = true;
  const pointers = new Map<number, { x: number; y: number }>();
  let pinchDistance = 0;
  function render(): void {
    content.style.width = `${width}px`; content.style.height = `${height}px`;
    content.style.transform = `translate(-50%, -50%) translate(${panX}px, ${panY}px) scale(${scale})`;
    status.value = `${Math.round(scale * 100)}%`;
  }
  function fit(): void {
    scale = Math.min((viewport.clientWidth - 24) / width, (viewport.clientHeight - 24) / height);
    scale = Math.max(0.02, Math.min(8, scale)); panX = 0; panY = 0; fitMode = true; render();
  }
  function zoom(next: number, x = viewport.clientWidth / 2, y = viewport.clientHeight / 2): void {
    const previous = scale;
    scale = Math.max(0.02, Math.min(8, next));
    const ratio = scale / previous;
    panX = x - viewport.clientWidth / 2 - (x - viewport.clientWidth / 2 - panX) * ratio;
    panY = y - viewport.clientHeight / 2 - (y - viewport.clientHeight / 2 - panY) * ratio;
    fitMode = false; render();
  }
  dialog.querySelector<HTMLButtonElement>('#overlay-close')!.addEventListener('click', () => dialog.close());
  dialog.querySelector<HTMLButtonElement>('#overlay-zoom-in')!.addEventListener('click', () => zoom(scale * 1.25));
  dialog.querySelector<HTMLButtonElement>('#overlay-zoom-out')!.addEventListener('click', () => zoom(scale / 1.25));
  dialog.querySelector<HTMLButtonElement>('#overlay-fit')!.addEventListener('click', fit);
  dialog.querySelector<HTMLButtonElement>('#overlay-actual')!.addEventListener('click', () => { scale = 1; panX = 0; panY = 0; fitMode = false; render(); });
  dialog.addEventListener('close', () => { pointers.clear(); if (opener?.isConnected) opener.focus(); opener = undefined; content.replaceChildren(); });
  viewport.addEventListener('wheel', (event) => {
    if (!event.ctrlKey) return;
    event.preventDefault();
    const box = viewport.getBoundingClientRect();
    zoom(scale * Math.exp(-event.deltaY / 300), event.clientX - box.left, event.clientY - box.top);
  }, { passive: false });
  viewport.addEventListener('pointerdown', (event) => {
    viewport.setPointerCapture(event.pointerId); pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()]; pinchDistance = Math.hypot(a.x - b.x, a.y - b.y);
    }
  });
  viewport.addEventListener('pointermove', (event) => {
    const previous = pointers.get(event.pointerId); if (!previous) return;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.size === 1) { panX += event.clientX - previous.x; panY += event.clientY - previous.y; fitMode = false; render(); }
    else if (pointers.size === 2) {
      const [a, b] = [...pointers.values()]; const distance = Math.hypot(a.x - b.x, a.y - b.y);
      const box = viewport.getBoundingClientRect();
      zoom(scale * distance / (pinchDistance || distance), (a.x + b.x) / 2 - box.left, (a.y + b.y) / 2 - box.top);
      pinchDistance = distance;
    }
  });
  const release = (event: PointerEvent): void => { pointers.delete(event.pointerId); pinchDistance = 0; };
  viewport.addEventListener('pointerup', release); viewport.addEventListener('pointercancel', release);
  window.addEventListener('resize', () => { if (dialog.open && fitMode) fit(); });
  return {
    open(source, button) {
      opener = button;
      const svg = source.cloneNode(true) as SVGSVGElement;
      svg.removeAttribute('width'); svg.removeAttribute('height');
      svg.style.width = '100%'; svg.style.height = '100%';
      const viewBox = source.viewBox.baseVal;
      width = viewBox.width || source.getBoundingClientRect().width || 1;
      height = viewBox.height || source.getBoundingClientRect().height || 1;
      content.replaceChildren(svg);
      dialog.showModal(); dialog.querySelector<HTMLButtonElement>('#overlay-close')!.focus();
      requestAnimationFrame(fit);
    },
    close() { if (dialog.open) dialog.close(); },
  };
}
