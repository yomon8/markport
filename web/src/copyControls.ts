import { copyText } from './clipboard';
import { setIcon, type IconName } from './icons';
import { announceToolResult, createToolButton, toolFeedback } from './toolButtons';

type CopyState = { icon?: IconName; timer?: ReturnType<typeof setTimeout> };
const copyStates = new WeakMap<HTMLButtonElement, CopyState>();
export function resetCopyButton(button: HTMLButtonElement, label = 'Copy'): void {
  const state = copyStates.get(button);
  clearTimeout(state?.timer);
  const icon = state?.icon ?? button.dataset.icon as IconName | undefined;
  copyStates.set(button, { icon });
  if (button.classList.contains('tool-icon')) {
    setIcon(button, icon ?? 'copy'); toolFeedback(button);
  } else if (button.classList.contains('title-icon')) {
    setIcon(button, icon ?? 'copy'); button.title = label;
  } else button.textContent = label;
}
export function copyWithFeedback(button: HTMLButtonElement, text: string, label: string): void {
  const previous = copyStates.get(button);
  clearTimeout(previous?.timer);
  const state: CopyState = { icon: previous?.icon ?? button.dataset.icon as IconName | undefined };
  copyStates.set(button, state);
  void copyText(text).then((copied) => {
    if (copyStates.get(button) !== state || !button.isConnected) return;
    const tool = button.classList.contains('tool-icon');
    const iconic = tool || button.classList.contains('title-icon');
    const message = copied ? 'Copied' : 'Copy failed';
    if (iconic) {
      setIcon(button, copied ? 'check' : 'close');
      if (tool) { toolFeedback(button, message); announceToolResult(button, message); }
      else button.title = message;
    } else button.textContent = message;
    state.timer = setTimeout(() => resetCopyButton(button, label), 2000);
  });
}
export function createCopyButton(source: () => string): HTMLButtonElement {
  const button = createToolButton('copy', 'Copy'); button.classList.add('component-copy');
  button.addEventListener('click', () => copyWithFeedback(button, source(), 'Copy'));
  return button;
}
