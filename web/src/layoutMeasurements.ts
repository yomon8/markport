type Block = { element: HTMLElement; width: number };

/** Prepare every block before reading layout, then restore every temporary style. */
export function measureNaturalWidths(elements: HTMLElement[]): Block[] {
  const blocks = elements.map((element) => {
    const table = element.querySelector<HTMLTableElement>('.table-wrap table');
    const code = element.matches('.code-frame') ? element : element.querySelector<HTMLElement>('.code-frame');
    const scroller = code?.querySelector<HTMLElement>(':scope > .chroma, pre');
    return { element, table, code, scroller, previous: table?.style.getPropertyValue('width'), priority: table?.style.getPropertyPriority('width'), wrapped: code?.classList.contains('wrapped'), width: 0 };
  });
  for (const block of blocks) {
    if (block.table) block.table.style.setProperty('width', 'max-content');
    else if (block.scroller) block.code!.classList.remove('wrapped');
  }
  try {
    for (const block of blocks) {
      if (block.table) block.width = block.table.offsetWidth;
      else if (block.scroller) block.width = block.scroller.scrollWidth + Math.max(0, block.code!.clientWidth - block.scroller.clientWidth);
      else {
        const svg = block.element.querySelector<SVGSVGElement>('.diagram-image svg');
        if (svg) block.width = parseFloat(svg.style.maxWidth) || svg.viewBox?.baseVal.width || svg.getBoundingClientRect().width;
      }
    }
  } finally {
    for (const block of blocks) {
      if (block.table) {
        if (block.previous) block.table.style.setProperty('width', block.previous, block.priority);
        else block.table.style.removeProperty('width');
      } else if (block.scroller) block.code!.classList.toggle('wrapped', block.wrapped!);
    }
  }
  return blocks;
}
