// A deliberately small, source-preserving Markdown highlighter. No pasted HTML
// is interpreted; every span and class is generated here.
export const maxHighlightBytes = 200 * 1024;
export const maxPasteBytes = 1 << 20;
export const pasteBytes = (text: string): number => new TextEncoder().encode(text).length;
export function escapePasteText(text: string): string {
  return text.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
}
const span = (kind: string, text: string): string => `<span class="paste-${kind}">${escapePasteText(text)}</span>`;
// Cache closing delimiter searches so incomplete markup remains linear even
// in a single long line with thousands of unmatched opening markers.
function inline(text: string): string {
  let html = ''; let plain = 0; let index = 0;
  const closings = new Map<string, number>();
  const find = (delimiter: string, from: number): number => {
    const previous = closings.get(delimiter);
    if (previous === -1 || (previous !== undefined && previous >= from)) return previous;
    const next = text.indexOf(delimiter, from); closings.set(delimiter, next); return next;
  };
  while (index < text.length) {
    let end = index; let markup = ''; let advance = 1;
    if (text.startsWith('<!--', index)) {
      const close = find('-->', index + 4);
      if (close >= 0) { end = close + 3; markup = span('comment', text.slice(index, end)); }
    } else if (text[index] === '[' || text.startsWith('![', index)) {
      const close = find(']', index + (text[index] === '!' ? 2 : 1));
      const urlEnd = close >= 0 && text[close + 1] === '(' ? find(')', close + 2) : -1;
      if (urlEnd >= 0) { end = urlEnd + 1; markup = span('link', text.slice(index, close + 1)) + span('url', text.slice(close + 1, end)); }
    } else if (text.startsWith('<https://', index) || text.startsWith('<http://', index)) {
      const close = find('>', index + 1);
      if (close >= 0) { end = close + 1; markup = span('url', text.slice(index, end)); }
    } else if (text[index] === '|') { end = index + 1; markup = span('marker', '|'); }
    else if ('`*_$~'.includes(text[index])) {
      const char = text[index];
      let delimiter = char;
      if (char === '`') { while (text[index + delimiter.length] === '`') delimiter += '`'; advance = delimiter.length; }
      else if (text[index + 1] === char) delimiter += char;
      if (char !== '~' || delimiter === '~~') {
        const close = find(delimiter, index + delimiter.length);
        if (close > index + delimiter.length) {
          end = close + delimiter.length;
          const kind = char === '`' ? 'inline-code' : char === '$' ? 'math' : char === '~' ? 'strike' : delimiter.length === 2 ? 'strong' : 'emphasis';
          markup = span(kind, text.slice(index, end));
        }
      }
    }
    if (markup) { html += escapePasteText(text.slice(plain, index)) + markup; index = end; plain = end; }
    else index += advance;
  }
  return html + escapePasteText(text.slice(plain));
}
export function highlightMarkdown(text: string): string {
  if (pasteBytes(text) > maxHighlightBytes) return escapePasteText(text);
  let fence: { char: string; length: number } | undefined;
  let comment = false; let math = false;
  return text.split('\n').map((line) => {
    if (fence) {
      const close = /^ {0,3}(`{3,}|~{3,})\s*$/.exec(line);
      if (close && close[1][0] === fence.char && close[1].length >= fence.length) { fence = undefined; return span('fence', line); }
      return span('code-block', line);
    }
    if (comment) {
      const end = line.indexOf('-->');
      if (end < 0) return span('comment', line);
      comment = false; return span('comment', line.slice(0, end + 3)) + inline(line.slice(end + 3));
    }
    if (math) { if (/^\s*\$\$\s*$/.test(line)) math = false; return span('math', line); }
    const open = /^ {0,3}(`{3,}|~{3,})([^\n]*)$/.exec(line);
    if (open && !(open[1][0] === '`' && open[2].includes('`'))) { fence = { char: open[1][0], length: open[1].length }; return span('fence', line); }
    const commentStart = line.indexOf('<!--');
    if (commentStart >= 0 && line.indexOf('-->', commentStart + 4) < 0) { comment = true; return inline(line.slice(0, commentStart)) + span('comment', line.slice(commentStart)); }
    if (/^\s*\$\$\s*$/.test(line)) { math = true; return span('math', line); }
    if (/^ {0,3}(?:(?:-\s*){3,}|(?:\*\s*){3,}|(?:_\s*){3,})\r?$/.test(line) || /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line)) return span('marker', line);
    const heading = /^( {0,3}#{1,6}\s)([^\n]*)$/.exec(line);
    if (heading) return `<span class="paste-heading">${span('marker', heading[1])}${inline(heading[2])}</span>`;
    const list = /^(\s*(?:[-*+]|\d+[.)])\s+)(\[[ xX]\]\s+)?/.exec(line);
    if (list) {
      const html = span('list-marker', list[1]) + (list[2] ? span('task', list[2]) : '') + inline(line.slice(list[0].length));
      return list[2]?.match(/\[[xX]\]/) ? `<span class="paste-completed">${html}</span>` : html;
    }
    if (/^\s*>/.test(line)) return `<span class="paste-quote">${inline(line)}</span>`;
    return inline(line);
  }).join('\n');
}
