// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
  buildNavigationTarget, classifyInAppLink, fileURL, isLineHash,
  pdfFileURL, selectedBase, selectedMode, selectedPath, sidebarPanelForMode,
} from '../src/navigation';

describe('navigation URL helpers', () => {
  it('parses path, base, mode, and sidebar panel from URLs', () => {
    expect(selectedPath('http://127.0.0.1:3000/?path=docs%2Fa.md')).toBe('docs/a.md');
    expect(selectedBase('http://127.0.0.1:3000/?view=changes&base=abc1234')).toBe('abc1234');
    expect(selectedMode('http://127.0.0.1:3000/')).toBe('file');
    expect(selectedMode('http://127.0.0.1:3000/?view=history')).toBe('history');
    expect(selectedMode('http://127.0.0.1:3000/?view=paste')).toBe('paste');
    expect(selectedMode('http://127.0.0.1:3000/?view=changes')).toBe('changes');
    expect(selectedMode('http://127.0.0.1:3000/?path=a.md&view=blame')).toBe('blame');
    expect(sidebarPanelForMode('history')).toBe('history');
    expect(sidebarPanelForMode('changes')).toBe('changes');
    expect(sidebarPanelForMode('diff')).toBe('changes');
    expect(sidebarPanelForMode('file')).toBe('file');
    expect(fileURL('a/b c.md')).toBe('/?path=a%2Fb%20c.md');
    expect(pdfFileURL('a/b.pdf')).toBe('/api/pdf?path=a%2Fb.pdf');
    expect(isLineHash('#L12')).toBe(true);
    expect(isLineHash('#L12-L34')).toBe(true);
    expect(isLineHash('#heading')).toBe(false);
  });

  it('preserves right pane parameters only when navigating to file-scoped views', () => {
    const current = 'http://127.0.0.1:3000/?path=a.md&right=b.md&right-view=blame&right-source=1';
    const nextFile = buildNavigationTarget('/?path=c.md', current);
    expect(nextFile.searchParams.get('path')).toBe('c.md');
    expect(nextFile.searchParams.get('right')).toBe('b.md');
    expect(nextFile.searchParams.get('right-view')).toBe('blame');
    expect(nextFile.searchParams.get('right-source')).toBe('1');

    const toChanges = buildNavigationTarget('/?view=changes', current);
    expect(toChanges.searchParams.has('right')).toBe(false);
    expect(toChanges.searchParams.has('right-view')).toBe(false);
  });

  it('classifies in-app, same-page hash, and external links', () => {
    const loc = { origin: 'http://127.0.0.1:3000', pathname: '/', search: '?path=a.md' };
    const link = (href: string): HTMLAnchorElement => {
      const a = document.createElement('a');
      a.href = href;
      return a;
    };
    expect(classifyInAppLink(link('http://127.0.0.1:3000/?path=b.md'), loc)).toBe('navigate');
    expect(classifyInAppLink(link('http://127.0.0.1:3000/?view=history'), loc)).toBe('navigate');
    expect(classifyInAppLink(link('http://127.0.0.1:3000/?path=a.md#sec'), loc)).toBe('hash');
    expect(classifyInAppLink(link('https://example.com/?path=b.md'), loc)).toBe('ignore');
    expect(classifyInAppLink(link('http://127.0.0.1:3000/api/download?path=a.md'), loc)).toBe('ignore');
  });
});
