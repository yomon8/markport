export type Node = { name: string; path: string; type: 'directory' | 'file'; children?: Node[] };

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
function compareNodes(a: Node, b: Node): number {
  if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
  return compareNames(a.name, b.name);
}
function icon(name: string, directory = false): string {
  if (directory) return icons.directory;
  if (/\.md|\.markdown$/i.test(name)) return icons.markdown;
  if (/\.(png|jpe?g|gif|webp|svg)$/i.test(name)) return icons.image;
  if (/\.(py|go|[cm]?js|tsx?|rs|java|sh|css|html|json|ya?ml)$/i.test(name)) return icons.code;
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
  return points - path.length / 100;
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
function files(items: Node[]): Node[] { return items.flatMap((node) => node.type === 'file' ? [node] : files(node.children ?? [])); }
function fileLink(node: Node, selected: string, query = ''): HTMLAnchorElement {
  const link = document.createElement('a');
  link.href = `/?path=${encodeURIComponent(node.path)}`;
  link.title = node.path;
  link.className = `file file-${/\.(md|markdown)$/i.test(node.name) ? 'markdown' : /\.(png|jpe?g|gif|webp|svg)$/i.test(node.name) ? 'image' : /\.(py|go|[cm]?js|tsx?|rs|java|sh|css|html|json|ya?ml)$/i.test(node.name) ? 'code' : 'other'}`;
  link.innerHTML = icon(node.name);
  const label = document.createElement('span'); label.className = 'node-label'; label.append(query ? highlighted(node.path, query) : document.createTextNode(node.name)); link.append(label);
  if (node.path === selected) link.setAttribute('aria-current', 'page');
  return link;
}
function appendNodes(parent: HTMLElement, items: Node[], selected: string): void {
  const list = document.createElement('ul');
  for (const node of [...items].sort(compareNodes)) {
    const item = document.createElement('li');
    if (node.type === 'directory') {
      const details = document.createElement('details'); details.dataset.path = node.path;
      details.open = selected.startsWith(`${node.path}/`) || opened.has(node.path);
      const summary = document.createElement('summary'); summary.title = node.path;
      summary.innerHTML = `<span class="chevron" aria-hidden="true">›</span>${icon(node.name, true)}`;
      const label = document.createElement('span'); label.className = 'node-label'; label.textContent = node.name; summary.append(label);
      details.append(summary); appendNodes(details, node.children ?? [], selected); item.append(details);
    } else item.append(fileLink(node, selected));
    list.append(item);
  }
  parent.append(list);
}
export class TreeView {
  nodes: Node[] = [];
  constructor(private tree: HTMLElement, private search: HTMLInputElement, private count: HTMLElement, private selected: () => string) {
    tree.addEventListener('click', (event) => {
      const summary = (event.target as HTMLElement).closest('summary');
      if (!summary) return;
      const details = summary.parentElement as HTMLDetailsElement;
      const path = details.dataset.path!;
      if (details.open && this.selected().startsWith(`${path}/`)) { event.preventDefault(); return; }
      if (details.open) opened.delete(path); else opened.add(path);
      try { localStorage.setItem(storageKey, JSON.stringify([...opened])); } catch { /* Storage may be unavailable. */ }
    }, true);
    search.addEventListener('input', () => this.render());
    search.addEventListener('keydown', (event) => {
      const links = [...tree.querySelectorAll<HTMLAnchorElement>('a')];
      if (event.key === 'Escape') { search.value = ''; this.render(); return; }
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
  render(): void {
    const query = this.search.value.trim().toLocaleLowerCase();
    this.tree.replaceChildren();
    if (query) {
      const matches = files(this.nodes).map((node) => ({ node, rank: score(node.path, query) })).filter((item) => item.rank >= 0).sort((a, b) => b.rank - a.rank || compareNames(a.node.path, b.node.path));
      this.count.textContent = `${matches.length}件`;
      if (!matches.length) { const empty = document.createElement('p'); empty.className = 'hint'; empty.textContent = '一致するファイルはありません。'; this.tree.append(empty); }
      else { const list = document.createElement('ul'); list.className = 'search-results'; for (const { node } of matches) { const item = document.createElement('li'); item.append(fileLink(node, this.selected(), query)); list.append(item); } this.tree.append(list); }
    } else {
      this.count.textContent = `${files(this.nodes).length}ファイル`;
      if (!this.nodes.length) { const empty = document.createElement('p'); empty.className = 'hint'; empty.textContent = '表示できるファイルがありません（.git・node_modules・.venvは除外）。'; this.tree.append(empty); }
      else appendNodes(this.tree, this.nodes, this.selected());
    }
  }
  reveal(path: string): void {
    if (this.search.value) { this.search.value = ''; this.render(); }
    for (const details of this.tree.querySelectorAll<HTMLDetailsElement>('details[data-path]')) if (path.startsWith(`${details.dataset.path}/`) || path === details.dataset.path) details.open = true;
    const target = [...this.tree.querySelectorAll<HTMLAnchorElement>('a')].find((link) => new URL(link.href).searchParams.get('path') === path)
      ?? [...this.tree.querySelectorAll<HTMLDetailsElement>('details[data-path]')].find((details) => details.dataset.path === path)?.querySelector('summary');
    target?.scrollIntoView?.({ block: 'nearest' });
  }
  firstReadme(): string | undefined { return this.nodes.find((node) => node.type === 'file' && /^readme\.md$/i.test(node.name))?.path; }
  fileCount(): number { return files(this.nodes).length; }
}
