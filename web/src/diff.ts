export type Staging = 'staged' | 'unstaged' | 'mixed' | 'untracked' | 'conflicted' | 'clean';
export type Change = { path: string; status: 'added' | 'modified' | 'deleted'; revision: string; added?: number | null; deleted?: number | null; staging?: Staging; gitStatuses?: string[] };
export type ChangesReply = { available: boolean; reason?: 'git_unavailable' | 'not_repository'; rootId?: string; base?: string; changes: Change[] };
export type DiffReply = { path: string; kind: 'text' | 'binary'; patch: string };

const statusLabels: Record<Change['status'], string> = { added: 'Added', modified: 'Modified', deleted: 'Deleted' };
const codeLabels: Record<string, string> = { ' ': 'none', M: 'Modified', A: 'Added', D: 'Deleted', T: 'Type changed' };
const conflictLabels: Record<string, string> = { DD: 'both deleted', AU: 'added by us', UD: 'deleted by them', UA: 'added by them', DU: 'deleted by us', AA: 'both added', UU: 'both modified' };
export function gitStatusIndicator(change: Change): HTMLElement {
  const indicator = document.createElement('span'); indicator.className = 'git-status'; indicator.dataset.statuses = JSON.stringify(change.gitStatuses ?? []);
  const statuses = change.gitStatuses?.length ? change.gitStatuses : ['  '];
  const descriptions: string[] = [];
  for (const code of statuses) {
    descriptions.push(code === '??' ? 'Untracked' : code === '  ' ? 'No local changes' : conflictLabels[code] ? `Conflict (${code}): ${conflictLabels[code]}` : `Staged: ${codeLabels[code[0]]}; unstaged: ${codeLabels[code[1]]}`);
    const pair = document.createElement('span'); pair.className = 'git-status-code'; pair.setAttribute('aria-hidden', 'true');
    for (const [index, char] of [...code].entries()) {
      const column = document.createElement('span'); column.className = index === 0 && char !== '?' ? 'git-status-index' : 'git-status-worktree';
      column.textContent = char; pair.append(column);
    }
    indicator.append(pair);
  }
  const description = `${descriptions.join('; ')}. Compared with base: ${statusLabels[change.status]}. Status is relative to current HEAD, index and working tree, regardless of comparison base.`;
  indicator.title = description; indicator.setAttribute('role', 'img'); indicator.setAttribute('aria-label', description);
  return indicator;
}
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
    const label = document.createElement('span'); label.className = 'change-path'; label.textContent = name;
    link.append(gitStatusIndicator(change), label);
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
        details.addEventListener('toggle', () => {
          if (details.isConnected) toggleFolder(child.path, details.open);
        });
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

type InlineSegment = { text: string; changed: boolean };

function tokenizeInline(text: string): string[] {
  return text.match(/\s+|[A-Za-z0-9_]+|./gu) ?? [];
}

function coalesceSegments(segments: InlineSegment[]): InlineSegment[] {
  const merged: InlineSegment[] = [];
  for (const segment of segments) {
    if (!segment.text) continue;
    const last = merged.at(-1);
    if (last && last.changed === segment.changed) last.text += segment.text;
    else merged.push({ ...segment });
  }
  return merged;
}

function inlineDiffPair(oldBody: string, newBody: string): { oldSegments: InlineSegment[]; newSegments: InlineSegment[] } | null {
  if (!oldBody || !newBody || oldBody === newBody || oldBody.length > 2000 || newBody.length > 2000) return null;
  const a = tokenizeInline(oldBody);
  const b = tokenizeInline(newBody);
  let prefix = 0;
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix++;
  let suffix = 0;
  while (suffix < a.length - prefix && suffix < b.length - prefix && a[a.length - 1 - suffix] === b[b.length - 1 - suffix]) suffix++;
  const aMid = a.slice(prefix, a.length - suffix);
  const bMid = b.slice(prefix, b.length - suffix);
  const prefixText = a.slice(0, prefix).join('');
  const suffixText = suffix ? a.slice(a.length - suffix).join('') : '';

  const oldSegments: InlineSegment[] = prefixText ? [{ text: prefixText, changed: false }] : [];
  const newSegments: InlineSegment[] = prefixText ? [{ text: prefixText, changed: false }] : [];
  let hasEqual = prefix > 0 || suffix > 0;

  if (aMid.length > 0 && bMid.length > 0 && aMid.length * bMid.length <= 10000) {
    const n = aMid.length; const m = bMid.length;
    const dp = new Int32Array((n + 1) * (m + 1));
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        dp[i * (m + 1) + j] = aMid[i] === bMid[j]
          ? dp[(i + 1) * (m + 1) + (j + 1)] + 1
          : Math.max(dp[(i + 1) * (m + 1) + j], dp[i * (m + 1) + (j + 1)]);
      }
    }
    let i = 0; let j = 0;
    while (i < n && j < m) {
      if (aMid[i] === bMid[j]) {
        hasEqual = true;
        oldSegments.push({ text: aMid[i], changed: false });
        newSegments.push({ text: bMid[j], changed: false });
        i++; j++;
      } else if (dp[(i + 1) * (m + 1) + j] >= dp[i * (m + 1) + (j + 1)]) {
        oldSegments.push({ text: aMid[i++], changed: true });
      } else {
        newSegments.push({ text: bMid[j++], changed: true });
      }
    }
    while (i < n) oldSegments.push({ text: aMid[i++], changed: true });
    while (j < m) newSegments.push({ text: bMid[j++], changed: true });
  } else {
    if (aMid.length) oldSegments.push({ text: aMid.join(''), changed: true });
    if (bMid.length) newSegments.push({ text: bMid.join(''), changed: true });
  }

  if (suffixText) {
    oldSegments.push({ text: suffixText, changed: false });
    newSegments.push({ text: suffixText, changed: false });
  }
  if (!hasEqual) return null;
  return { oldSegments: coalesceSegments(oldSegments), newSegments: coalesceSegments(newSegments) };
}

