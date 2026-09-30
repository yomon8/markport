// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { searchMatches } from '../src/tree';

describe('search ranking', () => {
  it('lists Git-ignored paths below every other match', () => {
    const paths = ['dist/main', 'web/src/main.ts', 'cmd/markport/main.go', 'dist/deep/main.js', 'a/very/long/nested/folder/for/some/main-utils.ts'];
    const { matches } = searchMatches(paths, 'main', new Set(['dist/main', 'dist/deep/main.js']));
    expect(matches.map((match) => match.path).slice(0, 3).sort()).toEqual(['a/very/long/nested/folder/for/some/main-utils.ts', 'cmd/markport/main.go', 'web/src/main.ts']);
    expect(matches.slice(3).map((match) => match.ignored)).toEqual([true, true]);
  });

  it('keeps ordering unchanged when nothing is ignored', () => {
    const paths = ['b/main.ts', 'main.ts'];
    expect(searchMatches(paths, 'main').matches.map((match) => match.path)).toEqual(['main.ts', 'b/main.ts']);
  });
});
