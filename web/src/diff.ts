export type Change = { path: string; status: 'added' | 'modified' | 'deleted'; revision: string };
export type ChangesReply = { available: boolean; reason?: 'git_unavailable' | 'not_repository'; rootId?: string; changes: Change[] };
export type DiffReply = { path: string; kind: 'text' | 'binary'; patch: string };

const statusLabels: Record<Change['status'], string> = { added: 'Added', modified: 'Modified', deleted: 'Deleted' };
export const diffURL = (path: string): string => `/?path=${encodeURIComponent(path)}&view=diff`;

export function reviewButton(change: Change, isReviewed: boolean, toggle: () => void): HTMLButtonElement {
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
  button.addEventListener('click', toggle);
  return button;
}

export function renderChanges(target: HTMLElement, reply: ChangesReply, reviewed: (change: Change) => boolean, toggle: (change: Change) => void, onlyUnreviewed: boolean, setFilter: (value: boolean) => void, compact = false): void {
  target.replaceChildren();
  if (!reply.available) {
    const message = document.createElement('p'); message.className = 'hint';
    message.textContent = reply.reason === 'git_unavailable' ? 'Git was not found. Git is required to show diffs.' : 'This directory is not a Git repository.';
    target.append(message); return;
  }
  const checked = reply.changes.filter(reviewed).length;
  const controls = document.createElement('div'); controls.className = 'change-controls';
  const count = document.createElement('span'); count.className = 'review-count'; count.textContent = `${checked} of ${reply.changes.length} reviewed`;
  const filter = document.createElement('label'); filter.className = 'review-filter';
  const input = document.createElement('input'); input.type = 'checkbox'; input.checked = onlyUnreviewed;
  input.addEventListener('change', () => setFilter(input.checked));
  filter.append(input, document.createTextNode(' Unreviewed only')); controls.append(count, filter); target.append(controls);
  if (!reply.changes.length) {
    const message = document.createElement('p'); message.className = 'hint'; message.textContent = 'No changes.'; target.append(message); return;
  }
  const list = document.createElement('ul'); list.className = compact ? 'change-list compact' : 'change-list';
  for (const change of reply.changes.filter((item) => !onlyUnreviewed || !reviewed(item))) {
    const item = document.createElement('li');
    const link = document.createElement('a'); link.href = diffURL(change.path); link.title = change.path;
    const badge = document.createElement('span'); badge.className = `change-status ${change.status}`; badge.textContent = statusLabels[change.status];
    const label = document.createElement('span'); label.className = 'change-path'; label.textContent = change.path;
    link.append(badge, label);
    const button = reviewButton(change, reviewed(change), () => toggle(change));
    item.append(link, button); list.append(item);
  }
  if (!list.childElementCount) { const message = document.createElement('p'); message.className = 'hint'; message.textContent = 'All changes reviewed.'; target.append(message); }
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
