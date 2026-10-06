import { copyText } from './clipboard';
import { setIcon, type IconName } from './icons';

const copyTimers = new WeakMap<HTMLButtonElement, ReturnType<typeof setTimeout>>();
export function copyWithFeedback(button: HTMLButtonElement, text: string, label: string): void {
  void copyText(text).then((copied) => {
    clearTimeout(copyTimers.get(button));
    const iconic = button.classList.contains('title-icon');
    const restore = button.dataset.icon as IconName | undefined;
    if (iconic) { setIcon(button, copied ? 'check' : 'close'); button.title = copied ? 'Copied' : 'Copy failed'; }
    else button.textContent = copied ? 'Copied' : 'Copy failed';
    copyTimers.set(button, setTimeout(() => {
      if (iconic) { setIcon(button, restore ?? 'copy'); button.title = label; } else button.textContent = label;
      copyTimers.delete(button);
    }, 2000));
  });
}
export function createCopyButton(source: () => string): HTMLButtonElement {
  const button = document.createElement('button'); button.type = 'button'; button.className = 'component-copy'; button.textContent = 'Copy';
  button.addEventListener('click', () => copyWithFeedback(button, source(), 'Copy'));
  return button;
}
