// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { renderChanges, reviewButton, summarizeChanges, type Change, type ChangesReply } from '../src/diff';

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
