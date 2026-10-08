// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { FileGitView, fileViewURL, rightOnlyURL, swapFilePanes, type BlameReply, type FileHistoryPage } from '../src/fileGit';

const id = 'a'.repeat(40);
const commit = { id, path: 'old.go', status: 'modified', author: '<Author>', date: '2026-10-01T00:00:00Z', subject: '<script>subject</script>' };
const history: FileHistoryPage = { available: true, head: id, commits: [commit], nextOffset: null };
const blame: BlameReply = { available: true, head: id, path: 'new.go', html: '', lines: [
  { line: 1, originalLine: 1, commit: id, author: '<Author>', date: commit.date, subject: commit.subject, path: 'old.go', content: '<script>source</script>', uncommitted: false },
  { line: 2, originalLine: 2, commit: '0'.repeat(40), author: '', date: '', subject: '', content: 'new', uncommitted: true },
] };
beforeEach(() => { document.body.innerHTML = '<main><article></article></main>'; window.history.replaceState(null, '', '/?path=new.go&view=file-history'); });
const target = (): HTMLElement => document.querySelector('article')!;

describe('file Git views', () => {
  it('swaps and promotes complete pane states without mixing revisions or comparison bases', () => {
    const url = new URL('http://localhost/?path=a.md&view=file-history&commit=abc&revision-path=old.md&revision-view=source&source=1&base=def&right=b.go&right-view=blame&right-source=1');
    const swapped = swapFilePanes(url);
    expect(swapped.searchParams.get('path')).toBe('b.go'); expect(swapped.searchParams.get('view')).toBe('blame');
    expect(swapped.searchParams.get('right-commit')).toBe('abc'); expect(swapped.searchParams.get('right-revision-path')).toBe('old.md');
    expect(swapped.searchParams.get('right-revision-view')).toBe('source'); expect(swapped.searchParams.get('right-base')).toBe('def');
    expect(swapFilePanes(swapped).searchParams.toString()).not.toBe('');
    for (const [key, value] of url.searchParams) expect(swapFilePanes(swapped).searchParams.get(key)).toBe(value);
    const only = rightOnlyURL(url);
    expect(only.searchParams.get('path')).toBe('b.go'); expect(only.searchParams.get('view')).toBe('blame');
    expect([...only.searchParams.keys()].some((key) => key === 'right' || key.startsWith('right-'))).toBe(false);
    const file = fileViewURL(url, 'left', 'file');
    expect(file.searchParams.has('commit')).toBe(false); expect(file.searchParams.get('right-view')).toBe('blame');
  });
  it('keeps unchanged history nodes, scroll and keyboard focus on refresh', async () => {
    const view = new FileGitView(target(), 'left', async <T>() => history as T, () => {});
    await view.refresh('new.go');
    const link = target().querySelector<HTMLAnchorElement>('.file-history-list a')!; link.focus();
    const main = document.querySelector('main')!; main.scrollTop = 150;
    await view.refresh('new.go');
    expect(target().querySelector('a')).toBe(link); expect(document.activeElement).toBe(link); expect(main.scrollTop).toBe(150);
    expect(target().querySelector('script')).toBeNull(); expect(target().textContent).toContain(commit.subject);
  });
  it('retains the other pane current selection when following an older rendered link', async () => {
    for (const pane of ['left', 'right'] as const) {
      window.history.replaceState(null, '', '/?path=new.go&view=file-history&right=b.go&right-view=file-history');
      let selected: URL | undefined;
      const view = new FileGitView(target(), pane, async <T>() => history as T, (url) => { selected = url; });
      await view.refresh(pane === 'left' ? 'new.go' : 'b.go');
      const current = new URL(location.href);
      current.searchParams.set(pane === 'left' ? 'right-view' : 'view', 'blame');
      window.history.replaceState(null, '', current);
      target().querySelector<HTMLAnchorElement>('.file-history-list a')!.click();
      expect(selected?.searchParams.get(pane === 'left' ? 'right-view' : 'view')).toBe('blame');
      expect(selected?.searchParams.get(pane === 'left' ? 'commit' : 'right-commit')).toBe(id);
    }
  });
  it('discards a delayed response after a different file is selected', async () => {
    let resolve!: (value: FileHistoryPage) => void;
    const view = new FileGitView(target(), 'left', <T>() => new Promise<FileHistoryPage>((done) => { resolve = done; }) as Promise<T>, () => {});
    const refresh = view.refresh('new.go');
    window.history.replaceState(null, '', '/?path=another.go'); target().textContent = 'another file';
    resolve(history); await refresh;
    expect(target().textContent).toBe('another file');
  });
  it('renders working line attribution safely and links to the original revision path', async () => {
    window.history.replaceState(null, '', '/?path=new.go&view=blame');
    let selected: URL | undefined;
    const view = new FileGitView(target(), 'left', async <T>() => blame as T, (url) => { selected = url; });
    await view.refresh('new.go');
    expect(target().querySelectorAll('tbody tr')).toHaveLength(2); expect(target().textContent).toContain('Uncommitted'); expect(target().querySelector('script')).toBeNull();
    target().querySelector<HTMLAnchorElement>('tbody a')!.click();
    expect(selected?.searchParams.get('path')).toBe('new.go'); expect(selected?.searchParams.get('revision-path')).toBe('old.go'); expect(selected?.searchParams.get('revision-view')).toBe('source');
  });
  it('opens safe attribution details once per commit group and restores keyboard focus', async () => {
    window.history.replaceState(null, '', '/?path=new.go&view=blame');
    const reply = { ...blame, lines: [blame.lines[0], { ...blame.lines[0], line: 2 }, { ...blame.lines[1], line: 3 }] };
    const view = new FileGitView(target(), 'left', async <T>() => reply as T, () => {});
    await view.refresh('new.go');
    const button = target().querySelector<HTMLButtonElement>('.blame-details-button')!;
    expect(target().querySelectorAll('.blame-details-button')).toHaveLength(1);
    expect(button.getAttribute('aria-label')).toBe('Last change details for line 1');
    expect(button.getAttribute('aria-haspopup')).toBe('dialog');
    const dialog = target().querySelector<HTMLDialogElement>('dialog')!;
    dialog.showModal = () => { dialog.open = true; };
    dialog.close = () => { dialog.open = false; dialog.dispatchEvent(new Event('close')); };
    button.click();
    expect(dialog.open).toBe(true); expect(dialog.textContent).toContain('<Author>');
    expect(dialog.textContent).toContain(commit.subject); expect(dialog.textContent).toContain('old.go');
    expect(dialog.querySelector('script')).toBeNull(); expect(document.activeElement).toBe(dialog.querySelector('button'));
    dialog.querySelector<HTMLButtonElement>('button')!.click();
    expect(dialog.open).toBe(false); expect(document.activeElement).toBe(button);
    button.click(); view.invalidate(); expect(dialog.open).toBe(false);
  });
  it('caches historical source until HEAD changes and explains deleted or binary revisions', async () => {
    window.history.replaceState(null, '', `/?path=new.go&view=file-history&commit=${id}&revision-path=old.go&revision-view=source`);
    let requests = 0; let head = id;
    const view = new FileGitView(target(), 'left', async <T>(url: string) => {
      if (url.includes('file-history')) return { ...history, head } as T;
      requests++; return { ...commit, kind: 'missing', content: '', html: '' } as T;
    }, () => {});
    await view.refresh('new.go'); await view.refresh('new.go');
    expect(requests).toBe(1); expect(target().textContent).toContain('does not exist');
    head = 'b'.repeat(40); await view.refresh('new.go'); expect(requests).toBe(2);
  });
  it('loads older commits at the pinned HEAD and resets pagination after a new HEAD', async () => {
    let head = id;
    const view = new FileGitView(target(), 'left', async <T>(url: string) => url.includes('offset=50')
      ? { ...history, head, commits: [{ ...commit, id: 'b'.repeat(40), subject: 'older' }] } as T
      : { ...history, head, nextOffset: 50 } as T, () => {});
    await view.refresh('new.go'); target().querySelector<HTMLButtonElement>('.history-more')!.click();
    await new Promise((done) => setTimeout(done, 0));
    expect(target().querySelectorAll('.file-history-list li')).toHaveLength(2);
    await view.refresh('new.go'); expect(target().querySelectorAll('.file-history-list li')).toHaveLength(2);
    head = 'c'.repeat(40); await view.refresh('new.go'); expect(target().querySelectorAll('.file-history-list li')).toHaveLength(1);
  });
  it('explains Git availability, empty files, and source size failures', async () => {
    window.history.replaceState(null, '', '/?path=new.go&view=blame');
    let response: BlameReply = { ...blame, available: false, reason: 'git_unavailable' };
    const view = new FileGitView(target(), 'left', async <T>() => response as T, () => {});
    await view.refresh('new.go'); expect(target().textContent).toContain('Git was not found');
    response = { ...blame, lines: [] }; await view.refresh('new.go'); expect(target().textContent).toContain('empty');
    const failed = new FileGitView(target(), 'left', async () => { throw { code: 'too_large' }; }, () => {});
    await failed.refresh('new.go'); expect(target().textContent).toContain('size limit');
  });
});
