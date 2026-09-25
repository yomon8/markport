export type Node = { name: string; path: string; type: 'directory' | 'file' };
export type Page = { entries: Node[]; offset: number; nextOffset: number | null; revision: string; root: string; readme?: string };
type Directory = { pages: Map<number, Node[]>; next: Map<number, number | null>; revision: string };
type SearchMatch = { path: string; rank: number };
type SearchState = 'idle' | 'loading' | 'ready' | 'error';
const searchResultLimit = 100;

const icons = {
  directory: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M1.5 4h5l1.4 1.5h6.6v7.8H1.5z" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>',
  markdown: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 1.5h7l3 3v10H3zM10 1.5v3h3" fill="none" stroke="currentColor"/><path d="M5 8h6M5 10h5M5 12h4" stroke="currentColor"/></svg>',
  code: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="m5.5 4-4 4 4 4m5-8 4 4-4 4M9 2 7 14" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>',
  image: '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="1.5" y="2" width="13" height="12" rx="1" fill="none" stroke="currentColor"/><circle cx="5" cy="5" r="1"/><path d="m2 12 4-4 2 2 2-2 4 4" fill="none" stroke="currentColor"/></svg>',
  other: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 1.5h7l3 3v10H3zM10 1.5v3h3" fill="none" stroke="currentColor"/></svg>',
};
const storageKey = 'markport-open-folders-v2';
function savedFolders(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(storageKey) ?? '[]') as string[]); } catch { return new Set(); }
}
const opened = savedFolders();
const nameCollator = new Intl.Collator('ja', { numeric: true, sensitivity: 'base' });
function compareNames(a: string, b: string): number {
  const natural = nameCollator.compare(a, b);
  return natural || (a < b ? -1 : a > b ? 1 : 0);
}
function icon(name: string, directory = false): string {
  if (directory) return icons.directory;
  if (/\.md|\.markdown$/i.test(name)) return icons.markdown;
  if (/\.(png|jpe?g|gif|webp|svg)$/i.test(name)) return icons.image;
  if (/\.(py|go|[cm]?js|tsx?|rs|java|sh|css|html?|json|ya?ml)$/i.test(name)) return icons.code;
  return icons.other;
}
function score(path: string, query: string): number {
  const target = path.toLocaleLowerCase();
  let position = 0; let points = 0; let last = -2;
  for (const char of query) {
    const found = target.indexOf(char, position);
    if (found < 0) return -1;
    points += found === last + 1 ? 4 : 1;
    if (found === 0 || '/-_.'.includes(target[found - 1])) points += 5;
    last = found; position = found + 1;
  }
  return Math.max(0, points - path.length / 100);
}
function better(a: SearchMatch, b: SearchMatch): boolean {
  return a.rank > b.rank || (a.rank === b.rank && compareNames(a.path, b.path) < 0);
}
function searchMatches(paths: string[], query: string): { matches: SearchMatch[]; count: number } {
  const heap: SearchMatch[] = []; let count = 0;
  const siftUp = (start: number): void => {
    let child = start;
    while (child > 0) {
      const parent = Math.floor((child - 1) / 2);
      if (!better(heap[parent], heap[child])) break;
      [heap[parent], heap[child]] = [heap[child], heap[parent]]; child = parent;
    }
  };
  const siftDown = (): void => {
    let parent = 0;
    for (;;) {
      const left = parent * 2 + 1; if (left >= heap.length) break;
      const right = left + 1;
      const child = right < heap.length && better(heap[left], heap[right]) ? right : left;
      if (!better(heap[parent], heap[child])) break;
      [heap[parent], heap[child]] = [heap[child], heap[parent]]; parent = child;
    }
  };
  for (const path of paths) {
    const rank = score(path, query); if (rank < 0) continue;
    count++;
    const candidate = { path, rank };
    if (heap.length < searchResultLimit) { heap.push(candidate); siftUp(heap.length - 1); }
    else if (better(candidate, heap[0])) { heap[0] = candidate; siftDown(); }
  }
  return { matches: heap.sort((a, b) => better(a, b) ? -1 : better(b, a) ? 1 : 0), count };
}
function highlighted(label: string, query: string): DocumentFragment {
  const fragment = document.createDocumentFragment();
  const lower = label.toLocaleLowerCase(); let index = 0;
  for (const char of query) {
    const found = lower.indexOf(char, index);
    if (found < 0) break;
    fragment.append(document.createTextNode(label.slice(index, found)));
    const mark = document.createElement('mark'); mark.textContent = label[found]; fragment.append(mark);
    index = found + 1;
  }
  fragment.append(document.createTextNode(label.slice(index)));
  return fragment;
}
function fileLink(node: Node, selected: string, query = ''): DocumentFragment {
  const row = document.createDocumentFragment();
  const link = document.createElement('a');
  link.href = `/?path=${encodeURIComponent(node.path)}`;
  link.title = node.path;
  link.className = `file file-${/\.(md|markdown)$/i.test(node.name) ? 'markdown' : /\.(png|jpe?g|gif|webp|svg)$/i.test(node.name) ? 'image' : /\.(py|go|[cm]?js|tsx?|rs|java|sh|css|html?|json|ya?ml)$/i.test(node.name) ? 'code' : 'other'}`;
  link.innerHTML = icon(node.name);
  const label = document.createElement('span'); label.className = 'node-label'; label.append(query ? highlighted(node.path, query) : document.createTextNode(node.name)); link.append(label);
  if (node.path === selected) link.setAttribute('aria-current', 'page');
  const right = document.createElement('button'); right.type = 'button'; right.className = 'open-right'; right.dataset.rightPath = node.path;
  right.title = `Open ${node.path} on right`; right.setAttribute('aria-label', `Open ${node.path} on right`); right.textContent = '⇥';
  row.append(link, right); return row;
}
export class TreeView {
  private directories = new Map<string, Directory>();
  private readme = '';
  private loading = new Set<string>();
  private searchPaths: string[] = [];
  private searchState: SearchState = 'idle';
  constructor(private tree: HTMLElement, private search: HTMLInputElement, private count: HTMLElement, private selected: () => string,
    private onOpen: (path: string) => void, private onPage: (path: string, offset: number) => void,
    private onSearch: (query: string) => void) {
    tree.addEventListener('click', (event) => {
      const more = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-dir][data-offset]');
      if (more) { this.onPage(more.dataset.dir!, Number(more.dataset.offset)); return; }
      const summary = (event.target as HTMLElement).closest('summary');
      if (!summary) return;
      const details = summary.parentElement as HTMLDetailsElement;
      const path = details.dataset.path!;
      if (details.open && this.selected().startsWith(`${path}/`)) { event.preventDefault(); return; }
      if (details.open) { opened.delete(path); this.forget(path); }
      else { opened.add(path); this.onOpen(path); }
      try { localStorage.setItem(storageKey, JSON.stringify([...opened])); } catch { /* Storage may be unavailable. */ }
    }, true);
    search.addEventListener('input', () => { this.render(); this.onSearch(search.value.trim()); });
    search.addEventListener('keydown', (event) => {
      const links = [...tree.querySelectorAll<HTMLAnchorElement>('a')];
      if (event.key === 'Escape') { search.value = ''; this.render(); this.onSearch(''); return; }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault(); const active = links.indexOf(document.activeElement as HTMLAnchorElement);
        links[Math.max(0, Math.min(links.length - 1, active + (event.key === 'ArrowDown' ? 1 : -1))) ]?.focus();
      } else if (event.key === 'Enter') links[0]?.click();
    });
    tree.addEventListener('keydown', (event) => {
      const links = [...tree.querySelectorAll<HTMLAnchorElement>('a')].filter((link) => !link.closest('details:not([open])'));
      const active = links.indexOf(document.activeElement as HTMLAnchorElement);
      if (active < 0) return;
      let next = active;
      if (event.key === 'ArrowDown') next++;
      else if (event.key === 'ArrowUp') next--;
      else if (event.key === 'Home') next = 0;
      else if (event.key === 'End') next = links.length - 1;
      else return;
      event.preventDefault(); links[Math.max(0, Math.min(links.length - 1, next))]?.focus();
    });
  }
  has(path: string): boolean { return this.directories.has(path); }
  forget(path: string): void {
    for (const key of this.directories.keys()) if (key === path || key.startsWith(`${path}/`)) this.directories.delete(key);
    for (const key of opened) if (key === path || key.startsWith(`${path}/`)) opened.delete(key);
    try { localStorage.setItem(storageKey, JSON.stringify([...opened])); } catch { /* Storage may be unavailable. */ }
    this.render();
  }
  unloadedOpenPaths(): string[] {
    return [...this.tree.querySelectorAll<HTMLDetailsElement>('details[open][data-path]')].map((element) => element.dataset.path!).filter((path) => !this.has(path) && !this.loading.has(path));
  }
  hasChild(dir: string, name: string): boolean { return this.nodes(dir).some((node) => node.name === name); }
  revision(path: string): string | undefined { return this.directories.get(path)?.revision; }
  offsets(path: string): number[] { return [...(this.directories.get(path)?.pages.keys() ?? [])].sort((a, b) => a - b); }
  nodes(path: string): Node[] {
    const directory = this.directories.get(path);
    return directory ? this.offsets(path).flatMap((offset) => directory.pages.get(offset) ?? []) : [];
  }
  setLoading(path: string, value: boolean): void {
    if (this.loading.has(path) === value) return;
    if (value) this.loading.add(path); else this.loading.delete(path);
    this.render();
  }
  setPage(path: string, page: Page): boolean {
    const previous = this.directories.get(path);
    const changed = previous?.revision !== page.revision;
    if (previous && !changed && previous.pages.has(page.offset)) return false;
    if (previous && changed) for (const key of this.directories.keys()) if (key.startsWith(`${path}/`)) this.directories.delete(key);
    const directory: Directory = !previous || changed ? { pages: new Map(), next: new Map(), revision: page.revision } : previous;
    directory.pages.set(page.offset, page.entries);
    directory.next.set(page.offset, page.nextOffset);
    this.directories.set(path, directory);
    if (path === '') this.readme = page.readme ?? '';
    this.render();
    return changed;
  }
  expandedPaths(): string[] {
    const selected = this.selected();
    return [...this.directories.keys()].filter((path) => path === '' || selected.startsWith(`${path}/`) || opened.has(path));
  }
  pruneInactive(): void {
    const active = new Set(this.expandedPaths());
    for (const key of this.directories.keys()) if (!active.has(key)) this.directories.delete(key);
    this.render();
  }
  firstReadme(): string | undefined { return this.readme || undefined; }
  setSearchIndex(paths: string[], state: SearchState): void {
    this.searchPaths = paths; this.searchState = state; this.render();
  }
  private allFiles(): Node[] { return [...this.directories.keys()].flatMap((path) => this.nodes(path)).filter((node) => node.type === 'file'); }
  fileCount(): number { return this.allFiles().length; }
  private appendNodes(parent: HTMLElement, path: string): void {
    const list = document.createElement('ul');
    const directory = this.directories.get(path);
    if (!directory) {
      if (this.loading.has(path)) { const item = document.createElement('li'); item.className = 'hint'; item.textContent = 'Loading…'; list.append(item); }
      parent.append(list); return;
    }
    for (const offset of this.offsets(path)) {
      if (offset > 0 && !directory.pages.has(offset - 200)) this.appendPageButton(list, path, offset - 200, 'Load previous items');
      for (const node of directory.pages.get(offset) ?? []) {
        const item = document.createElement('li');
        if (node.type === 'directory') {
          const details = document.createElement('details'); details.dataset.path = node.path;
          details.open = this.selected().startsWith(`${node.path}/`) || opened.has(node.path);
          const summary = document.createElement('summary'); summary.title = node.path;
          summary.innerHTML = `<span class="chevron" aria-hidden="true">›</span>${icon(node.name, true)}`;
          const label = document.createElement('span'); label.className = 'node-label'; label.textContent = node.name; summary.append(label);
          details.append(summary);
          if (details.open) this.appendNodes(details, node.path);
          item.append(details);
        } else item.append(fileLink(node, this.selected()));
        list.append(item);
      }
      const next = directory.next.get(offset);
      if (next !== null && next !== undefined && !directory.pages.has(next)) this.appendPageButton(list, path, next, 'Load next items');
    }
    parent.append(list);
  }
  private appendPageButton(list: HTMLUListElement, path: string, offset: number, label: string): void {
    const item = document.createElement('li'); const button = document.createElement('button');
    button.type = 'button'; button.textContent = label; button.dataset.dir = path; button.dataset.offset = String(offset);
    item.append(button); list.append(item);
  }
  render(): void {
    const query = this.search.value.trim().toLocaleLowerCase();
    this.tree.replaceChildren();
    if (query) {
      if (this.searchState !== 'ready') {
        this.count.textContent = this.searchState === 'error' ? 'Search unavailable' : 'Loading file names…';
        const hint = document.createElement('p'); hint.className = 'hint';
        hint.textContent = this.searchState === 'error' ? 'Could not load file names. Try again or refresh.' : 'Searching all files…';
        this.tree.append(hint); return;
      }
      const { matches, count } = searchMatches(this.searchPaths, query);
      this.count.textContent = count > searchResultLimit ? `Showing top ${searchResultLimit} of ${count} matches` : `${count} ${count === 1 ? 'match' : 'matches'}`;
      if (!count) { const empty = document.createElement('p'); empty.className = 'hint'; empty.textContent = 'No matching files.'; this.tree.append(empty); }
      else {
        const list = document.createElement('ul'); list.className = 'search-results';
        for (const { path } of matches) {
          const item = document.createElement('li');
          item.append(fileLink({ name: path.split('/').at(-1)!, path, type: 'file' }, this.selected(), query)); list.append(item);
        }
        this.tree.append(list);
      }
    } else {
      this.count.textContent = `${this.fileCount()} ${this.fileCount() === 1 ? 'file' : 'files'} loaded`;
      if (this.has('') && !this.nodes('').length) { const empty = document.createElement('p'); empty.className = 'hint'; empty.textContent = 'No files to display (.git, node_modules, and .venv are excluded).'; this.tree.append(empty); }
      else this.appendNodes(this.tree, '');
    }
  }
  reveal(path: string): void {
    if (this.search.value) { this.search.value = ''; this.render(); this.onSearch(''); }
    const target = [...this.tree.querySelectorAll<HTMLAnchorElement>('a')].find((link) => new URL(link.href).searchParams.get('path') === path);
    target?.scrollIntoView?.({ block: 'nearest' });
  }
  revealDirectory(path: string): void {
    if (this.search.value) { this.search.value = ''; this.onSearch(''); }
    let current = '';
    for (const part of path.split('/')) {
      current = current ? `${current}/${part}` : part;
      opened.add(current);
      if (!this.has(current)) this.onOpen(current);
    }
    try { localStorage.setItem(storageKey, JSON.stringify([...opened])); } catch { /* Storage may be unavailable. */ }
    this.render();
    const target = [...this.tree.querySelectorAll<HTMLDetailsElement>('details[data-path]')].find((details) => details.dataset.path === path);
    const summary = target?.querySelector<HTMLElement>(':scope > summary');
    summary?.scrollIntoView?.({ block: 'nearest' });
    summary?.focus({ preventScroll: true });
  }
}
