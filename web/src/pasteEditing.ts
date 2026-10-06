export type TextEdit = { start: number; end: number; text: string; selectionStart: number; selectionEnd: number };
export function continueList(value: string, start: number, end: number): TextEdit | undefined {
  if (start !== end || (start < value.length && value[start] !== '\n')) return;
  const lineStart = start > 0 ? value.lastIndexOf('\n', start - 1) + 1 : 0;
  const line = value.slice(lineStart, start);
  const item = /^(\s*)([-*+]|\d+[.)])(\s+)(\[[ xX]\]\s+)?(.*)$/.exec(line);
  if (!item) return;
  if (!item[5].trim()) return { start: lineStart, end, text: item[1], selectionStart: lineStart + item[1].length, selectionEnd: lineStart + item[1].length };
  const marker = /^\d/.test(item[2]) ? `${Number.parseInt(item[2]) + 1}${item[2].slice(-1)}` : item[2];
  const text = `\n${item[1]}${marker}${item[3]}${item[4] ? '[ ] ' : ''}`;
  return { start, end, text, selectionStart: start + text.length, selectionEnd: start + text.length };
}
export function indentLines(value: string, start: number, end: number, unindent: boolean): TextEdit {
  const first = start > 0 ? value.lastIndexOf('\n', start - 1) + 1 : 0;
  // A selection ending at the start of a line does not select that line.
  const selectedEnd = end > start && value[end - 1] === '\n' ? end - 1 : end;
  const next = value.indexOf('\n', selectedEnd);
  const last = next < 0 ? value.length : next;
  let offset = first; let startDelta = 0; let endDelta = 0;
  const text = value.slice(first, last).split('\n').map((line) => {
    const remove = unindent ? (/^(?: {1,2}|\t)/.exec(line)?.[0].length ?? 0) : 0;
    const delta = unindent ? -remove : 2;
    if (offset <= start) startDelta += unindent ? -Math.min(remove, start - offset) : delta;
    if (offset < end || start === end) endDelta += unindent ? -Math.min(remove, Math.max(0, end - offset)) : delta;
    offset += line.length + 1;
    return unindent ? line.slice(remove) : `  ${line}`;
  }).join('\n');
  return { start: first, end: last, text, selectionStart: start + startDelta, selectionEnd: end + endDelta };
}
export function applyTextEdit(input: HTMLTextAreaElement, edit: TextEdit): void {
  input.focus(); input.setSelectionRange(edit.start, edit.end);
  // Chromium's native editing command preserves Undo/Redo. setRangeText is the
  // fallback for engines that do not implement this command on textareas.
  let inserted = false;
  try { inserted = document.execCommand('insertText', false, edit.text); } catch { /* Use native range replacement below. */ }
  if (!inserted) input.setRangeText(edit.text, edit.start, edit.end, 'end');
  input.setSelectionRange(edit.selectionStart, edit.selectionEnd);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}
