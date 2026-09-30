export type Change = { path: string; status: 'added' | 'modified' | 'deleted'; revision: string; added?: number | null; deleted?: number | null };
export type ChangesReply = { available: boolean; reason?: 'git_unavailable' | 'not_repository'; rootId?: string; base?: string; changes: Change[] };
export type DiffReply = { path: string; kind: 'text' | 'binary'; patch: string };

const statusLabels: Record<Change['status'], string> = { added: 'Added', modified: 'Modified', deleted: 'Deleted' };
export const diffURL = (path: string, base = ''): string => `/?path=${encodeURIComponent(path)}&view=diff${base ? `&base=${encodeURIComponent(base)}` : ''}`;
type ChangeFolder = { path: string; name: string; folders: Map<string, ChangeFolder>; files: Change[] };
const nameCollator = new Intl.Collator('ja', { numeric: true, sensitivity: 'base' });
function compareNames(a: string, b: string): number {
  return nameCollator.compare(a, b) || (a < b ? -1 : a > b ? 1 : 0);
}
function changeTree(changes: Change[]): ChangeFolder {
  const root: ChangeFolder = { path: '', name: '', folders: new Map(), files: [] };
  for (const change of changes) {
    const parts = change.path.split('/');
    let folder = root;
    for (const name of parts.slice(0, -1)) {
      let child = folder.folders.get(name);
      if (!child) {
        child = { path: folder.path ? `${folder.path}/${name}` : name, name, folders: new Map(), files: [] };
        folder.folders.set(name, child);
      }
      folder = child;
    }
    folder.files.push(change);
  }
  return root;
}
function sortedFolders(folder: ChangeFolder): ChangeFolder[] {
  return [...folder.folders.values()].sort((a, b) => compareNames(a.name, b.name));
}
function sortedFiles(folder: ChangeFolder): Change[] {
  return [...folder.files].sort((a, b) => compareNames(a.path.split('/').at(-1)!, b.path.split('/').at(-1)!));
}
export function orderedChanges(changes: Change[], treeView: boolean): Change[] {
  if (!treeView) return changes;
  const result: Change[] = [];
  const visit = (folder: ChangeFolder): void => {
    for (const child of sortedFolders(folder)) visit(child);
    result.push(...sortedFiles(folder));
  };
  visit(changeTree(changes));
  return result;
}

export function reviewButton(change: Change, isReviewed: boolean, toggle: () => void, labeled = false): HTMLButtonElement {
  const button = document.createElement('button'); button.type = 'button'; button.className = 'review-toggle';
  button.setAttribute('aria-pressed', String(isReviewed));
  button.setAttribute('aria-label', `${isReviewed ? 'Mark unreviewed' : 'Mark reviewed'}: ${change.path}`);
  button.title = isReviewed ? 'Mark unreviewed' : 'Mark reviewed';
  const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  icon.setAttribute('viewBox', '0 0 20 20'); icon.setAttribute('aria-hidden', 'true');
  const box = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  box.setAttribute('x', '2'); box.setAttribute('y', '2'); box.setAttribute('width', '16'); box.setAttribute('height', '16'); box.setAttribute('rx', '3');
  icon.append(box);
  if (isReviewed) {
    const check = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    check.setAttribute('d', 'M5 10l3 3 7-7'); icon.append(check);
  }
  button.append(icon);
  if (labeled) {
    const label = document.createElement('span'); label.className = 'review-label'; label.textContent = isReviewed ? 'Reviewed' : 'Mark reviewed';
    button.classList.add('labeled'); button.append(label);
  }
  button.addEventListener('click', toggle);
  return button;
}

export function summarizeChanges(changes: Change[], reviewed: (change: Change) => boolean): { files: number; added: number; deleted: number; reviewed: number } {
  let added = 0; let deleted = 0; let done = 0;
  for (const change of changes) {
    added += change.added ?? 0; deleted += change.deleted ?? 0;
    if (reviewed(change)) done++;
  }
  return { files: changes.length, added, deleted, reviewed: done };
}

function changeSummary(reply: ChangesReply, reviewed: (change: Change) => boolean): HTMLElement {
  const total = summarizeChanges(reply.changes, reviewed);
  const box = document.createElement('section'); box.className = 'change-summary'; box.setAttribute('aria-label', 'Change summary');
  const heading = document.createElement('div'); heading.className = 'change-summary-heading';
  const files = document.createElement('strong'); files.textContent = `${total.files} ${total.files === 1 ? 'file' : 'files'} changed`;
  const lines = document.createElement('span'); lines.className = 'change-lines'; lines.textContent = `+${total.added} −${total.deleted}`;
  lines.setAttribute('aria-label', `Added ${total.added} lines, deleted ${total.deleted} lines`);
  heading.append(files, lines);
  const bar = document.createElement('div'); bar.className = 'review-progress'; bar.setAttribute('role', 'progressbar');
  bar.setAttribute('aria-label', 'Reviewed files'); bar.setAttribute('aria-valuemin', '0'); bar.setAttribute('aria-valuemax', String(total.files)); bar.setAttribute('aria-valuenow', String(total.reviewed));
  const fill = document.createElement('span'); fill.style.width = `${total.files ? Math.round((total.reviewed / total.files) * 100) : 0}%`; bar.append(fill);
  const caption = document.createElement('span'); caption.className = 'review-progress-caption'; caption.textContent = `${total.reviewed} of ${total.files} reviewed`;
  box.append(heading, bar, caption);
  return box;
}

