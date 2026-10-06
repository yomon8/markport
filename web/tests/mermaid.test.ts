// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mermaid = vi.hoisted(() => ({ initialize: vi.fn(), render: vi.fn() }));
vi.mock('mermaid', () => ({ default: mermaid }));
const flush = async (): Promise<void> => { await new Promise((resolve) => setTimeout(resolve, 0)); };
const svg = (label: string): { svg: string } => ({ svg: `<svg><text>${label}</text></svg>` });

beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks(); localStorage.clear();
  document.body.innerHTML = '<article><div data-mermaid="true">flowchart LR; A --> B</div></article>';
  document.documentElement.removeAttribute('style');
  mermaid.render.mockResolvedValue(svg('diagram'));
});
afterEach(() => { vi.restoreAllMocks(); });
const container = (): HTMLElement => document.querySelector('article')!;

describe('Mermaid themes', () => {
  it('prints in a neutral theme despite display theme changes and restores the display config on the next render', async () => {
    localStorage.setItem('markport-theme', 'dark');
    const { drawMermaid } = await import('../src/mermaid');
    let done!: (value: { svg: string }) => void;
    mermaid.render.mockImplementationOnce(() => new Promise((resolve) => { done = resolve; }));
    const printed = drawMermaid(container(), () => true, undefined, true); await flush();
    expect(mermaid.initialize).toHaveBeenLastCalledWith({ securityLevel: 'strict', startOnLoad: false, theme: 'neutral' });
    localStorage.setItem('markport-theme', 'light'); done(svg('print')); await printed;
    expect(container().textContent).toContain('print');
    localStorage.setItem('markport-theme', 'dark'); await drawMermaid(container(), () => true);
    expect(mermaid.initialize).toHaveBeenLastCalledWith({ securityLevel: 'strict', startOnLoad: false, theme: 'dark' });
  });
  it.each(['light', 'dark'])('preserves the existing %s configuration', async (theme) => {
    localStorage.setItem('markport-theme', theme);
    const { drawMermaid } = await import('../src/mermaid');
    await drawMermaid(container(), () => true);
    expect(mermaid.initialize).toHaveBeenCalledWith({ securityLevel: 'strict', startOnLoad: false, theme: theme === 'dark' ? 'dark' : 'neutral' });
  });

  it.each(['sepia', 'nord'])('uses CSS colors for %s and preserves the source toggle when redrawing', async (theme) => {
    localStorage.setItem('markport-theme', theme);
    for (const [name, value] of Object.entries({ '--code-bg': '#123456', '--text': '#eeeeee', '--accent-soft': '#234567', '--accent': '#abcdef', '--surface': '#345678', '--sidebar': '#456789' })) {
      document.documentElement.style.setProperty(name, value);
    }
    const { drawMermaid } = await import('../src/mermaid');
    await drawMermaid(container(), () => true);
    expect(mermaid.initialize).toHaveBeenLastCalledWith(expect.objectContaining({
      theme: 'base', securityLevel: 'strict', themeVariables: expect.objectContaining({
        darkMode: theme === 'nord', background: '#123456', primaryColor: '#234567', primaryTextColor: '#eeeeee', primaryBorderColor: '#abcdef', lineColor: '#abcdef',
      }),
    }));
    const element = container().firstElementChild as HTMLElement;
    const button = element.querySelector('button');
    const source = document.createElement('pre'); source.className = 'diagram-source'; source.textContent = element.dataset.source!; element.append(source);
    mermaid.render.mockResolvedValue(svg('updated'));
    await drawMermaid(container(), () => true);
    expect(element.querySelector('button')).toBe(button); expect(element.querySelector('.diagram-source')).toBe(source);
    expect(mermaid.render).toHaveBeenLastCalledWith(expect.any(String), 'flowchart LR; A --> B');
  });

  it('serializes renders and discards stale results even when returning to the original theme', async () => {
    localStorage.setItem('markport-theme', 'sepia');
    let finish!: (result: { svg: string }) => void;
    mermaid.render.mockImplementationOnce(() => new Promise<{ svg: string }>((resolve) => { finish = resolve; }));
    const { drawMermaid } = await import('../src/mermaid');
    const first = drawMermaid(container(), () => true); await flush();
    localStorage.setItem('markport-theme', 'nord'); const second = drawMermaid(container(), () => true);
    localStorage.setItem('markport-theme', 'sepia'); const third = drawMermaid(container(), () => true);
    expect(mermaid.render).toHaveBeenCalledTimes(1);
    finish(svg('stale')); await first;
    expect(container().querySelector('svg')).toBeNull();
    await Promise.all([second, third]);
    expect(mermaid.render).toHaveBeenCalledTimes(2); expect(container().textContent).toContain('diagram'); expect(container().textContent).not.toContain('stale');
  });

  it('discards a render after navigation and allows subsequent renders after errors', async () => {
    let current = true;
    mermaid.render.mockImplementationOnce(async () => { current = false; return svg('old file'); });
    const { drawMermaid } = await import('../src/mermaid');
    await drawMermaid(container(), () => current); expect(container().querySelector('svg')).toBeNull();
    mermaid.render.mockRejectedValueOnce(new Error('invalid diagram'));
    await drawMermaid(container(), () => true); expect(container().textContent).toContain('Cannot display diagram');
    await drawMermaid(container(), () => true); expect(container().querySelector('svg')).not.toBeNull();
  });
});
