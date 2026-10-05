import { setIcon, type IconName } from './icons';

export type ThemeId = 'light' | 'dark' | 'sepia' | 'nord' | 'catppuccin-mocha' | 'solarized-light' | 'rose-pine-dawn' | 'tokyo-night' | 'tokyo-night-light';
export type Theme = 'auto' | ThemeId;
export type ColorScheme = 'light' | 'dark';

const themes: { id: Theme; label: string; scheme?: ColorScheme; icon: IconName }[] = [
  { id: 'auto', label: 'Auto', icon: 'auto' },
  { id: 'light', label: 'Light', scheme: 'light', icon: 'sun' },
  { id: 'dark', label: 'Dark', scheme: 'dark', icon: 'moon' },
  { id: 'sepia', label: 'Sepia', scheme: 'light', icon: 'sun' },
  { id: 'nord', label: 'Nord', scheme: 'dark', icon: 'moon' },
  { id: 'catppuccin-mocha', label: 'Catppuccin Mocha', scheme: 'dark', icon: 'moon' },
  { id: 'solarized-light', label: 'Solarized Light', scheme: 'light', icon: 'sun' },
  { id: 'rose-pine-dawn', label: 'Rosé Pine Dawn', scheme: 'light', icon: 'sun' },
  { id: 'tokyo-night', label: 'Tokyo Night', scheme: 'dark', icon: 'moon' },
  { id: 'tokyo-night-light', label: 'Tokyo Night Light', scheme: 'light', icon: 'sun' },
];
let sessionPreference: Theme | undefined;

function preference(): Theme {
  if (sessionPreference !== undefined) return sessionPreference;
  try {
    const saved = localStorage.getItem('markport-theme');
    return themes.find((theme) => theme.id === saved)?.id ?? 'auto';
  } catch {
    return 'auto';
  }
}

export function effectiveThemeId(): ThemeId {
  const selected = preference();
  return selected === 'auto' ? (typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : selected;
}

export function effectiveTheme(): ColorScheme {
  return themes.find((theme) => theme.id === effectiveThemeId())!.scheme!;
}

export function initTheme(button: HTMLButtonElement, redraw: () => void): void {
  const media = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : undefined;
  const menu = document.createElement('div'); menu.id = 'theme-menu'; menu.setAttribute('role', 'menu'); menu.setAttribute('aria-label', 'Theme'); menu.hidden = true;
  button.after(menu); button.setAttribute('aria-haspopup', 'menu'); button.setAttribute('aria-controls', menu.id); button.setAttribute('aria-expanded', 'false');
  const items = themes.map((theme) => {
    const item = document.createElement('button'); item.type = 'button'; item.setAttribute('role', 'menuitemradio');
    item.textContent = theme.label;
    item.addEventListener('click', () => {
      try { localStorage.setItem('markport-theme', theme.id); sessionPreference = undefined; }
      catch { sessionPreference = theme.id; }
      const changed = apply();
      if (changed) redraw();
      close();
    });
    menu.append(item); return item;
  });
  function apply(): boolean {
    const selected = preference();
    const theme = themes.find((theme) => theme.id === selected)!;
    const id = effectiveThemeId();
    const changed = document.documentElement.dataset.theme !== id;
    document.documentElement.dataset.theme = id;
    document.documentElement.dataset.colorScheme = effectiveTheme();
    setIcon(button, theme.icon); button.setAttribute('aria-label', `Theme: ${theme.label}`);
    button.title = `Theme: ${theme.label}`;
    items.forEach((item, index) => item.setAttribute('aria-checked', String(themes[index].id === selected)));
    return changed;
  }
  function close(): void { menu.hidden = true; button.setAttribute('aria-expanded', 'false'); button.focus(); }
  function open(): void { menu.hidden = false; button.setAttribute('aria-expanded', 'true'); items[themes.findIndex((theme) => theme.id === preference())].focus(); }
  button.addEventListener('click', () => menu.hidden ? open() : close());
  menu.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); return; }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (current + (event.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length;
    items[next].focus();
  });
  const dismiss = (event: PointerEvent): void => {
    if (!menu.hidden && event.target instanceof Node && !menu.contains(event.target) && !button.contains(event.target)) { menu.hidden = true; button.setAttribute('aria-expanded', 'false'); }
  };
  const systemChanged = (): void => { if (preference() === 'auto' && apply()) redraw(); };
  document.addEventListener('pointerdown', dismiss);
  media?.addEventListener('change', systemChanged);
  window.addEventListener('pagehide', () => {
    document.removeEventListener('pointerdown', dismiss);
    media?.removeEventListener('change', systemChanged);
  }, { once: true });
  apply();
}
