// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { createOutline } from '../src/outline';

afterEach(() => { document.body.replaceChildren(); vi.unstubAllGlobals(); });

it('builds independent pane outlines and releases its heading observer', () => {
  document.body.innerHTML = '<main><article><h1 id="a">A</h1><h2 id="b">B</h2><h3 id="c">C</h3></article><nav></nav></main><aside><article><h1 id="r">Right</h1></article><nav></nav><button></button></aside>';
  const observe = vi.fn(); const disconnect = vi.fn();
  vi.stubGlobal('IntersectionObserver', class {
    observe = observe;
    disconnect = disconnect;
  });
  const content = document.querySelector('main article') as HTMLElement;
  const outline = document.querySelector('main nav') as HTMLElement;
  const rightOutline = document.querySelector('aside nav') as HTMLElement;
  const rightContents = document.querySelector('button')!;
  const controller = createOutline({
    content, outline, main: document.querySelector('main')!,
    rightContent: document.querySelector('aside article') as HTMLElement,
    rightOutline, rightContents,
  });
  controller.updateOutline(); controller.updateRightOutline();
  expect(outline.hidden).toBe(false);
  expect([...outline.querySelectorAll('a')].map((link) => link.textContent)).toEqual(['A', 'B', 'C']);
  expect(observe).toHaveBeenCalledTimes(3);
  expect(rightOutline.hidden).toBe(true); expect(rightContents.hidden).toBe(true);
  const scroll = vi.fn(); content.querySelector('h2')!.scrollIntoView = scroll;
  outline.querySelectorAll('a')[1].click();
  expect(location.hash).toBe('#b'); expect(scroll).toHaveBeenCalledOnce();
  controller.clear();
  expect(outline.hidden).toBe(true); expect(outline.children).toHaveLength(0);
  expect(disconnect).toHaveBeenCalledOnce();
  controller.dispose(); expect(disconnect).toHaveBeenCalledTimes(2);
});
