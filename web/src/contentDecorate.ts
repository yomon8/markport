import { copyWithFeedback, createCopyButton } from './copyControls';
import { createToolButton } from './toolButtons';
import { measureNaturalWidths } from './layoutMeasurements';
import type { createContentWidth } from './contentWidth';
import type { createTableOverlay } from './tableOverlay';

type DecorationOptions = {
  content: HTMLElement;
  rightContent: HTMLElement;
  main: HTMLElement;
  title: HTMLElement;
  contentWidth: Pick<ReturnType<typeof createContentWidth>, 'decorate' | 'refresh'>;
  tableOverlay: Pick<ReturnType<typeof createTableOverlay>, 'open'>;
  getPath: () => string;
  getRightHash: () => string;
  onLineStart: (line: number) => void;
};

export function createContentDecoration(deps: DecorationOptions) {
  const { content, rightContent, main, title, contentWidth, tableOverlay } = deps;
  let wrapCodeLines = false;
  try { wrapCodeLines = localStorage.getItem('markport-wrap-code') === 'true'; } catch { /* Storage may be unavailable. */ }
  let wrapTableCells = false;
  try { wrapTableCells = localStorage.getItem('markport-wrap-tables') === 'true'; } catch { /* Storage may be unavailable. */ }
  type Tables = {
    frames: Set<HTMLElement>; visible: Set<HTMLTableElement>; scroller: HTMLElement; heading: HTMLElement | null;
    resize?: ResizeObserver; intersection?: IntersectionObserver; mutation: MutationObserver;
    scroll: () => void;
  };
  const tables = new Map<HTMLElement, Tables>();
  const pending = new Set<HTMLElement>();
  const overflow = new Set<HTMLElement>();
  const pendingCode = new Map<HTMLElement, HTMLElement>();
  let layoutFrame = 0;
  let headerFrame = 0;
  let disposed = false;
  function scheduleLayout(): void {
    if (disposed || layoutFrame) return;
    layoutFrame = requestAnimationFrame(flushLayout);
  }
  function refreshTables(): void {
    for (const state of tables.values()) for (const frame of state.frames) pending.add(frame);
    scheduleLayout();
  }
  function releaseTables(target: HTMLElement): void {
    const state = tables.get(target);
    if (!state) return;
    state.resize?.disconnect(); state.intersection?.disconnect(); state.mutation.disconnect();
    state.scroller.removeEventListener('scroll', state.scroll);
    for (const frame of state.frames) { pending.delete(frame); overflow.delete(frame); }
    tables.delete(target);
  }
  function flushLayout(): void {
    layoutFrame = 0;
    for (const [target, state] of tables) {
      if (!target.isConnected || ![...state.frames].some((frame) => target.contains(frame))) releaseTables(target);
    }
    const frames = [...pending].filter((frame) => frame.isConnected); pending.clear();
    // No per-table writes between intrinsic width reads.
    const measured = measureNaturalWidths(frames).map(({ element, width }) => ({ element, wide: width > element.clientWidth + 1 }));
    for (const { element, wide } of measured) { element.classList.toggle('wide', wide); overflow.add(element); }
    const states = [...overflow].filter((frame) => frame.isConnected).map(readTableOverflow); overflow.clear();
    const codes = [...pendingCode].filter(([frame]) => frame.isConnected).map(([frame, scroller]) => ({
      frame, overflows: scroller.scrollLeft + scroller.clientWidth < scroller.scrollWidth - 1,
    }));
    pendingCode.clear();
    states.forEach(applyTableOverflow);
    for (const { frame, overflows } of codes) frame.classList.toggle('overflows', overflows);
    scheduleHeaders();
  }
  function scheduleHeaders(): void {
    if (disposed || headerFrame) return;
    headerFrame = requestAnimationFrame(updateTableHeaders);
  }
  function decorateContent(target = content, path = deps.getPath()): void {
    function setWrap(frame: HTMLElement, enabled: boolean): void {
      frame.classList.toggle('wrapped', enabled);
      const numbers = [...frame.querySelectorAll<HTMLElement>('.lntd:first-child .lnt')];
      const lines = [...frame.querySelectorAll<HTMLElement>('.lntd:last-child .line')];
      lines.forEach((line, index) => {
        const existing = line.querySelector('.wrapped-line-number');
        const code = line.querySelector<HTMLElement>('.cl');
        if (enabled) {
          if (!existing && numbers[index]) {
            const anchor = document.createElement('a'); anchor.className = 'wrapped-line-number';
            anchor.href = `#L${index + 1}`; anchor.textContent = String(index + 1);
            anchor.setAttribute('aria-label', `Line ${index + 1}`); line.prepend(anchor);
          }
          const tail = line.lastChild;
          if (tail?.nodeType === Node.TEXT_NODE && tail.textContent?.endsWith('\n')) {
            tail.textContent = tail.textContent.slice(0, -1); line.dataset.wrapNewline = 'true';
          }
          const codeTail = code?.lastChild;
          if (codeTail?.nodeType === Node.TEXT_NODE && codeTail.textContent?.endsWith('\n')) {
            codeTail.textContent = codeTail.textContent.slice(0, -1); code!.dataset.wrapNewline = 'true';
          }
        } else {
          existing?.remove();
          if (line.dataset.wrapNewline === 'true') { line.append(document.createTextNode('\n')); delete line.dataset.wrapNewline; }
          if (code?.dataset.wrapNewline === 'true') { code.append(document.createTextNode('\n')); delete code.dataset.wrapNewline; }
        }
      });
    }
    function wrapCode(element: HTMLElement): void {
      const frame = document.createElement('div'); frame.className = 'code-frame';
      const toolbar = document.createElement('div'); toolbar.className = 'code-toolbar';
      const label = document.createElement('span'); label.textContent = element.closest<HTMLElement>('[data-language]')?.dataset.language || (target.dataset.kind === 'code' ? path.split('.').at(-1) : 'text') || 'text';
      const button = createToolButton('copy', 'Copy');
      button.addEventListener('click', () => {
        const lines = [...element.querySelectorAll<HTMLElement>('.lntd:last-child .line')];
        if (lines.length) {
          const text = lines.map((line) => (line.querySelector<HTMLElement>('.cl')?.textContent ?? '').replace(/\n$/, '')).join('\n');
          const last = lines.at(-1)!;
          const trailing = last.dataset.wrapNewline === 'true' || last.querySelector<HTMLElement>('.cl')?.dataset.wrapNewline === 'true' || last.textContent?.endsWith('\n');
          copyWithFeedback(button, text + (trailing ? '\n' : ''), 'Copy');
        } else copyWithFeedback(button, element.textContent ?? '', 'Copy');
      });
      const wrap = createToolButton('wrap', 'Wrap lines'); wrap.setAttribute('aria-pressed', String(wrapCodeLines));
      wrap.addEventListener('click', () => {
        wrapCodeLines = !wrapCodeLines;
        try { localStorage.setItem('markport-wrap-code', String(wrapCodeLines)); } catch { /* Storage may be unavailable. */ }
        for (const codeFrame of document.querySelectorAll<HTMLElement>('.code-frame')) {
          setWrap(codeFrame, wrapCodeLines);
          codeFrame.querySelector<HTMLButtonElement>('.code-wrap-toggle')?.setAttribute('aria-pressed', String(wrapCodeLines));
        }
        highlightCodeLines(false);
        highlightCodeLines(false, rightContent, deps.getRightHash());
        contentWidth.refresh();
        for (const codeFrame of document.querySelectorAll<HTMLElement>('.code-frame')) {
          const scroller = codeFrame.querySelector<HTMLElement>(':scope > .chroma, pre');
          if (scroller) pendingCode.set(codeFrame, scroller);
        }
        scheduleLayout();
      });
      wrap.classList.add('code-wrap-toggle');
      const controls = document.createElement('div'); controls.className = 'code-toolbar-actions'; controls.append(wrap, button);
      if (target === content && element.querySelector('.lntable')) {
        const copyLink = createToolButton('link', 'Copy line link'); copyLink.classList.add('copy-line-link'); copyLink.hidden = true;
        copyLink.addEventListener('click', () => copyWithFeedback(copyLink, location.href, 'Copy line link'));
        controls.prepend(copyLink);
      }
      toolbar.append(label, controls); element.before(frame); frame.append(toolbar, element); setWrap(frame, wrapCodeLines);
      const scroller = element.classList.contains('chroma') ? element : element.querySelector<HTMLElement>('pre') ?? element;
      const updateOverflow = (): void => { pendingCode.set(frame, scroller); scheduleLayout(); };
      scroller.addEventListener('scroll', updateOverflow, { passive: true }); updateOverflow();
    }
    for (const block of target.querySelectorAll<HTMLElement>('.chroma')) {
      if (block.closest('[data-mermaid],.code-frame,.chroma .chroma')) continue;
      wrapCode(block);
    }
    for (const pre of target.querySelectorAll<HTMLPreElement>('pre')) {
      if (pre.matches('.paste-highlight') || pre.closest('[data-mermaid],.code-frame')) continue;
      wrapCode(pre);
    }
    for (const formula of target.querySelectorAll<HTMLElement>('div.math-source[data-math="display"]')) {
      if (formula.closest('.math-frame')) continue;
      formula.dataset.mathSource ??= formula.textContent ?? '';
      const frame = document.createElement('div'); frame.className = 'math-frame';
      const actions = document.createElement('div'); actions.className = 'math-actions';
      actions.append(createCopyButton(() => formula.dataset.mathSource ?? ''));
      formula.before(frame); frame.append(actions, formula);
    }
    for (const img of target.querySelectorAll<HTMLImageElement>('img')) {
      img.loading = 'lazy'; img.decoding = 'async';
      img.addEventListener('error', () => { const note = document.createElement('span'); note.className = 'image-error'; note.textContent = img.alt || 'Cannot load image'; img.replaceWith(note); });
    }
    releaseTables(target);
    const frames = new Set<HTMLElement>();
    for (const table of target.querySelectorAll('table')) {
      if (table.closest('.chroma')) continue;
      frames.add(table.closest<HTMLElement>('.table-frame') ?? wrapTable(table));
    }
    const preview = target.dataset.kind === 'paste' ? target.querySelector<HTMLElement>('.paste-preview') : null;
    contentWidth.decorate(preview ?? target);
    if (!frames.size) return;
    const scroller = preview ?? (target === content ? main : target.parentElement ?? target);
    const state: Tables = {
      frames, visible: new Set(), scroller,
      heading: preview ? null : target === content ? title : scroller.querySelector<HTMLElement>('#right-title'),
      mutation: new MutationObserver(refreshTables), scroll: scheduleHeaders,
    };
    tables.set(target, state);
    if (typeof ResizeObserver === 'function') {
      const sizes = new WeakMap<Element, number>();
      state.resize = new ResizeObserver((entries) => {
        if (tables.get(target) !== state) return;
        for (const entry of entries) {
          if (sizes.get(entry.target) === entry.contentRect.width) continue;
          sizes.set(entry.target, entry.contentRect.width); pending.add(entry.target as HTMLElement);
        }
        if (pending.size) scheduleLayout();
        scheduleHeaders();
      });
    }
    if (typeof IntersectionObserver === 'function') {
      state.intersection = new IntersectionObserver((entries) => {
        if (tables.get(target) !== state) return;
        for (const entry of entries) {
          const table = entry.target as HTMLTableElement;
          if (entry.isIntersecting) state.visible.add(table);
          else { state.visible.delete(table); table.tHead?.style.removeProperty('transform'); }
        }
        scheduleHeaders();
      }, { root: scroller });
    }
    for (const frame of frames) {
      state.resize?.observe(frame); pending.add(frame);
      const table = frame.querySelector<HTMLTableElement>('table')!;
      if (state.intersection) state.intersection.observe(table); else state.visible.add(table);
    }
    state.mutation.observe(target, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['data-rendered', 'data-math-rendered'] });
    scroller.addEventListener('scroll', state.scroll, { passive: true });
    scheduleLayout();
  }

  function wrapTable(table: HTMLTableElement): HTMLElement {
    const frame = document.createElement('div'); frame.className = 'table-frame'; frame.classList.toggle('table-nowrap', !wrapTableCells);
    const actions = document.createElement('div'); actions.className = 'table-actions';
    const wrapButton = createToolButton('wrap', 'Wrap cells'); wrapButton.classList.add('table-wrap-toggle'); wrapButton.setAttribute('aria-pressed', String(wrapTableCells));
    wrapButton.addEventListener('click', () => {
      wrapTableCells = !wrapTableCells;
      try { localStorage.setItem('markport-wrap-tables', String(wrapTableCells)); } catch { /* Storage may be unavailable. */ }
      for (const other of document.querySelectorAll<HTMLElement>('.table-frame')) {
        other.classList.toggle('table-nowrap', !wrapTableCells);
        other.querySelector('.table-wrap-toggle')?.setAttribute('aria-pressed', String(wrapTableCells));
        pending.add(other);
      }
      contentWidth.refresh();
      scheduleLayout();
    });
    const expand = createToolButton('maximize', 'Expand'); expand.classList.add('table-expand');
    expand.addEventListener('click', () => tableOverlay.open(table, expand, !wrapTableCells));
    actions.append(wrapButton, expand);
    if (table.dataset.tableSource !== undefined) {
      frame.classList.add('has-copy');
      actions.append(createCopyButton(() => table.dataset.tableSource ?? ''));
    }
    const scroll = document.createElement('div'); scroll.className = 'table-scroll';
    const wrap = document.createElement('div'); wrap.className = 'table-wrap';
    wrap.addEventListener('scroll', () => { overflow.add(frame); scheduleLayout(); }, { passive: true });
    table.before(frame); wrap.append(table); scroll.append(wrap); frame.append(actions, scroll);
    return frame;
  }
  function readTableOverflow(frame: HTMLElement) {
    const wrap = frame.querySelector<HTMLElement>('.table-wrap')!;
    const scrollable = wrap.scrollWidth > wrap.clientWidth + 1;
    return { frame, wrap, scrollable, left: scrollable && wrap.scrollLeft > 1, right: scrollable && wrap.scrollLeft + wrap.clientWidth < wrap.scrollWidth - 1 };
  }
  function applyTableOverflow({ frame, wrap, scrollable, left, right }: ReturnType<typeof readTableOverflow>): void {
    frame.classList.toggle('overflows-left', left); frame.classList.toggle('overflows-right', right);
    if (scrollable) { wrap.tabIndex = 0; wrap.setAttribute('role', 'region'); wrap.setAttribute('aria-label', 'Scrollable table'); }
    else { wrap.removeAttribute('tabindex'); wrap.removeAttribute('role'); wrap.removeAttribute('aria-label'); }
  }
  function highlightCodeLines(scroll: boolean, pane = content, hash = location.hash): boolean {
    const match = /^#L(\d+)(?:-L(\d+))?$/.exec(hash);
    for (const marked of pane.querySelectorAll<HTMLElement>('.selected-code-line')) marked.classList.remove('selected-code-line');
    for (const button of pane.querySelectorAll<HTMLButtonElement>('.copy-line-link')) button.hidden = !match;
    if (!match) return false;
    const start = Number(match[1]); const end = match[2] ? Number(match[2]) : start;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 1 || end < start || end - start > 500) return false;
    if (pane === content) deps.onLineStart(start);
    const numbers = [...pane.querySelectorAll<HTMLElement>('.lntd:first-child .lnt')];
    const lines = [...pane.querySelectorAll<HTMLElement>('.lntd:last-child .line')];
    for (let line = start; line <= end; line++) {
      numbers[line - 1]?.classList.add('selected-code-line');
      lines[line - 1]?.classList.add('selected-code-line');
    }
    const target = wrapCodeLines ? lines[start - 1] : numbers[start - 1];
    if (scroll && target) target.scrollIntoView({ block: 'center' });
    return Boolean(target);
  }
  function updateTableHeaders(): void {
    headerFrame = 0;
    const updates: { head: HTMLTableSectionElement; distance: number }[] = [];
    for (const [target, state] of tables) {
      if (!target.isConnected) { releaseTables(target); continue; }
      if (!state.visible.size) continue;
      const top = state.scroller.getBoundingClientRect().top + (state.heading?.getBoundingClientRect().height ?? 0);
      for (const table of state.visible) {
        if (!target.contains(table)) { state.visible.delete(table); state.intersection?.unobserve(table); continue; }
        const head = table.tHead;
        if (!head) continue;
        const distance = Math.max(0, Math.min(table.offsetHeight - head.offsetHeight, top - table.getBoundingClientRect().top));
        updates.push({ head, distance });
      }
    }
    for (const { head, distance } of updates) head.style.transform = `translateY(${distance}px)`;
  }
  document.fonts?.addEventListener('loadingdone', refreshTables);
  return { decorateContent, highlightCodeLines, dispose: () => {
    disposed = true;
    document.fonts?.removeEventListener('loadingdone', refreshTables);
    cancelAnimationFrame(layoutFrame); cancelAnimationFrame(headerFrame);
    for (const target of tables.keys()) releaseTables(target);
    pending.clear(); overflow.clear(); pendingCode.clear();
  } };
}
