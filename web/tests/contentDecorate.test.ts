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
