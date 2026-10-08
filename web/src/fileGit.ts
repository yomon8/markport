import { renderDiff, type DiffReply } from './diff';
import type { Commit } from './history';
import { createToolButton } from './toolButtons';

export type FileView = 'file' | 'diff' | 'file-history' | 'blame';
export type Pane = 'left' | 'right';
export type FileCommit = Commit & { path: string; status: string };
export type FileHistoryPage = { available: boolean; reason?: string; head?: string; commits: FileCommit[]; nextOffset: number | null };
export type FileRevision = Commit & { path: string; kind: 'text' | 'binary' | 'missing'; content: string; html: string };
export type BlameLine = { line: number; originalLine: number; commit: string; author: string; date: string; subject: string; path?: string; content: string; uncommitted: boolean };
export type BlameReply = { available: boolean; reason?: string; head?: string; path: string; lines: BlameLine[]; html: string };
const fields = ['view', 'commit', 'revision-path', 'revision-view', 'source', 'base'] as const;
export function paneKey(pane: Pane, field: string): string { return pane === 'left' ? field : `right-${field}`; }
export function fileView(url: URL, pane: Pane): FileView {
  const mode = url.searchParams.get(paneKey(pane, 'view'));
  return mode === 'diff' || mode === 'file-history' || mode === 'blame' ? mode : 'file';
}
export function fileViewURL(url: URL, pane: Pane, mode: FileView, commit = '', path = '', source = false): URL {
  const target = new URL(url);
  for (const field of ['view', 'commit', 'revision-path', 'revision-view']) target.searchParams.delete(paneKey(pane, field));
  if (mode !== 'file') target.searchParams.set(paneKey(pane, 'view'), mode);
  if (commit) {
    target.searchParams.set(paneKey(pane, 'commit'), commit);
    target.searchParams.set(paneKey(pane, 'revision-path'), path);
    if (source) target.searchParams.set(paneKey(pane, 'revision-view'), 'source');
  }
  target.hash = '';
  return target;
}
export function swapFilePanes(url: URL): URL {
  const target = new URL(url);
  for (const [left, right] of [['path', 'right'], ...fields.map((field) => [field, `right-${field}`])]) {
    const a = url.searchParams.get(left); const b = url.searchParams.get(right);
    if (b === null) target.searchParams.delete(left); else target.searchParams.set(left, b);
    if (a === null) target.searchParams.delete(right); else target.searchParams.set(right, a);
  }
  target.hash = '';
  return target;
}
export function rightOnlyURL(url: URL): URL {
  const target = swapFilePanes(url);
  target.searchParams.delete('right');
  for (const field of fields) target.searchParams.delete(`right-${field}`);
  return target;
}
const dateText = (value: string): string => value ? new Date(value).toLocaleString() : '';
function hint(target: HTMLElement, text: string): void {
  const element = document.createElement('p'); element.className = 'hint'; element.textContent = text; target.append(element);
}
function unavailable(reason?: string): string {
  return reason === 'git_unavailable' ? 'Git was not found. Git is required for this view.' : 'This directory is not a Git repository.';
}

