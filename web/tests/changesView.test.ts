// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createChangesView } from '../src/changesView';
import type { CommitDetail } from '../src/history';

beforeEach(() => { localStorage.clear(); document.body.innerHTML = '<main><header></header><article></article><nav></nav></main><aside><button></button><section></section><section></section></aside>'; });
afterEach(() => { document.body.replaceChildren(); });

function setup(mode: 'changes' | 'history' = 'changes') {
  history.replaceState(null, '', `/?view=${mode}`);
  const content = document.querySelector('article')!; const title = document.querySelector('header')!;
  const changesTree = document.querySelectorAll('section')[0]; const historyTree = document.querySelectorAll('section')[1];
  const changesTab = document.querySelector('aside button') as HTMLButtonElement;
  let displayedHTML = '';
  const getGit = vi.fn<(url: string) => Promise<unknown>>().mockResolvedValue({ available: false, commits: [], nextOffset: null });
  const controller = createChangesView({
    content, title, outline: document.querySelector('nav')!, main: document.querySelector('main')!,
    changesTree, historyTree, changesTab, sidebar: document.querySelector('aside')!, sidebarToggle: changesTab,
    view: { revealDirectory: vi.fn() }, tabTitle: { setFallback: vi.fn() },
    contentWidth: { createButton: () => document.createElement('button') },
    preview: { hasInteractive: () => false, setInteractive: vi.fn() }, printView: { open: vi.fn() },
    selected: () => '', selectedMode: () => mode, selectedBase: () => '',
    getSourceMode: () => false, setSourceMode: vi.fn(), getRememberedBase: () => '', getRootName: () => 'project',
    getDisplayedHTML: () => displayedHTML, setDisplayedHTML: (html) => { displayedHTML = html; },
    getDisplayedPath: () => '', getDisplayedMode: () => mode, showFiles: vi.fn(), selectFileView: vi.fn(),
    navigate: vi.fn(), openRight: vi.fn(), openPDF: vi.fn(), downloadFile: vi.fn(), requestRefresh: vi.fn(),
    getGit: async <T>(url: string) => await getGit(url) as T,
  });
  return { controller, content, changesTree, changesTab, getGit };
}

it('synchronizes review controls and unreviewed counts across the sidebar and content', () => {
  const { controller, content, changesTree, changesTab } = setup();
  controller.acceptChanges({ available: true, rootId: 'repo', changes: [
    { path: 'a.md', status: 'modified', revision: 'v1' }, { path: 'b.md', status: 'added', revision: 'v2' },
  ] });
  expect(changesTab.getAttribute('aria-label')).toBe('Changes, 2 unreviewed');
  content.querySelector<HTMLButtonElement>('.review-toggle')!.click();
  expect(changesTab.getAttribute('aria-label')).toBe('Changes, 1 unreviewed');
  expect(changesTree.querySelector('.review-toggle')?.getAttribute('aria-pressed')).toBe('true');
  expect(controller.diffNeighbor('a.md', 1, true)?.path).toBe('b.md');
  controller.failComparison();
  expect(changesTree.textContent).toBe('Cannot load this comparison.');
  expect(controller.currentChanges).toBeUndefined();
});

it('invalidates cached commit details when the history head changes', async () => {
  const { controller, getGit } = setup('history');
  const commit: CommitDetail = { id: 'a'.repeat(40), subject: 'Initial', author: 'Author', date: '2026-11-01', message: 'Initial', files: [] };
  controller.mergeHistory({ available: true, head: 'head-one', commits: [commit], nextOffset: null });
  controller.renderHistory(commit.id, '', commit, undefined, true);
  expect(await controller.getCommit(commit.id, 'head-one')).toBe(commit);
  expect(getGit).not.toHaveBeenCalled();
  expect(controller.mergeHistory({ available: true, head: 'head-two', commits: [commit], nextOffset: null }, 'head-one')).toBe(true);
  await controller.getCommit(commit.id, 'head-two');
  expect(getGit).toHaveBeenCalledWith(`/api/git/commit?id=${commit.id}`);
});
