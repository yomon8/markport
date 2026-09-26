import { shortcuts, shortcutText } from './shortcuts';

export function createShortcutHelp(button: HTMLButtonElement): { open: () => void; close: () => void } {
  const dialog = document.createElement('dialog'); dialog.id = 'shortcuts-dialog'; dialog.setAttribute('aria-labelledby', 'shortcuts-heading');
  const heading = document.createElement('h2'); heading.id = 'shortcuts-heading'; heading.textContent = 'Keyboard shortcuts';
  const closeButton = document.createElement('button'); closeButton.type = 'button'; closeButton.textContent = 'Close';
  closeButton.addEventListener('click', () => dialog.close());
  dialog.append(heading, closeButton);
  for (const group of [...new Set(shortcuts.map((shortcut) => shortcut.group))]) {
    const section = document.createElement('section');
    const title = document.createElement('h3'); title.textContent = group;
    const list = document.createElement('dl');
    for (const shortcut of shortcuts.filter((entry) => entry.group === group)) {
      const term = document.createElement('dt'); const keys = document.createElement('kbd'); keys.textContent = shortcutText(shortcut.id); term.append(keys);
      const description = document.createElement('dd'); description.textContent = shortcut.description;
      list.append(term, description);
    }
    section.append(title, list); dialog.append(section);
  }
  document.body.append(dialog);
  dialog.addEventListener('close', () => button.focus());
  button.addEventListener('click', () => { if (!dialog.open) { dialog.showModal(); closeButton.focus(); } });
  return { open: () => { if (!dialog.open) button.click(); }, close: () => { if (dialog.open) dialog.close(); } };
}
