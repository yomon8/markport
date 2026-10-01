// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

beforeEach(() => { vi.resetModules(); vi.doUnmock('katex'); document.body.replaceChildren(); });
afterEach(() => { vi.doUnmock('katex'); });

function fixture(values: string[]): HTMLElement {
  const container = document.createElement('article');
  for (const value of values) {
    const element = document.createElement('span'); element.dataset.math = value.startsWith('$$') || value.startsWith('\\[') ? 'display' : 'inline'; element.textContent = value; container.append(element);
  }
  document.body.append(container); return container;
}

describe('math rendering', () => {
  it('renders actual KaTeX HTML and MathML while preserving outline text', async () => {
    const { drawMath, mathText } = await import('../src/math');
    const container = fixture(['$x_1$', '$$\\frac{1}{2}$$', '\\(x_2\\)', '\\[x_3\\]']);
    const before = mathText(container);
    await drawMath(container, () => true);
    expect(container.querySelectorAll('.katex')).toHaveLength(4);
    expect(container.querySelectorAll('math')).toHaveLength(4);
    expect(container.querySelectorAll('.katex-display')).toHaveLength(2);
    expect(mathText(container)).toBe(before);
    const math = container.querySelector('.katex');
    await drawMath(container, () => true);
    expect(container.querySelector('.katex')).toBe(math);
  });

  it('keeps failures local and does not share macro definitions', async () => {
    const { drawMath } = await import('../src/math');
    const container = fixture(['$\\gdef\\foo{X}\\foo$', '$\\foo$', '$\\frac{$', '$x$']);
    await drawMath(container, () => true);
    expect(container.querySelectorAll('.katex')).toHaveLength(2);
    expect(container.querySelectorAll('.math-error')).toHaveLength(2);
    expect(container.querySelectorAll('.math-original')[0].textContent).toBe('$\\foo$');
  });

  it('blocks resource and HTML commands and contains macro expansion', async () => {
    const { drawMath } = await import('../src/math');
    const container = fixture(['$\\href{javascript:alert(1)}{x}$', '$\\includegraphics{https://example.test/a.png}$', '$\\htmlClass{injected}{x}$', '$\\def\\foo{\\foo}\\foo$', '$<script>alert(1)</script>$']);
    await drawMath(container, () => true);
    expect(container.querySelector('a,img,script,.injected')).toBeNull();
    expect(container.querySelector('.math-error')).not.toBeNull();
  });

  it('does not load KaTeX for ordinary content', async () => {
    const load = vi.fn(() => { throw new Error('unexpected import'); }); vi.doMock('katex', load);
    const { drawMath } = await import('../src/math');
    const container = document.createElement('article'); document.body.append(container);
    await drawMath(container, () => true);
    expect(load).not.toHaveBeenCalled();
  });

  it('shows escaped source when the library fails to load', async () => {
    vi.doMock('katex', () => { throw new Error('<script>load failed</script>'); });
    const { drawMath } = await import('../src/math');
    const container = fixture(['$<script>x</script>$']);
    await drawMath(container, () => true);
    expect(container.querySelector('.math-original')?.textContent).toBe('$<script>x</script>$');
    expect(container.querySelector('.math-error')?.textContent).toBe('Cannot display formula');
    expect(container.querySelector('script')).toBeNull();
  });

  it('ignores stale views and replaced elements after deferred loading', async () => {
    let release: () => void = () => {};
    const loaded = new Promise<void>((resolve) => { release = resolve; });
    const render = vi.fn();
    vi.doMock('katex', async () => { await loaded; return { default: { render } }; });
    const { drawMath } = await import('../src/math');
    const container = fixture(['$x$']); let current = true;
    const drawing = drawMath(container, () => current);
    current = false; release(); await drawing;
    expect(render).not.toHaveBeenCalled();
    current = true; await drawMath(container, () => current);
    expect(render).toHaveBeenCalledTimes(1);
    const removed = fixture(['$y$']); removed.remove();
    await drawMath(removed, () => true);
    expect(render).toHaveBeenCalledTimes(1);
  });
});