function appendInlineDiff(code: HTMLElement, prefix: string, segments: InlineSegment[], className: string): void {
  code.append(document.createTextNode(prefix));
  for (const segment of segments) {
    if (segment.changed) {
      const span = document.createElement('span');
      span.className = className;
      span.textContent = segment.text;
      code.append(span);
    } else {
      code.append(document.createTextNode(segment.text));
    }
  }
}

export function renderDiff(target: HTMLElement, reply: DiffReply): void {
  target.replaceChildren();
  if (reply.kind === 'binary') {
    const message = document.createElement('p'); message.className = 'hint'; message.textContent = 'This binary file has changed. A line-by-line diff is unavailable.';
    target.append(message); return;
  }
  if (!reply.patch) {
    const message = document.createElement('p'); message.className = 'hint'; message.textContent = 'No net changes against the comparison base.';
    target.append(message); return;
  }
  const frame = document.createElement('div'); frame.className = 'diff-frame';
  type ParsedRow = { kind: 'hunk' | 'added' | 'deleted' | 'context' | 'meta'; oldNumber: string; newNumber: string; line: string; segments?: InlineSegment[] };
  const rows: ParsedRow[] = [];
  let oldLine = 0; let newLine = 0;
  for (const line of reply.patch.split('\n')) {
    if (!line && rows.length) continue;
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (hunk) {
      oldLine = Number(hunk[1]); newLine = Number(hunk[2]);
      rows.push({ kind: 'hunk', oldNumber: '', newNumber: '', line });
    } else if (line.startsWith('+') && !line.startsWith('+++')) {
      rows.push({ kind: 'added', oldNumber: '', newNumber: String(newLine++), line });
    } else if (line.startsWith('-') && !line.startsWith('---')) {
      rows.push({ kind: 'deleted', oldNumber: String(oldLine++), newNumber: '', line });
    } else if (line.startsWith(' ')) {
      rows.push({ kind: 'context', oldNumber: String(oldLine++), newNumber: String(newLine++), line });
    } else {
      rows.push({ kind: 'meta', oldNumber: '', newNumber: '', line });
    }
  }
  for (let i = 0; i < rows.length;) {
    if (rows[i].kind !== 'deleted') { i++; continue; }
    const delStart = i;
    while (i < rows.length && rows[i].kind === 'deleted') i++;
    const addStart = i;
    while (i < rows.length && rows[i].kind === 'added') i++;
    const delCount = addStart - delStart;
    const addCount = i - addStart;
    if (delCount > 0 && addCount > 0 && delCount <= 50 && addCount <= 50) {
      const pairs = Math.min(delCount, addCount);
      for (let offset = 0; offset < pairs; offset++) {
        const diff = inlineDiffPair(rows[delStart + offset].line.slice(1), rows[addStart + offset].line.slice(1));
        if (diff) {
          rows[delStart + offset].segments = diff.oldSegments;
          rows[addStart + offset].segments = diff.newSegments;
        }
      }
    }
  }
  for (const parsed of rows) {
    const row = document.createElement('div'); row.className = `diff-row diff-${parsed.kind}`;
    const oldNumber = document.createElement('span'); oldNumber.className = 'diff-number'; oldNumber.textContent = parsed.oldNumber;
    const newNumber = document.createElement('span'); newNumber.className = 'diff-number'; newNumber.textContent = parsed.newNumber;
    const code = document.createElement('span'); code.className = 'diff-code';
    if (parsed.segments) {
      appendInlineDiff(code, parsed.line[0], parsed.segments, parsed.kind === 'deleted' ? 'diff-inline-del' : 'diff-inline-add');
    } else {
      code.textContent = parsed.line;
    }
    row.append(oldNumber, newNumber, code); frame.append(row);
  }
  target.append(frame);
}
