export type Theme = 'auto' | 'light' | 'dark';
const choices: Theme[] = ['auto', 'light', 'dark'];
export function effectiveTheme(): 'light' | 'dark' {
  const preference = (localStorage.getItem('markport-theme') ?? 'auto') as Theme;
  return preference === 'auto' ? (typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : preference;
}
export function initTheme(button: HTMLButtonElement, redraw: () => void): void {
  function apply(): void {
    const preference = (localStorage.getItem('markport-theme') ?? 'auto') as Theme;
    document.documentElement.dataset.theme = effectiveTheme();
    button.textContent = `テーマ: ${{ auto: '自動', light: 'ライト', dark: 'ダーク' }[preference]}`;
    button.title = 'テーマを切り替える';
  }
  button.addEventListener('click', () => {
    const current = (localStorage.getItem('markport-theme') ?? 'auto') as Theme;
    localStorage.setItem('markport-theme', choices[(choices.indexOf(current) + 1) % choices.length]);
    apply(); redraw();
  });
  if (typeof matchMedia === 'function') matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { apply(); redraw(); });
  apply();
}
