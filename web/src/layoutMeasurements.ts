/** Prepare every table before reading layout, then restore every temporary style. */
export function measureNaturalTableWidths(frames: HTMLElement[]): { frame: HTMLElement; width: number }[] {
  const tables = frames.map((frame) => {
    const table = frame.querySelector<HTMLTableElement>('.table-wrap table')!;
    return { frame, table, previous: table.style.getPropertyValue('width'), priority: table.style.getPropertyPriority('width') };
  });
  for (const { table } of tables) table.style.setProperty('width', 'max-content');
  try {
    return tables.map(({ frame, table }) => ({ frame, width: table.offsetWidth }));
  } finally {
    for (const { table, previous, priority } of tables) {
      if (previous) table.style.setProperty('width', previous, priority);
      else table.style.removeProperty('width');
    }
  }
}
