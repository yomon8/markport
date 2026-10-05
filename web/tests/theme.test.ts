// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let dark: boolean;
let media: EventTarget;

beforeEach(() => {
  vi.resetModules(); localStorage.clear();
  document.body.innerHTML = '<button id="theme"></button>';
  delete document.documentElement.dataset.theme; delete document.documentElement.dataset.colorScheme;
  dark = false; media = new EventTarget();
  Object.defineProperty(media, 'matches', { get: () => dark });
  vi.stubGlobal('matchMedia', vi.fn(() => media));
});
afterEach(() => { window.dispatchEvent(new Event('pagehide')); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

async function setup(): Promise<{ button: HTMLButtonElement; redraw: ReturnType<typeof vi.fn> }> {
  const { initTheme } = await import('../src/theme');
  const button = document.querySelector<HTMLButtonElement>('#theme')!;
  const redraw = vi.fn(); initTheme(button, redraw);
  return { button, redraw };
}
function select(label: string): void {
  [...document.querySelectorAll<HTMLButtonElement>('#theme-menu button')].find((button) => button.textContent === label)!.click();
}

describe('theme preferences', () => {
  it.each([
    ['light', 'light', 'light'], ['dark', 'dark', 'dark'], ['sepia', 'sepia', 'light'], ['nord', 'nord', 'dark'],
    ['catppuccin-mocha', 'catppuccin-mocha', 'dark'], ['solarized-light', 'solarized-light', 'light'],
    ['rose-pine-dawn', 'rose-pine-dawn', 'light'], ['tokyo-night', 'tokyo-night', 'dark'],
    ['tokyo-night-light', 'tokyo-night-light', 'light'],
    ['auto', 'light', 'light'], ['unknown', 'light', 'light'], ['', 'light', 'light'],
  ])('restores %s as %s / %s', async (saved, id, scheme) => {
    if (saved) localStorage.setItem('markport-theme', saved);
    await setup();
    const { effectiveTheme, effectiveThemeId } = await import('../src/theme');
    expect(effectiveThemeId()).toBe(id); expect(effectiveTheme()).toBe(scheme);
    expect(document.documentElement.dataset.theme).toBe(id);
    expect(document.documentElement.dataset.colorScheme).toBe(scheme);
  });

  it.each([
    ['Catppuccin Mocha', 'catppuccin-mocha', 'dark'], ['Solarized Light', 'solarized-light', 'light'],
    ['Rosé Pine Dawn', 'rose-pine-dawn', 'light'], ['Tokyo Night', 'tokyo-night', 'dark'], ['Tokyo Night Light', 'tokyo-night-light', 'light'],
  ])('selects %s and ignores later OS changes', async (label, id, scheme) => {
    const { button, redraw } = await setup(); select(label);
    expect(localStorage.getItem('markport-theme')).toBe(id);
    expect(button.getAttribute('aria-label')).toBe(`Theme: ${label}`);
    expect(document.documentElement.dataset.colorScheme).toBe(scheme);
    dark = true; media.dispatchEvent(new Event('change'));
    expect(document.documentElement.dataset.theme).toBe(id);
    expect(redraw).toHaveBeenCalledTimes(1);
    select(label); expect(redraw).toHaveBeenCalledTimes(1);
  });

  it('tracks OS changes only for Auto and redraws only when the effective theme changes', async () => {
    const { redraw } = await setup();
    dark = true; media.dispatchEvent(new Event('change'));
    expect(document.documentElement.dataset.theme).toBe('dark'); expect(redraw).toHaveBeenCalledTimes(1);
    select('Nord'); expect(redraw).toHaveBeenCalledTimes(2);
    dark = false; media.dispatchEvent(new Event('change'));
    expect(document.documentElement.dataset.theme).toBe('nord'); expect(redraw).toHaveBeenCalledTimes(2);
    select('Nord'); expect(redraw).toHaveBeenCalledTimes(2);
    select('Auto'); expect(document.documentElement.dataset.theme).toBe('light'); expect(redraw).toHaveBeenCalledTimes(3);
  });

  it('keeps a selection in memory when storage is unavailable or full', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    const save = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    await setup(); select('Sepia');
    const { effectiveThemeId } = await import('../src/theme');
    expect(effectiveThemeId()).toBe('sepia');
    dark = true; media.dispatchEvent(new Event('change'));
    expect(effectiveThemeId()).toBe('sepia');
    select('Nord'); expect(effectiveThemeId()).toBe('nord'); expect(save).toHaveBeenCalledWith('markport-theme', 'nord');
  });

  it('offers all ten choices and supports keyboard navigation, selection, and Escape', async () => {
    const { button } = await setup(); button.click();
    const items = [...document.querySelectorAll<HTMLButtonElement>('#theme-menu button')];
    expect(items.map((item) => item.textContent)).toEqual(['Auto', 'Light', 'Dark', 'Sepia', 'Nord', 'Catppuccin Mocha', 'Solarized Light', 'Rosé Pine Dawn', 'Tokyo Night', 'Tokyo Night Light']);
    expect(document.activeElement).toBe(items[0]);
    const key = (key: string): void => { document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true })); };
    key('End'); expect(document.activeElement).toBe(items[9]);
    key('ArrowDown'); expect(document.activeElement).toBe(items[0]);
    key('ArrowUp'); expect(document.activeElement).toBe(items[9]);
    key('Home'); key('ArrowDown'); expect(document.activeElement).toBe(items[1]);
    items[3].click();
    expect(items[3].getAttribute('aria-checked')).toBe('true');
    expect(localStorage.getItem('markport-theme')).toBe('sepia');
    expect(button.getAttribute('aria-label')).toBe('Theme: Sepia'); expect(document.activeElement).toBe(button);
    button.click(); expect(document.activeElement).toBe(items[3]); key('Escape');
    expect(document.querySelector<HTMLElement>('#theme-menu')!.hidden).toBe(true); expect(document.activeElement).toBe(button);
  });
});
