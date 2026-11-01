import { copyWithFeedback, createCopyButton } from './copyControls';
import { createToolButton } from './toolButtons';
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
  const tableObservers = new Map<HTMLElement, ResizeObserver>();
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
      });
      wrap.classList.add('code-wrap-toggle');
      const controls = document.createElement('div'); controls.className = 'code-toolbar-actions'; controls.append(wrap, button);
      if (target === content && element.querySelector('.lntable')) {
        const copyLink = createToolButton('link', 'Copy line link'); copyLink.classList.add('copy-line-link'); copyLink.hidden = true;
        copyLink.addEventListener('click', () => copyWithFeedback(copyLink, location.href, 'Copy line link'));
        controls.prepend(copyLink);
      }
      toolbar.append(label, controls); element.before(frame); frame.append(toolbar, element); setWrap(frame, wrapCodeLines);
      if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => {
        const scroller = element.classList.contains('chroma') ? element : element.querySelector<HTMLElement>('pre') ?? element;
        const updateOverflow = (): void => { frame.classList.toggle('overflows', scroller.scrollLeft + scroller.clientWidth < scroller.scrollWidth - 1); };
        scroller.addEventListener('scroll', updateOverflow); updateOverflow();
      });
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
    tableObservers.get(target)?.disconnect();
    const pending = new Set<HTMLElement>();
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver((entries) => {
      // Defer so toggling the actions bar does not resize frames inside the observer callback.
      if (!pending.size) requestAnimationFrame(() => { pending.forEach(updateTableLayout); pending.clear(); });
      for (const entry of entries) pending.add(entry.target as HTMLElement);
    }) : undefined;
    if (observer) tableObservers.set(target, observer);
    for (const table of target.querySelectorAll('table')) {
      if (table.closest('.chroma')) continue;
      const frame = table.closest<HTMLElement>('.table-frame') ?? wrapTable(table);
      observer?.observe(frame);
    }
    updateTableHeaders();
    contentWidth.decorate(target.dataset.kind === 'paste' ? target.querySelector<HTMLElement>('.paste-preview')! : target);
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
        updateTableLayout(other);
      }
      updateTableHeaders();
      contentWidth.refresh();
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
    wrap.addEventListener('scroll', () => updateTableOverflow(frame));
    table.before(frame); wrap.append(table); scroll.append(wrap); frame.append(actions, scroll);
    return frame;
  }
  function updateTableLayout(frame: HTMLElement): void {
    const table = frame.querySelector<HTMLTableElement>('.table-wrap table');
    if (!table || !frame.isConnected) return;
    table.style.width = 'max-content'; const natural = table.offsetWidth; table.style.removeProperty('width');
    frame.classList.toggle('wide', natural > frame.clientWidth + 1);
    updateTableOverflow(frame);
  }
  function updateTableOverflow(frame: HTMLElement): void {
    const wrap = frame.querySelector<HTMLElement>('.table-wrap');
    if (!wrap) return;
    const scrollable = wrap.scrollWidth > wrap.clientWidth + 1;
    frame.classList.toggle('overflows-left', scrollable && wrap.scrollLeft > 1);
    frame.classList.toggle('overflows-right', scrollable && wrap.scrollLeft + wrap.clientWidth < wrap.scrollWidth - 1);
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
    const top = main.getBoundingClientRect().top + title.getBoundingClientRect().height;
    for (const table of content.querySelectorAll<HTMLTableElement>('.table-wrap table')) {
      const head = table.tHead;
      if (!head) continue;
      const distance = Math.max(0, Math.min(table.offsetHeight - head.offsetHeight, top - table.getBoundingClientRect().top));
      head.style.transform = `translateY(${distance}px)`;
    }
  }
  main.addEventListener('scroll', updateTableHeaders);
  return { decorateContent, highlightCodeLines, dispose: () => {
    main.removeEventListener('scroll', updateTableHeaders);
    tableObservers.forEach((observer) => observer.disconnect());
    tableObservers.clear();
  } };
}
