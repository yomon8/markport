// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { createContentDecoration } from '../src/contentDecorate';

afterEach(() => { localStorage.clear(); document.body.replaceChildren(); });

it('decorates each code block once and selects requested lines', () => {
  document.body.innerHTML = '<main><header></header><article data-kind="code"><div class="chroma"><table class="lntable"><tr><td class="lntd"><span class="lnt">1</span><span class="lnt">2</span></td><td class="lntd"><span class="line"><span class="cl">first</span></span><span class="line"><span class="cl">second</span></span></td></tr></table></div></article></main>';
  const content = document.querySelector('article')!;
  const onLineStart = vi.fn();
  const decoration = createContentDecoration({
    content, rightContent: document.createElement('article'),
    main: document.querySelector('main')!, title: document.querySelector('header')!,
    contentWidth: { decorate: vi.fn(), refresh: vi.fn() },
    tableOverlay: { open: vi.fn() },
    getPath: () => 'example.go', getRightHash: () => '', onLineStart,
  });
  decoration.decorateContent(); decoration.decorateContent();
  expect(content.querySelectorAll('.code-frame')).toHaveLength(1);
  expect(content.querySelector('.code-toolbar')?.textContent).toContain('go');
  expect(decoration.highlightCodeLines(false, content, '#L2')).toBe(true);
  expect(content.querySelectorAll('.selected-code-line')).toHaveLength(2);
  expect(onLineStart).toHaveBeenCalledWith(2);
  expect(decoration.highlightCodeLines(false, content, '#L0')).toBe(false);
  expect(content.querySelectorAll('.selected-code-line')).toHaveLength(0);
  decoration.dispose();
});

it('shares table wrapping between panes and supplies table source to copy controls', () => {
  document.body.innerHTML = '<main><header></header><article><table data-table-source="a | b"><tr><td>a</td><td>b</td></tr></table></article></main><aside><table><tr><td>right</td></tr></table></aside>';
  const content = document.querySelector('article')!;
  const rightContent = document.querySelector('aside')!;
  const open = vi.fn();
  const decoration = createContentDecoration({
    content, rightContent, main: document.querySelector('main')!,
    title: document.querySelector('header')!,
    contentWidth: { decorate: vi.fn(), refresh: vi.fn() }, tableOverlay: { open },
    getPath: () => 'example.md', getRightHash: () => '', onLineStart: vi.fn(),
  });
  decoration.decorateContent(); decoration.decorateContent(rightContent, 'other.md');
  expect(document.querySelectorAll('.table-nowrap')).toHaveLength(2);
  expect(content.querySelector('.table-frame')?.classList.contains('has-copy')).toBe(true);
  content.querySelector<HTMLButtonElement>('.table-wrap-toggle')!.click();
  expect(document.querySelectorAll('.table-nowrap')).toHaveLength(0);
  expect(rightContent.querySelector('.table-wrap-toggle')?.getAttribute('aria-pressed')).toBe('true');
  expect(localStorage.getItem('markport-wrap-tables')).toBe('true');
  const expand = rightContent.querySelector<HTMLButtonElement>('.table-expand')!;
  expand.click();
  expect(open).toHaveBeenCalledWith(rightContent.querySelector('table'), expand, false);
  decoration.dispose();
});

it('batches table sizing, measures only visible headers on scroll and cancels stale work', () => {
  const queued = new Map<number, FrameRequestCallback>(); let serial = 0;
  const flush = () => { const batch = [...queued.values()]; queued.clear(); batch.forEach((callback) => callback(0)); };
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { queued.set(++serial, callback); return serial; });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => queued.delete(id));
  const intersections: { callback: IntersectionObserverCallback; disconnect: ReturnType<typeof vi.fn> }[] = [];
  vi.stubGlobal('IntersectionObserver', class {
    disconnect = vi.fn(); observe = vi.fn(); unobserve = vi.fn();
    constructor(callback: IntersectionObserverCallback) { intersections.push({ callback, disconnect: this.disconnect }); }
  });
  document.body.innerHTML = '<main><header></header><article>' + '<table><thead><tr><th>Column</th></tr></thead><tbody><tr><td>Data</td></tr></tbody></table>'.repeat(10) + '</article></main>';
  const content = document.querySelector('article')!; const main = document.querySelector('main')!;
  const decoration = createContentDecoration({ content, rightContent: document.createElement('article'), main, title: document.querySelector('header')!, contentWidth: { decorate: vi.fn(), refresh: vi.fn() }, tableOverlay: { open: vi.fn() }, getPath: () => 'large.md', getRightHash: () => '', onLineStart: vi.fn() });
  try {
    decoration.decorateContent();
    const elements = [...content.querySelectorAll('table')];
    const bounds = elements.map((table) => vi.spyOn(table, 'getBoundingClientRect'));
    for (const table of elements) Object.defineProperty(table, 'offsetWidth', { get: () => {
      expect(elements.every((other) => other.style.width === 'max-content')).toBe(true); return 900;
    } });
    flush(); flush();
    expect(bounds.every((spy) => spy.mock.calls.length === 0)).toBe(true);
    intersections[0].callback([{ target: elements[3], isIntersecting: true }] as unknown as IntersectionObserverEntry[], {} as IntersectionObserver);
    main.dispatchEvent(new Event('scroll')); main.dispatchEvent(new Event('scroll')); flush();
    expect(bounds[3]).toHaveBeenCalledTimes(1);
    expect(bounds.filter((_, index) => index !== 3).every((spy) => spy.mock.calls.length === 0)).toBe(true);
    main.dispatchEvent(new Event('scroll'));
    decoration.decorateContent();
    expect(intersections[0].disconnect).toHaveBeenCalledOnce();
    decoration.dispose(); expect(queued.size).toBe(0);
    expect(intersections[1].disconnect).toHaveBeenCalledOnce();
  } finally { decoration.dispose(); vi.restoreAllMocks(); vi.unstubAllGlobals(); }
});
