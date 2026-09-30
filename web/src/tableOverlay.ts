export function createTableOverlay(): { open: (source: HTMLTableElement, opener: HTMLButtonElement, nowrap: boolean) => void; close: () => void } {
  document.querySelector('#table-overlay')?.remove();
  const dialog = document.createElement('dialog'); dialog.id = 'table-overlay'; dialog.setAttribute('aria-label', 'Expanded table');
  dialog.innerHTML = '<div class="overlay-toolbar"><button type="button" id="table-overlay-close">Close ×</button></div><div id="table-overlay-viewport" tabindex="0" role="region" aria-label="Table"><article></article></div>';
  document.body.append(dialog);
  const content = dialog.querySelector<HTMLElement>('article')!;
  let opener: HTMLButtonElement | undefined;
  let source: HTMLTableElement | undefined;
  dialog.querySelector<HTMLButtonElement>('#table-overlay-close')!.addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => { if (opener?.isConnected) opener.focus(); opener = undefined; source = undefined; content.replaceChildren(); });
  // Forward link clicks to the original table so in-app navigation keeps working.
  content.addEventListener('click', (event) => {
    const link = (event.target as Element).closest<HTMLAnchorElement>('a[href]');
    if (!link || !source || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const original = source.querySelectorAll<HTMLAnchorElement>('a[href]')[[...content.querySelectorAll('a[href]')].indexOf(link)];
    if (!original) return;
    event.preventDefault(); dialog.close(); original.click();
  });
  return {
    open(table, button, nowrap) {
      opener = button; source = table;
      const clone = table.cloneNode(true) as HTMLTableElement;
      clone.tHead?.style.removeProperty('transform');
      content.classList.toggle('table-nowrap', nowrap); content.replaceChildren(clone);
      dialog.showModal(); dialog.querySelector<HTMLButtonElement>('#table-overlay-close')!.focus();
    },
    close() { if (dialog.open) dialog.close(); },
  };
}