export function renderChanges(target: HTMLElement, reply: ChangesReply, reviewed: (change: Change) => boolean, toggle: (change: Change) => void, onlyUnreviewed: boolean, setFilter: (value: boolean) => void, treeView: boolean, setTreeView: (value: boolean) => void, collapsed: Set<string>, toggleFolder: (path: string, open: boolean) => void, compact = false): void {
  target.replaceChildren();
  if (!reply.available) {
    const message = document.createElement('p'); message.className = 'hint';
    message.textContent = reply.reason === 'git_unavailable' ? 'Git was not found. Git is required to show diffs.' : 'This directory is not a Git repository.';
    target.append(message); return;
  }
  const checked = reply.changes.filter(reviewed).length;
  if (!compact && reply.changes.length) target.append(changeSummary(reply, reviewed));
  const controls = document.createElement('div'); controls.className = 'change-controls';
  const count = document.createElement('span'); count.className = 'review-count'; count.textContent = `${checked} of ${reply.changes.length} reviewed`;
  const filter = document.createElement('label'); filter.className = 'review-filter';
  const input = document.createElement('input'); input.type = 'checkbox'; input.checked = onlyUnreviewed;
  input.addEventListener('change', () => setFilter(input.checked));
  filter.append(input, document.createTextNode(' Unreviewed only'));
  const tree = document.createElement('label'); tree.className = 'review-filter';
  const treeInput = document.createElement('input'); treeInput.type = 'checkbox'; treeInput.checked = treeView;
  treeInput.addEventListener('change', () => setTreeView(treeInput.checked));
  tree.append(treeInput, document.createTextNode(' Folder tree'));
  controls.append(count, filter, tree); target.append(controls);
  if (!reply.changes.length) {
    const message = document.createElement('p'); message.className = 'hint'; message.textContent = 'No changes.'; target.append(message); return;
  }
  const visible = reply.changes.filter((item) => !onlyUnreviewed || !reviewed(item));
  if (!visible.length) { const message = document.createElement('p'); message.className = 'hint'; message.textContent = 'All changes reviewed.'; target.append(message); return; }
  const fileItem = (change: Change, name: string): HTMLLIElement => {
    const item = document.createElement('li');
    const link = document.createElement('a'); link.href = diffURL(change.path, reply.base); link.title = change.path;
    const badge = document.createElement('span'); badge.className = `change-status ${change.status}`; badge.textContent = statusLabels[change.status];
    const label = document.createElement('span'); label.className = 'change-path'; label.textContent = name;
    link.append(badge, label);
    const lines = document.createElement('span'); lines.className = 'change-lines';
    lines.setAttribute('aria-label', `Added ${change.added ?? 'unknown'} lines, deleted ${change.deleted ?? 'unknown'} lines`);
    lines.textContent = change.added === null || change.deleted === null || change.added === undefined || change.deleted === undefined ? 'Binary' : `+${change.added} −${change.deleted}`;
    link.append(lines);
    const button = reviewButton(change, reviewed(change), () => toggle(change), !compact);
    item.append(link, button); return item;
  };
  const list = document.createElement('ul'); list.className = compact ? 'change-list compact' : 'change-list';
  if (!treeView) {
    for (const change of visible) list.append(fileItem(change, change.path));
  } else {
    const appendFolder = (parent: HTMLUListElement, folder: ChangeFolder): void => {
      for (const child of sortedFolders(folder)) {
        const item = document.createElement('li'); item.className = 'change-folder';
        const details = document.createElement('details'); details.dataset.path = child.path;
        details.open = !collapsed.has(child.path);
        details.addEventListener('toggle', () => toggleFolder(child.path, details.open));
        const summary = document.createElement('summary'); summary.title = child.path;
        const chevron = document.createElement('span'); chevron.className = 'chevron'; chevron.setAttribute('aria-hidden', 'true'); chevron.textContent = '›';
        const label = document.createElement('span'); label.className = 'node-label'; label.textContent = child.name;
        summary.append(chevron, label); details.append(summary);
        const children = document.createElement('ul'); children.className = 'change-list';
        appendFolder(children, child); details.append(children); item.append(details); parent.append(item);
      }
      for (const change of sortedFiles(folder)) parent.append(fileItem(change, change.path.split('/').at(-1)!));
    };
    appendFolder(list, changeTree(visible));
  }
  target.append(list);
}

export function renderDiff(target: HTMLElement, reply: DiffReply): void {
  target.replaceChildren();
  if (reply.kind === 'binary') {
    const message = document.createElement('p'); message.className = 'hint'; message.textContent = 'This binary file has changed. A line-by-line diff is unavailable.';
    target.append(message); return;
  }
  const frame = document.createElement('div'); frame.className = 'diff-frame';
  let oldLine = 0; let newLine = 0;
  for (const line of reply.patch.split('\n')) {
    if (!line && frame.childElementCount) continue;
    const row = document.createElement('div'); row.className = 'diff-row';
    const oldNumber = document.createElement('span'); oldNumber.className = 'diff-number';
    const newNumber = document.createElement('span'); newNumber.className = 'diff-number';
    const code = document.createElement('span'); code.className = 'diff-code'; code.textContent = line;
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (hunk) {
      oldLine = Number(hunk[1]); newLine = Number(hunk[2]); row.classList.add('diff-hunk');
    } else if (line.startsWith('+') && !line.startsWith('+++')) {
      row.classList.add('diff-added'); newNumber.textContent = String(newLine++);
    } else if (line.startsWith('-') && !line.startsWith('---')) {
      row.classList.add('diff-deleted'); oldNumber.textContent = String(oldLine++);
    } else if (line.startsWith(' ')) {
      row.classList.add('diff-context'); oldNumber.textContent = String(oldLine++); newNumber.textContent = String(newLine++);
    } else {
      row.classList.add('diff-meta');
    }
    row.append(oldNumber, newNumber, code); frame.append(row);
  }
  target.append(frame);
}
