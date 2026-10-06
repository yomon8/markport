import { describe, expect, it } from 'vitest';
import { continueList, indentLines } from '../src/pasteEditing';
const apply = (value: string, edit: ReturnType<typeof indentLines>): string => value.slice(0, edit.start) + edit.text + value.slice(edit.end);
describe('lightweight paste edits', () => {
  it.each([['- item', '\n- '], ['  + item', '\n  + '], ['9. item', '\n10. '], ['2) item', '\n3) '], ['- [x] done', '\n- [ ] ']])('continues %s', (value, suffix) => {
    const edit = continueList(value, value.length, value.length)!;
    expect(apply(value, edit)).toBe(value + suffix); expect(edit.selectionStart).toBe(value.length + suffix.length);
  });
  it('exits empty lists, including empty tasks', () => {
    for (const value of ['- ', '- [ ] ', '- [x] ']) { const edit = continueList(value, value.length, value.length)!; expect(apply(value, edit)).toBe(''); }
  });
  it('leaves selections, non-list lines, and the middle of a line to native Enter', () => {
    expect(continueList('- text', 3, 3)).toBeUndefined(); expect(continueList('- text', 0, 6)).toBeUndefined(); expect(continueList('# heading', 9, 9)).toBeUndefined();
  });
  it('indents only the selected lines and preserves the selection', () => {
    const value = 'one\ntwo\nthree'; const edit = indentLines(value, 1, 8, false);
    expect(apply(value, edit)).toBe('  one\n  two\nthree'); expect(edit.selectionStart).toBe(3); expect(edit.selectionEnd).toBe(12);
  });
  it('unindents up to two spaces or one tab without touching content', () => {
    const value = '  one\n two\n\tthree\nfour'; const edit = indentLines(value, 0, value.length, true);
    expect(apply(value, edit)).toBe('one\ntwo\nthree\nfour'); expect(edit.selectionStart).toBe(0); expect(edit.selectionEnd).toBe(value.length - 4);
  });
  it('indents the empty first line when the draft starts with a newline', () => {
    expect(apply('\ntext', indentLines('\ntext', 0, 0, false))).toBe('  \ntext');
  });
  it('indents a collapsed caret and does not select the next line at a newline boundary', () => {
    const value = 'one\ntwo'; expect(apply(value, indentLines(value, 4, 4, false))).toBe('one\n  two');
    expect(apply(value, indentLines(value, 0, 4, false))).toBe('  one\ntwo');
  });
});
