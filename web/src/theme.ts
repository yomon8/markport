export type Theme = 'auto' | 'light' | 'dark';
const choices: Theme[] = ['auto', 'light', 'dark'];
const labels: Record<Theme, string> = { auto: 'Auto', light: 'Light', dark: 'Dark' };
const icons: Record<Theme, string> = { auto: '◐', light: '☀', dark: '☾' };

function preference(): Theme {
  const saved = localStorage.getItem('markport-theme');
  return saved === 'light' || saved === 'dark' ? saved : 'auto';
}

export function effectiveTheme(): 'light' | 'dark' {
  const selected = preference();
  return selected === 'auto' ? (typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : selected;
}

export function initTheme(button: HTMLButtonElement, redraw: () => void): void {
  const menu = document.createElement('div'); menu.id = 'theme-menu'; menu.setAttribute('role', 'menu'); menu.setAttribute('aria-label', 'Theme'); menu.hidden = true;
  button.after(menu); button.setAttribute('aria-haspopup', 'menu'); button.setAttribute('aria-expanded', 'false');
  const items = choices.map((choice) => {
    const item = document.createElement('button'); item.type = 'button'; item.setAttribute('role', 'menuitemradio');
    item.textContent = labels[choice];
    item.addEventListener('click', () => { localStorage.setItem('markport-theme', choice); apply(); redraw(); close(); });
    menu.append(item); return item;
  });
  function apply(): void {
    const selected = preference();
    document.documentElement.dataset.theme = effectiveTheme();
    button.textContent = icons[selected]; button.setAttribute('aria-label', `Theme: ${labels[selected]}`);
    button.title = `Theme: ${labels[selected]}`;
    items.forEach((item, index) => item.setAttribute('aria-checked', String(choices[index] === selected)));
  }
  function close(): void { menu.hidden = true; button.setAttribute('aria-expanded', 'false'); button.focus(); }
  function open(): void { menu.hidden = false; button.setAttribute('aria-expanded', 'true'); items[choices.indexOf(preference())].focus(); }
  button.addEventListener('click', () => menu.hidden ? open() : close());
  menu.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') { event.preventDefault(); close(); return; }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (current + (event.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length;
    items[next].focus();
  });
  document.addEventListener('pointerdown', (event) => {
    if (!menu.hidden && event.target instanceof Node && !menu.contains(event.target) && event.target !== button) { menu.hidden = true; button.setAttribute('aria-expanded', 'false'); }
  });
  if (typeof matchMedia === 'function') matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { apply(); redraw(); });
  apply();
}
