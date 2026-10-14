// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Node, Page, TreeView } from '../src/tree';

const node = (path: string, type: 'file' | 'directory' = 'file'): Node => ({ path, name: path.split('/').at(-1)!, type });
const page = (entries: Node[], revision = '1', offset = 0, nextOffset: number | null = null): Page =>
  ({ entries, revision, offset, nextOffset, root: 'project' });
let view: TreeView;
let tree: HTMLElement;
let search: HTMLInputElement;
let selected: string;
let onOpen: ReturnType<typeof vi.fn>;
let onPage: ReturnType<typeof vi.fn>;
const rows = (): HTMLElement[] => [...tree.querySelectorAll<HTMLElement>('summary, a, button[data-dir]')];
const key = (key: string, options: KeyboardEventInit = {}): void => {
  document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...options }));
};
beforeEach(async () => {
  vi.resetModules(); localStorage.clear(); sessionStorage.clear(); selected = '';
  document.body.innerHTML = '<input id="search"><button id="collapse">Collapse</button><span id="count"></span><nav id="tree"></nav><button id="outside">Outside</button>';
  tree = document.querySelector('#tree')!; search = document.querySelector('#search')!;
  onOpen = vi.fn(); onPage = vi.fn();
  const { TreeView } = await import('../src/tree');
  view = new TreeView(tree, search, document.querySelector('#count')!, document.querySelector('#collapse')!, () => selected, onOpen, onPage, vi.fn());
  view.setPage('', page([node('docs', 'directory'), node('a.md'), node('b.md')]));
});

