import { renderDiff, type DiffReply } from './diff';

export type Commit = { id: string; subject: string; author: string; date: string };
export type HistoryPage = { available: boolean; reason?: 'git_unavailable' | 'not_repository'; head?: string; commits: Commit[]; nextOffset: number | null };
export type HistoricalFile = { path: string; status: 'added' | 'modified' | 'deleted' };
export type CommitDetail = Commit & { message: string; files: HistoricalFile[] };

export function historyURL(id = '', path = ''): string {
  const query = new URLSearchParams({ view: 'history' });
  if (id) query.set('commit', id);
  if (path) query.set('path', path);
  return `/?${query}`;
}

function dateText(value: string): string {
  const time = Date.parse(value);
  return Number.isNaN(time) ? value : new Date(time).toLocaleString();
}

export function renderHistoryList(target: HTMLElement, page: HistoryPage, selected: string, loadOlder: () => void): void {
  target.replaceChildren();
  if (!page.available) {
    const hint = document.createElement('p'); hint.className = 'hint';
    hint.textContent = page.reason === 'git_unavailable' ? 'Git was not found. Git is required to show history.' : 'This directory is not a Git repository.';
    target.append(hint); return;
  }
  if (!page.commits.length) {
    const hint = document.createElement('p'); hint.className = 'hint'; hint.textContent = 'No commits to display.'; target.append(hint);
  }
  const list = document.createElement('ul'); list.className = 'history-list';
  for (const commit of page.commits) {
    const item = document.createElement('li');
    const link = document.createElement('a'); link.href = historyURL(commit.id);
    if (selected === commit.id) link.setAttribute('aria-current', 'page');
    const subject = document.createElement('strong'); subject.textContent = commit.subject;
    const meta = document.createElement('span'); meta.textContent = `${commit.id.slice(0, 7)} · ${commit.author} · ${dateText(commit.date)}`;
    link.append(subject, meta); item.append(link); list.append(item);
  }
  target.append(list);
  if (page.nextOffset !== null) {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'history-more'; button.textContent = 'Load older commits';
    button.addEventListener('click', loadOlder); target.append(button);
  }
}

export function renderCommit(target: HTMLElement, detail: CommitDetail, selectedPath = ''): void {
  target.replaceChildren();
  const heading = document.createElement('h1'); heading.textContent = detail.subject;
  const meta = document.createElement('p'); meta.className = 'history-meta'; meta.textContent = `${detail.id} · ${detail.author} · ${dateText(detail.date)}`;
  target.append(heading, meta);
  if (detail.message.trim() && detail.message.trim() !== detail.subject) {
    const message = document.createElement('pre'); message.className = 'history-message'; message.textContent = detail.message;
    target.append(message);
  }
  const filesHeading = document.createElement('h2'); filesHeading.textContent = `Changed files (${detail.files.length})`;
  target.append(filesHeading);
  const files = document.createElement('ul'); files.className = 'history-files';
  for (const file of detail.files) {
    const item = document.createElement('li');
    const link = document.createElement('a'); link.href = historyURL(detail.id, file.path);
    if (file.path === selectedPath) link.setAttribute('aria-current', 'page');
    const badge = document.createElement('span'); badge.className = `change-status ${file.status}`; badge.textContent = file.status;
    const path = document.createElement('span'); path.textContent = file.path;
    link.append(badge, path); item.append(link); files.append(item);
  }
  target.append(files);
}

export function renderCommitDiff(target: HTMLElement, detail: CommitDetail, diff: DiffReply): void {
  target.replaceChildren();
  const back = document.createElement('a'); back.href = historyURL(detail.id); back.textContent = '← Changed files'; back.className = 'history-back';
  const heading = document.createElement('h1'); heading.textContent = diff.path;
  const frame = document.createElement('div');
  renderDiff(frame, diff);
  target.append(back, heading, frame);
}
