// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { gitStatusIndicator, renderChanges, renderDiff, reviewButton, summarizeChanges, type Change, type ChangesReply } from '../src/diff';

const changes: Change[] = [
  { path: 'a.md', status: 'modified', revision: 'a1', added: 3, deleted: 1 },
  { path: 'docs/b.md', status: 'added', revision: 'b1', added: 10, deleted: 0 },
  { path: 'c.png', status: 'modified', revision: 'c1', added: null, deleted: null },
];
const reply: ChangesReply = { available: true, rootId: 'r', changes };
const render = (compact: boolean, reviewed: string[] = []): HTMLElement => {
  const target = document.createElement('div');
  renderChanges(target, reply, (change) => reviewed.includes(change.path), () => {}, false, () => {}, false, () => {}, new Set(), () => {}, compact);
  return target;
};

describe('changes overview', () => {
  it.each([false, true])('preserves two status columns in tree and flat lists (compact=%s)', (compact) => {
    const codes = ['M ', ' M', 'MM', 'A ', 'AM', 'AD', ' D', 'D ', '??', 'UU', 'AU', 'DU', 'DD', 'UA', 'UD', 'AA', ' T'];
    const stagedReply: ChangesReply = { ...reply, base: 'abc1234', changes: codes.map((code, index) => ({ ...changes[0], path: `docs/${index}.md`, gitStatuses: [code] })) };
    for (const tree of [false, true]) {
      const target = document.createElement('div');
      renderChanges(target, stagedReply, () => false, () => {}, false, () => {}, tree, () => {}, new Set(), () => {}, compact);
      expect([...target.querySelectorAll('.git-status')].map((badge) => badge.textContent).sort()).toEqual([...codes].sort());
      expect(target.querySelector('.git-status')?.getAttribute('title')).toContain('regardless of comparison base');
      expect(target.querySelector('.change-status, .change-staging')).toBeNull();
      expect(target.querySelector('a')?.href).toContain('base=abc1234');
    }
  });

  it('colors columns independently and explains clean, conflict and multiple statuses', () => {
    const mixed = gitStatusIndicator({ ...changes[0], gitStatuses: ['MM'] });
    expect(mixed.querySelector('.git-status-index')?.textContent).toBe('M');
    expect(mixed.querySelector('.git-status-worktree')?.textContent).toBe('M');
    expect(mixed.getAttribute('aria-label')).toContain('Staged: Modified; unstaged: Modified');
    const untracked = gitStatusIndicator({ ...changes[0], gitStatuses: ['??'] });
    expect(untracked.querySelectorAll('.git-status-worktree')).toHaveLength(2);
    const clean = gitStatusIndicator({ ...changes[0], gitStatuses: [] });
    expect(clean.textContent).toBe('  ');
    expect(clean.getAttribute('aria-label')).toContain('No local changes. Compared with base: Modified');
    const conflict = gitStatusIndicator({ ...changes[0], gitStatuses: ['DU'] });
    expect(conflict.getAttribute('aria-label')).toContain('Conflict (DU): deleted by us');
    const multiple = gitStatusIndicator({ ...changes[0], gitStatuses: ['D ', '??'] });
    expect([...multiple.querySelectorAll('.git-status-code')].map((pair) => pair.textContent)).toEqual(['D ', '??']);
    expect(multiple.querySelectorAll('[aria-hidden="true"]')).toHaveLength(2);
  });

  it('explains an empty combined diff', () => {
    const target = document.createElement('div');
    renderDiff(target, { path: 'a.md', kind: 'text', patch: '' });
    expect(target.textContent).toBe('No net changes against the comparison base.');
    expect(target.querySelector('.diff-frame')).toBeNull();
  });
  it('totals files, lines and reviewed files, treating binary files as zero lines', () => {
    expect(summarizeChanges(changes, (change) => change.path === 'a.md')).toEqual({ files: 3, added: 13, deleted: 1, reviewed: 1 });
  });

  it('shows a summary and progress bar in the main view only', () => {
    const body = render(false, ['a.md']);
    expect(body.querySelector('.change-summary strong')?.textContent).toBe('3 files changed');
    expect(body.querySelector('.change-summary .change-lines')?.textContent).toBe('+13 −1');
    const bar = body.querySelector<HTMLElement>('.review-progress')!;
    expect(bar.getAttribute('aria-valuenow')).toBe('1'); expect(bar.getAttribute('aria-valuemax')).toBe('3');
    expect(render(true).querySelector('.change-summary')).toBeNull();
  });

  it('labels the review button in the main view and keeps the sidebar icon-only', () => {
    expect(render(false).querySelector('.review-toggle')?.textContent).toBe('Mark reviewed');
    expect(render(false, ['a.md']).querySelector('.review-toggle')?.textContent).toBe('Reviewed');
    const compact = render(true).querySelector<HTMLButtonElement>('.review-toggle')!;
    expect(compact.textContent).toBe(''); expect(compact.title).toBe('Mark reviewed');
    expect(reviewButton(changes[0], false, () => {}).textContent).toBe('');
  });
});
