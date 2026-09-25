// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { ReviewState } from '../src/review';
import type { ChangesReply } from '../src/diff';

const listing = (rootId: string, changes: { path: string; revision: string }[]): ChangesReply => ({
  available: true, rootId,
  changes: changes.map((change) => ({ ...change, status: 'modified' })),
});

beforeEach(() => localStorage.clear());

describe('review state', () => {
  it('persists unchanged files, resets edited files, and drops files no longer changed', () => {
    const state = new ReviewState();
    const first = listing('root-a', [{ path: 'a.md', revision: 'a1' }, { path: 'b.md', revision: 'b1' }]);
    state.sync(first);
    state.set('a.md', 'a1', true);
    state.set('b.md', 'b1', true);
    const reloaded = new ReviewState();
    reloaded.sync(first);
    expect(reloaded.has('a.md', 'a1')).toBe(true);
    expect(reloaded.has('b.md', 'b1')).toBe(true);
    expect(reloaded.sync(first)).toBe(false);
    reloaded.sync(listing('root-a', [{ path: 'a.md', revision: 'a2' }]));
    expect(reloaded.has('a.md', 'a2')).toBe(false);
    reloaded.sync(first);
    expect(reloaded.has('b.md', 'b1')).toBe(false);
  });

  it('keeps review state separate for each browsing root', () => {
    const state = new ReviewState();
    const first = listing('root-a', [{ path: 'same.md', revision: 'same' }]);
    const second = listing('root-b', [{ path: 'same.md', revision: 'same' }]);
    state.sync(first); state.set('same.md', 'same', true);
    state.sync(second);
    expect(state.has('same.md', 'same')).toBe(false);
    state.sync(first);
    expect(state.has('same.md', 'same')).toBe(true);
  });

  it('stores file names that match JavaScript object properties', () => {
    const state = new ReviewState();
    const changes = listing('root', [{ path: '__proto__', revision: 'v1' }]);
    state.sync(changes);
    state.set('__proto__', 'v1', true);
    const reloaded = new ReviewState();
    reloaded.sync(changes);
    expect(reloaded.has('__proto__', 'v1')).toBe(true);
  });
});
