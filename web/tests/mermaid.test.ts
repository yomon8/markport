// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mermaid = vi.hoisted(() => ({ initialize: vi.fn(), render: vi.fn() }));
vi.mock('mermaid', () => ({ default: mermaid }));
const flush = async (): Promise<void> => { await new Promise((resolve) => setTimeout(resolve, 0)); };
const svg = (label: string): { svg: string } => ({ svg: `<svg><text>${label}</text></svg>` });
const colors = { '--surface': '#345678', '--text': '#eeeeee', '--text-muted': '#aabbcc', '--accent-soft': '#234567', '--sidebar': '#456789' };
const common = {
  securityLevel: 'strict', startOnLoad: false, fontFamily: '"Noto Sans JP", sans-serif', fontSize: 16, look: 'classic',
  flowchart: { nodeSpacing: 48, rankSpacing: 64, padding: 16, diagramPadding: 12, curve: 'rounded' },
  gantt: { fontSize: 16, sectionFontSize: 16 },
};

beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks(); localStorage.clear();
  document.body.innerHTML = '<article><div data-mermaid="true">flowchart LR; A --> B</div></article>';
  document.documentElement.removeAttribute('style');
  document.documentElement.style.fontFamily = common.fontFamily;
  for (const [name, value] of Object.entries(colors)) document.documentElement.style.setProperty(name, value);
  mermaid.render.mockResolvedValue(svg('diagram'));
});
afterEach(() => { vi.restoreAllMocks(); Reflect.deleteProperty(navigator, 'clipboard'); });
const container = (): HTMLElement => document.querySelector('article')!;

describe('Mermaid themes', () => {
  it('copies the definition during loading, after redraw, and after a render failure', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    const { drawMermaid } = await import('../src/mermaid');
    const drawing = drawMermaid(container(), () => true);
    const copy = (): HTMLButtonElement => container().querySelector<HTMLButtonElement>('button[aria-label="Copy"]')!;
    copy().click(); await drawing;
    expect(writeText).toHaveBeenLastCalledWith('flowchart LR; A --> B');
    await drawMermaid(container(), () => true);
    expect(container().querySelectorAll('.diagram-actions')).toHaveLength(1);
    copy().click(); await flush(); expect(writeText).toHaveBeenLastCalledWith('flowchart LR; A --> B');
    mermaid.render.mockRejectedValueOnce(new Error('bad source'));
    await drawMermaid(container(), () => true);
    copy().click(); await flush(); expect(writeText).toHaveBeenLastCalledWith('flowchart LR; A --> B');
    expect(container().textContent).toContain('Cannot display diagram');
  });

  it('does not add Copy controls to print rendering', async () => {
    const { drawMermaid } = await import('../src/mermaid');
    await drawMermaid(container(), () => true, undefined, true);
    expect(container().querySelectorAll('button')).toHaveLength(0);
  });
  it('prints in a neutral theme despite display theme changes and restores the display config on the next render', async () => {
    localStorage.setItem('markport-theme', 'dark');
    const { drawMermaid } = await import('../src/mermaid');
    let done!: (value: { svg: string }) => void;
    mermaid.render.mockImplementationOnce(() => new Promise((resolve) => { done = resolve; }));
    const printed = drawMermaid(container(), () => true, undefined, true); await flush();
    expect(mermaid.initialize).toHaveBeenLastCalledWith({ ...common, theme: 'neutral', themeVariables: { fontFamily: common.fontFamily, fontSize: '16px' } });
    localStorage.setItem('markport-theme', 'light'); done(svg('print')); await printed;
    expect(container().textContent).toContain('print');
    localStorage.setItem('markport-theme', 'dark'); await drawMermaid(container(), () => true);
    expect(mermaid.initialize).toHaveBeenLastCalledWith(expect.objectContaining({ ...common, theme: 'base', themeVariables: expect.objectContaining({ darkMode: true }) }));
  });
  it.each(['light', 'dark', 'sepia', 'nord', 'catppuccin-mocha', 'solarized-light', 'rose-pine-dawn', 'tokyo-night', 'tokyo-night-light'])('uses readable shared typography and CSS colors for %s', async (theme) => {
    localStorage.setItem('markport-theme', theme);
    const { drawMermaid } = await import('../src/mermaid');
    await drawMermaid(container(), () => true);
    expect(mermaid.initialize).toHaveBeenCalledWith(expect.objectContaining({
      ...common, theme: 'base', themeVariables: expect.objectContaining({
        fontFamily: common.fontFamily, fontSize: '16px',
        darkMode: ['dark', 'nord', 'catppuccin-mocha', 'tokyo-night'].includes(theme),
        background: colors['--surface'], primaryColor: colors['--accent-soft'], primaryTextColor: colors['--text'],
        primaryBorderColor: colors['--text-muted'], lineColor: colors['--text-muted'],
        clusterBkg: colors['--sidebar'], edgeLabelBackground: colors['--surface'],
        actorBkg: colors['--accent-soft'], actorTextColor: colors['--text'], signalTextColor: colors['--text'],
        noteBkgColor: colors['--sidebar'], noteTextColor: colors['--text'],
        pieStrokeColor: colors['--text-muted'], pieOuterStrokeColor: colors['--text-muted'], pieSectionTextColor: colors['--text'],
      }),
    }));
  });

  it('uses the printable document font without taking its colors from the screen', async () => {
    localStorage.setItem('markport-theme', 'dark');
    const frame = document.createElement('iframe'); document.body.append(frame);
    const doc = frame.contentDocument!;
    doc.documentElement.style.fontFamily = 'serif';
    doc.body.innerHTML = '<article><div data-mermaid="true">flowchart LR; A --> B</div></article>';
    const { drawMermaid } = await import('../src/mermaid');
    await drawMermaid(doc.querySelector('article')!, () => true, undefined, true);
    expect(mermaid.initialize).toHaveBeenLastCalledWith({ ...common, fontFamily: 'serif', theme: 'neutral', themeVariables: { fontFamily: 'serif', fontSize: '16px' } });
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
        darkMode: theme === 'nord', background: '#345678', primaryColor: '#234567', primaryTextColor: '#eeeeee', primaryBorderColor: '#aabbcc', lineColor: '#aabbcc',
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
    expect(container().querySelector('.diagram-image svg')).toBeNull();
    await Promise.all([second, third]);
    expect(mermaid.render).toHaveBeenCalledTimes(2); expect(container().textContent).toContain('diagram'); expect(container().textContent).not.toContain('stale');
  });

  it('discards a render after navigation and allows subsequent renders after errors', async () => {
    let current = true;
    mermaid.render.mockImplementationOnce(async () => { current = false; return svg('old file'); });
    const { drawMermaid } = await import('../src/mermaid');
    await drawMermaid(container(), () => current); expect(container().querySelector('.diagram-image svg')).toBeNull();
    mermaid.render.mockRejectedValueOnce(new Error('invalid diagram'));
    await drawMermaid(container(), () => true); expect(container().textContent).toContain('Cannot display diagram');
    await drawMermaid(container(), () => true); expect(container().querySelector('.diagram-image svg')).not.toBeNull();
  });
});
