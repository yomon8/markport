export type Change = { path: string; status: 'added' | 'modified' | 'deleted' };
export type ChangesReply = { available: boolean; reason?: 'git_unavailable' | 'not_repository'; changes: Change[] };
export type DiffReply = { path: string; kind: 'text' | 'binary'; patch: string };

const statusLabels: Record<Change['status'], string> = { added: '追加', modified: '変更', deleted: '削除' };
export const diffURL = (path: string): string => `/?path=${encodeURIComponent(path)}&view=diff`;

export function renderChanges(target: HTMLElement, reply: ChangesReply, compact = false): void {
  target.replaceChildren();
  if (!reply.available) {
    const message = document.createElement('p'); message.className = 'hint';
    message.textContent = reply.reason === 'git_unavailable' ? 'Gitが見つかりません。差分表示にはGitが必要です。' : 'Gitリポジトリではありません。';
    target.append(message); return;
  }
  if (!reply.changes.length) {
    const message = document.createElement('p'); message.className = 'hint'; message.textContent = '変更はありません。'; target.append(message); return;
  }
  const list = document.createElement('ul'); list.className = compact ? 'change-list compact' : 'change-list';
  for (const change of reply.changes) {
    const item = document.createElement('li');
    const link = document.createElement('a'); link.href = diffURL(change.path); link.title = change.path;
    const badge = document.createElement('span'); badge.className = `change-status ${change.status}`; badge.textContent = statusLabels[change.status];
    const label = document.createElement('span'); label.className = 'change-path'; label.textContent = change.path;
    link.append(badge, label); item.append(link); list.append(item);
  }
  target.append(list);
}

export function renderDiff(target: HTMLElement, reply: DiffReply): void {
  target.replaceChildren();
  if (reply.kind === 'binary') {
    const message = document.createElement('p'); message.className = 'hint'; message.textContent = 'バイナリファイルが変更されています。行ごとの差分は表示できません。';
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