// Each pane owns its pagination and immutable revision cache. Location and
// request checks prevent stale responses from repainting a different selection.
export class FileGitView {
  private page?: FileHistoryPage;
  private pagePath = '';
  private rendered = '';
  private request = 0;
  private revisions = new Map<string, FileRevision | DiffReply>();
  constructor(private target: HTMLElement, private pane: Pane, private get: <T>(url: string) => Promise<T>, private navigate: (url: URL) => void) { this.target.tabIndex = -1; }
  invalidate(): void { this.request++; this.closeDetails(); }
  private closeDetails(): void {
    this.target.querySelector<HTMLDialogElement>('.blame-details[open]')?.close();
  }
  private key(): string {
    const url = new URL(location.href);
    return JSON.stringify([url.searchParams.get(this.pane === 'left' ? 'path' : 'right'), ...fields.map((field) => url.searchParams.get(paneKey(this.pane, field)))]);
  }
  private link(text: string, url: URL): HTMLAnchorElement {
    const link = document.createElement('a'); link.textContent = text; link.href = url.href;
    link.addEventListener('click', (event) => {
      if (event.button || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      event.preventDefault(); event.stopPropagation();
      // Preserve the other pane's current state even if this link was rendered
      // before that pane was navigated independently.
      const next = new URL(location.href);
      for (const key of [this.pane === 'left' ? 'path' : 'right', ...fields.map((field) => paneKey(this.pane, field))]) {
        const value = url.searchParams.get(key);
        if (value === null) next.searchParams.delete(key); else next.searchParams.set(key, value);
      }
      next.hash = url.hash; this.navigate(next);
    });
    return link;
  }
  async refresh(path: string): Promise<void> {
    const request = ++this.request; const key = this.key(); const url = new URL(location.href); const mode = fileView(url, this.pane);
    const commit = url.searchParams.get(paneKey(this.pane, 'commit')) ?? '';
    const revisionPath = url.searchParams.get(paneKey(this.pane, 'revision-path')) || path;
    const source = url.searchParams.get(paneKey(this.pane, 'revision-view')) === 'source';
    const valid = (): boolean => request === this.request && key === this.key();
    this.target.setAttribute('aria-busy', 'true');
    try {
      if (mode === 'blame') {
        const reply = await this.get<BlameReply>(`/api/git/blame?path=${encodeURIComponent(path)}`);
        if (!valid()) return;
        this.paint(JSON.stringify([key, reply]), () => this.renderBlame(url, reply));
      } else {
        const first = await this.get<FileHistoryPage>(`/api/git/file-history?path=${encodeURIComponent(path)}`);
        if (!valid()) return;
        if (this.pagePath !== path || this.page?.head !== first.head) { this.page = undefined; this.revisions.clear(); }
        this.pagePath = path;
        this.page = this.page?.head && this.page.head === first.head
          ? { ...first, commits: [...first.commits, ...this.page.commits.slice(first.commits.length)], nextOffset: this.page.nextOffset }
          : first;
        if (!first.available || !commit) {
          this.paint(JSON.stringify([key, this.page]), () => this.renderHistory(url, path));
        } else {
          const cacheKey = JSON.stringify([first.head, commit, revisionPath, source]);
          let revision = this.revisions.get(cacheKey);
          if (!revision) {
            revision = await this.get<FileRevision | DiffReply>(`/api/git/${source ? 'file-at' : 'file-diff'}?id=${encodeURIComponent(commit)}&path=${encodeURIComponent(revisionPath)}`);
            if (!valid()) return;
            if (this.revisions.size >= 20) this.revisions.clear();
            this.revisions.set(cacheKey, revision);
          }
          this.paint(JSON.stringify([key, revision]), () => this.renderRevision(url, commit, revisionPath, source, revision!));
        }
      }
    } catch (error) {
      if (!valid()) return;
      const code = error && typeof error === 'object' && 'code' in error ? error.code : '';
      // Leave readable content in place during a transient background failure.
      if (this.rendered.startsWith(`${key}\n`) && code === 'network') return;
      this.paint(JSON.stringify([key, 'error', code]), () => {
        if (mode === 'file-history' && commit) this.target.append(this.link('← File history', fileViewURL(url, this.pane, 'file-history')));
        const box = document.createElement('div'); box.className = 'file-error'; box.setAttribute('role', 'alert');
        hint(box, code === 'binary' ? 'Blame is available for text files only.' : code === 'too_large' ? 'This file exceeds the display size limit.' : code === 'not_found' ? 'File or commit not found.' : code === 'no_change' ? 'This file has no changes in this commit.' : 'Cannot load this view. Please try again.');
        const button = document.createElement('button'); button.type = 'button'; button.textContent = 'Try again'; button.addEventListener('click', () => { void this.refresh(path); }); box.append(button); this.target.append(box);
      });
    } finally { if (valid()) this.target.setAttribute('aria-busy', 'false'); }
  }
  private paint(key: string, render: () => void): void {
    const selection = this.key(); const next = `${selection}\n${key}`;
    if (this.rendered === next && this.target.dataset.kind === 'file-git') return;
    const scroller = this.target.closest<HTMLElement>('main, #right-pane');
    const scroll = scroller?.scrollTop ?? 0;
    const focused = this.target.contains(document.activeElement) ? document.activeElement as HTMLElement : null;
    const focusKey = focused?.getAttribute('href') ?? focused?.getAttribute('data-git-action');
    this.closeDetails();
    this.target.dataset.kind = 'file-git'; this.target.replaceChildren(); render(); this.rendered = next;
    if (scroller) scroller.scrollTop = scroll;
    if (focusKey) {
      const replacement = [...this.target.querySelectorAll<HTMLElement>('a,button')].find((item) => (item.getAttribute('href') ?? item.getAttribute('data-git-action')) === focusKey);
      (replacement ?? this.target).focus({ preventScroll: true });
    }
  }
  private renderHistory(url: URL, path: string): void {
    const page = this.page!;
    if (!page.available) { hint(this.target, unavailable(page.reason)); return; }
    if (!page.commits.length) { hint(this.target, 'No commits for this file.'); return; }
    const heading = document.createElement('h1'); heading.textContent = 'File history'; this.target.append(heading);
    const list = document.createElement('ul'); list.className = 'file-history-list';
    for (const commit of page.commits) {
      const item = document.createElement('li');
      const link = this.link(commit.subject, fileViewURL(url, this.pane, 'file-history', commit.id, commit.path));
      const meta = document.createElement('span'); meta.textContent = `${commit.id.slice(0, 7)} · ${commit.author} · ${dateText(commit.date)} · ${commit.status}`;
      const oldPath = document.createElement('span'); oldPath.textContent = commit.path;
      item.append(link, meta); if (commit.path !== path) item.append(oldPath); list.append(item);
    }
    this.target.append(list);
    if (page.nextOffset !== null) {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'history-more'; button.textContent = 'Load older commits'; button.dataset.gitAction = 'older';
      button.addEventListener('click', () => { void this.loadOlder(path, url, button); }); this.target.append(button);
    }
  }
  private async loadOlder(path: string, url: URL, button: HTMLButtonElement): Promise<void> {
    const page = this.page; const key = this.key();
    if (!page?.head || page.nextOffset === null) return;
    button.disabled = true;
    try {
      const older = await this.get<FileHistoryPage>(`/api/git/file-history?path=${encodeURIComponent(path)}&head=${encodeURIComponent(page.head)}&offset=${page.nextOffset}`);
      if (key !== this.key() || this.page?.head !== page.head || this.page.nextOffset !== page.nextOffset) return;
      this.page = { ...page, commits: [...page.commits, ...older.commits], nextOffset: older.nextOffset };
      this.paint(JSON.stringify([key, this.page]), () => this.renderHistory(url, path));
    } catch {
      if (button.isConnected) { button.disabled = false; button.textContent = 'Try loading older commits again'; }
    } finally { if (button.isConnected) button.disabled = false; }
  }
  private renderRevision(url: URL, commit: string, path: string, source: boolean, reply: FileRevision | DiffReply): void {
    this.target.append(this.link('← File history', fileViewURL(url, this.pane, 'file-history')));
    const info = this.page?.commits.find((item) => item.id === commit) ?? ('id' in reply ? reply : undefined);
    const heading = document.createElement('h1'); heading.textContent = info?.subject ?? commit.slice(0, 7);
    const meta = document.createElement('p'); meta.className = 'history-meta'; meta.textContent = `${commit.slice(0, 7)}${info ? ` · ${info.author} · ${dateText(info.date)}` : ''} · ${path}`;
    this.target.append(heading, meta);
    const views = document.createElement('div'); views.className = 'revision-views'; views.setAttribute('role', 'group'); views.setAttribute('aria-label', 'Historical Diff or Source');
    for (const [label, selected] of [['Diff', !source], ['Source', source]] as const) {
      const link = this.link(label, fileViewURL(url, this.pane, 'file-history', commit, path, label === 'Source'));
      if (selected) link.setAttribute('aria-current', 'page'); views.append(link);
    }
    this.target.append(views);
    const frame = document.createElement('div'); this.target.append(frame);
    if ('patch' in reply) { renderDiff(frame, reply); }
    else if (reply.kind === 'missing') hint(frame, 'This file does not exist at this commit.');
    else if (reply.kind === 'binary') hint(frame, 'Source is available for text files only.');
    else { frame.className = 'historical-source code-frame'; frame.tabIndex = 0; frame.setAttribute('role', 'region'); frame.setAttribute('aria-label', 'Historical source'); frame.innerHTML = reply.html; }
  }
  private renderBlame(url: URL, reply: BlameReply): void {
    if (!reply.available) { hint(this.target, unavailable(reply.reason)); return; }
    if (!reply.lines.length) { hint(this.target, 'This file is empty.'); return; }
    const heading = document.createElement('h1'); heading.textContent = 'Blame'; this.target.append(heading);
    const dialog = document.createElement('dialog'); dialog.className = 'blame-details'; dialog.setAttribute('aria-label', 'Last change details');
    const detailsHeading = document.createElement('h2'); detailsHeading.textContent = 'Last change';
    const details = document.createElement('dl');
    const close = document.createElement('button'); close.type = 'button'; close.textContent = 'Close';
    close.addEventListener('click', () => dialog.close());
    let opener: HTMLButtonElement | undefined;
    dialog.addEventListener('close', () => { if (opener?.isConnected) opener.focus({ preventScroll: true }); });
    dialog.append(detailsHeading, details, close);
    const frame = document.createElement('div'); frame.className = 'blame-frame'; frame.tabIndex = 0; frame.setAttribute('role', 'region'); frame.setAttribute('aria-label', 'Blame source');
    const table = document.createElement('table'); table.className = 'blame-table'; table.setAttribute('aria-label', 'Line history and source');
    const header = document.createElement('thead'); const headerRow = document.createElement('tr');
    for (const text of ['Last change', 'Line', 'Source']) { const cell = document.createElement('th'); cell.scope = 'col'; cell.textContent = text; headerRow.append(cell); }
    header.append(headerRow); table.append(header);
    const highlighted = document.createElement('div'); highlighted.innerHTML = reply.html;
    const codeLines = [...highlighted.querySelectorAll<HTMLElement>('.lntd:last-child .line .cl')];
    const body = document.createElement('tbody');
    for (const [index, line] of reply.lines.entries()) {
      const row = document.createElement('tr'); row.dataset.blameLine = String(line.line); if (line.uncommitted) row.className = 'uncommitted';
      const meta = document.createElement('td'); meta.className = 'blame-meta';
      const previous = reply.lines[index - 1];
      if (!previous || previous.commit !== line.commit || previous.uncommitted !== line.uncommitted) {
        if (line.uncommitted) { const label = document.createElement('strong'); label.textContent = 'Uncommitted'; meta.append(label); }
        else {
          const link = line.path ? this.link(line.commit.slice(0, 7), fileViewURL(url, this.pane, 'file-history', line.commit, line.path, true)) : document.createElement('span');
          if (!line.path) link.textContent = line.commit.slice(0, 7);
          link.title = line.subject; meta.append(link);
          const author = document.createElement('span'); author.className = 'blame-author'; author.textContent = ` · ${line.author}`; meta.append(author);
          meta.title = `${line.subject} · ${dateText(line.date)}`;
          const date = document.createElement('time'); date.dateTime = line.date; date.textContent = dateText(line.date); meta.append(date);
          const button = createToolButton('info', `Last change details for line ${line.line}`); button.classList.add('blame-details-button'); button.setAttribute('aria-haspopup', 'dialog'); button.dataset.gitAction = `blame-details-${line.line}`;
          button.addEventListener('click', () => {
            details.replaceChildren();
            for (const [label, value] of [['Commit', line.commit], ['Author', line.author], ['Date', dateText(line.date)], ['Message', line.subject], ['Original path', line.path ?? reply.path]]) {
              const term = document.createElement('dt'); term.textContent = label;
              const description = document.createElement('dd'); description.textContent = value; details.append(term, description);
            }
            opener = button; dialog.showModal(); close.focus();
          });
          meta.append(button);
        }
      } else { meta.setAttribute('aria-label', line.uncommitted ? 'Uncommitted' : `${line.commit.slice(0, 7)} · ${line.author} · ${dateText(line.date)}`); }
      const number = document.createElement('td'); number.className = 'blame-number'; number.textContent = String(line.line);
      const code = document.createElement('td'); code.className = 'blame-code chroma';
      if (codeLines[index]) code.innerHTML = codeLines[index].innerHTML.replace(/\n$/, ''); else code.textContent = line.content;
      row.append(meta, number, code); body.append(row);
    }
    table.append(body); frame.append(table); this.target.append(frame, dialog);
  }
}
