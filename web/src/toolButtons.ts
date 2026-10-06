import { setIcon, type IconName } from './icons';

type Tooltip = { refresh: (reveal?: boolean) => void };
const tooltips = new WeakMap<HTMLButtonElement, Tooltip>();
let serial = 0;

export function setToolButton(button: HTMLButtonElement, icon: IconName, label: string): void {
  button.classList.add('tool-icon');
  button.setAttribute('aria-label', label);
  button.dataset.tooltip = label;
  setIcon(button, icon);
  if (!tooltips.has(button)) attachTooltip(button);
  tooltips.get(button)!.refresh();
}

export function createToolButton(icon: IconName, label: string): HTMLButtonElement {
  const button = document.createElement('button'); button.type = 'button';
  setToolButton(button, icon, label);
  return button;
}

export function toolFeedback(button: HTMLButtonElement, message?: string): void {
  if (message) button.dataset.feedback = message;
  else delete button.dataset.feedback;
  tooltips.get(button)?.refresh(!!message);
}

function attachTooltip(button: HTMLButtonElement): void {
  let hovered = false; let focused = false; let dismissed = false;
  let tooltip: HTMLDivElement | undefined;
  let observer: MutationObserver | undefined;
  const hide = (): void => {
    tooltip?.remove(); tooltip = undefined;
    button.removeAttribute('aria-describedby');
    window.removeEventListener('resize', reposition);
    document.removeEventListener('scroll', reposition, true);
    document.removeEventListener('keydown', escape, true);
    observer?.disconnect(); observer = undefined;
  };
  const position = (): void => {
    if (!tooltip) return;
    const rect = button.getBoundingClientRect(); const box = tooltip.getBoundingClientRect();
    const left = Math.max(8, Math.min(rect.right - box.width, window.innerWidth - box.width - 8));
    const top = rect.bottom + box.height + 8 <= window.innerHeight ? rect.bottom + 6 : Math.max(8, rect.top - box.height - 6);
    tooltip.style.left = `${left}px`; tooltip.style.top = `${top}px`;
  };
  const reposition = (): void => {
    const rect = button.getBoundingClientRect();
    if (!button.isConnected || rect.bottom < 0 || rect.top > window.innerHeight || rect.right < 0 || rect.left > window.innerWidth) hide();
    else position();
  };
  const refresh = (reveal = false): void => {
    if (reveal) dismissed = false;
    if (!button.isConnected || button.closest('dialog')?.open === false || dismissed || (!hovered && !focused && !button.dataset.feedback)) { hide(); return; }
    if (!tooltip) {
      tooltip = document.createElement('div'); tooltip.className = 'tool-tooltip';
      tooltip.id = `tool-tooltip-${++serial}`; tooltip.setAttribute('role', 'tooltip');
      tooltip.setAttribute('popover', 'manual');
      (button.closest('dialog') ?? document.body).append(tooltip);
      tooltip.showPopover?.();
      button.setAttribute('aria-describedby', tooltip.id);
      tooltip.addEventListener('mouseenter', () => { hovered = true; });
      tooltip.addEventListener('mouseleave', () => { hovered = false; refresh(); });
      window.addEventListener('resize', reposition);
      document.addEventListener('scroll', reposition, true);
      document.addEventListener('keydown', escape, true);
      observer = new MutationObserver(() => { if (!button.isConnected || button.closest('dialog')?.open === false) hide(); });
      observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['open'] });
    }
    tooltip.textContent = button.dataset.feedback ?? button.dataset.tooltip ?? '';
    position();
  };
  const escape = (event: KeyboardEvent): void => { if (event.key === 'Escape') { dismissed = true; hide(); } };
  button.addEventListener('mouseenter', () => { hovered = true; dismissed = false; refresh(); });
  button.addEventListener('mouseleave', (event) => {
    if (event.relatedTarget === tooltip) return;
    hovered = false; refresh();
  });
  button.addEventListener('focus', () => { focused = true; dismissed = false; refresh(); });
  button.addEventListener('blur', () => { focused = false; refresh(); });
  tooltips.set(button, { refresh });
}

export function announceToolResult(button: HTMLButtonElement, message: string): void {
  const root = button.closest('dialog') ?? document.body;
  let status = root.querySelector<HTMLElement>(':scope > .tool-status');
  if (!status) {
    status = document.createElement('span'); status.className = 'tool-status';
    status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite'); root.append(status);
  }
  // Populate after the live region is mounted so its first result is announced too.
  const region = status;
  setTimeout(() => { region.replaceChildren(document.createTextNode(message)); }, 0);
}