describe('file tree keyboard navigation', () => {
  it('navigates folders and files without activating them and stops at the ends', () => {
    const activate = vi.fn(); tree.addEventListener('click', activate);
    rows()[0].focus(); key('ArrowUp'); expect(document.activeElement).toBe(rows()[0]);
    key('ArrowDown'); expect(document.activeElement).toBe(rows()[1]);
    key('End'); expect(document.activeElement).toBe(rows()[2]);
    key('ArrowDown'); expect(document.activeElement).toBe(rows()[2]);
    key('Home'); expect(document.activeElement).toBe(rows()[0]); expect(activate).not.toHaveBeenCalled();
  });

  it('opens lazy folders, enters nested children, and goes back to the parent', () => {
    rows()[0].focus(); key('ArrowRight'); expect(onOpen).toHaveBeenCalledWith('docs');
    expect(document.activeElement).toBe(rows()[0]);
    view.setLoading('docs', true); key('ArrowRight'); expect(document.activeElement).toBe(rows()[0]);
    view.setPage('docs', page([node('docs/deep', 'directory'), node('docs/a.md')]));
    key('ArrowRight'); expect(document.activeElement).toBe(rows()[1]);
    key('ArrowLeft'); expect(document.activeElement).toBe(rows()[0]);
    key('ArrowRight'); key('ArrowDown'); key('ArrowLeft'); expect(document.activeElement).toBe(rows()[0]);
    key('ArrowLeft'); expect(tree.querySelector('details')?.open).toBe(false);
    expect(document.activeElement).toBe(rows()[0]); expect(rows()).toHaveLength(3);
  });

  it('keeps only the current row and its right button in the Tab sequence', () => {
    expect(rows().filter((row) => row.tabIndex === 0)).toHaveLength(1);
    rows()[1].focus();
    expect(rows().filter((row) => row.tabIndex === 0)).toEqual([rows()[1]]);
    const right = rows()[1].nextElementSibling as HTMLButtonElement;
    expect(right.tabIndex).toBe(0); expect(tree.querySelectorAll('.open-right[tabindex="0"]')).toHaveLength(1);
    right.focus(); key('ArrowDown'); expect(document.activeElement).toBe(rows()[2]);
    const outside = document.querySelector<HTMLButtonElement>('#outside')!; outside.focus(); view.render();
    expect(document.activeElement).toBe(outside); expect(rows()[2].tabIndex).toBe(0);
  });

  it('retains an entry point while an unrelated folder control has focus', () => {
    const details = document.createElement('details');
    const summary = document.createElement('summary'); summary.textContent = 'Search contents';
    details.append(summary); tree.before(details); summary.focus(); view.render();
    expect(document.activeElement).toBe(summary);
    expect(rows()[0].tabIndex).toBe(0);
  });

  it('restores row and right-button focus on refresh without stealing outside focus', () => {
    rows()[1].focus(); view.setPage('', page([node('docs', 'directory'), node('a.md'), node('b.md')], '2'));
    expect(document.activeElement).toBe(rows()[1]);
    (rows()[1].nextElementSibling as HTMLButtonElement).focus(); view.render();
    expect(document.activeElement).toBe(rows()[1].nextElementSibling);
    document.querySelector<HTMLButtonElement>('#outside')!.focus(); view.setLoading('docs', true);
    expect(document.activeElement?.id).toBe('outside');
  });

  it('falls back to a parent, nearby row, and search when focused entries disappear', () => {
    rows()[0].focus(); key('ArrowRight'); view.setPage('docs', page([node('docs/a.md')]));
    rows()[1].focus(); view.setPage('docs', page([], '2'));
    expect(document.activeElement).toBe(rows()[0]);
    rows()[2].focus(); view.setPage('', page([node('docs', 'directory'), node('a.md')], '2'));
    expect(document.activeElement).toBe(rows()[1]);
    view.setPage('', page([], '3')); expect(document.activeElement).toBe(search);
  });

  it('focuses new page entries only when focus remained on the loading button', () => {
    view.setPage('', page([node('a.md')], '2', 0, 200));
    rows()[1].focus(); key('Enter'); expect(onPage).toHaveBeenCalledWith('', 200);
    view.setPage('', page([node('b.md')], '2', 200, 400)); expect(document.activeElement).toBe(rows()[1]);
    rows()[2].focus(); key('Enter'); document.querySelector<HTMLButtonElement>('#outside')!.focus();
    view.setPage('', page([node('c.md')], '2', 400)); expect(document.activeElement?.id).toBe('outside');
  });

  it('allows retrying a page after failure without losing the button', () => {
    view.setPage('', page([node('a.md')], '2', 0, 200)); rows()[1].focus(); key('Enter');
    view.setLoading('', false); view.render(); expect(document.activeElement).toBe(rows()[1]);
    key('Enter'); expect(onPage).toHaveBeenCalledTimes(2);
  });

  it('search arrows enter first/last results and Escape clears search locally', () => {
    view.setSearchIndex(['a.md', 'b.md'], 'ready'); search.value = '.md'; search.dispatchEvent(new Event('input'));
    const global = vi.fn(); document.body.addEventListener('keydown', global);
    search.focus(); key('ArrowUp'); expect(document.activeElement).toBe(rows().at(-1));
    key('ArrowRight'); expect(document.activeElement).toBe(rows().at(-1));
    key('Escape'); expect(search.value).toBe(''); expect(document.activeElement).toBe(search);
    expect(global).not.toHaveBeenCalled();
  });

  it('ignores composition and modified arrows', () => {
    rows()[0].focus();
    for (const options of [{ isComposing: true }, { keyCode: 229 }, { ctrlKey: true }, { altKey: true }, { shiftKey: true }, { metaKey: true }]) key('ArrowDown', options);
    expect(document.activeElement).toBe(rows()[0]);
  });

  it('collapses selected ancestors through refresh and reload, and reveals a new selection', async () => {
    selected = 'docs/a.md'; view.render(); view.setPage('docs', page([node('docs/a.md')]));
    rows()[0].focus(); key('ArrowLeft'); expect(tree.querySelector('details')?.open).toBe(false);
    expect(view.shouldLoadSelectedPath(selected)).toBe(false); view.render();
    expect(tree.querySelector('details')?.open).toBe(false);
    vi.resetModules(); const { TreeView } = await import('../src/tree');
    const reloaded = new TreeView(tree, search, document.querySelector('#count')!, document.querySelector('#collapse')!, () => selected, vi.fn(), vi.fn(), vi.fn());
    reloaded.setPage('', page([node('docs', 'directory')])); expect(tree.querySelector('details')?.open).toBe(false);
    selected = 'docs/b.md'; reloaded.render(); expect(tree.querySelector('details')?.open).toBe(true);
    reloaded.revealDirectory('docs'); expect(document.activeElement).toBe(rows()[0]);
  });
});
