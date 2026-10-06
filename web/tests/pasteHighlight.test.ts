// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { highlightMarkdown, maxHighlightBytes } from '../src/pasteHighlight';
const element = (text: string): HTMLDivElement => { const div = document.createElement('div'); div.innerHTML = highlightMarkdown(text); return div; };
describe('source-preserving Markdown highlight', () => {
  it.each([
    ['# Heading', 'heading'], ['###### 日本語', 'heading'], ['**strong** __strong__', 'strong'], ['*em* _em_', 'emphasis'], ['~~gone~~', 'strike'],
    ['`<code>`', 'inline-code'], ['- item\n1. numbered', 'list-marker'], ['- [ ] todo', 'task'], ['- [x] done', 'completed'],
    ['> quote', 'quote'], ['[text](https://example.com)', 'link'], ['![alt](image.png)', 'url'], ['<https://example.com>', 'url'],
    ['---\n***\n___', 'marker'], ['| a | b |\n|---|---|', 'marker'], ['$x$\n$$\nx + y\n$$', 'math'], ['<!-- comment\nmore -->', 'comment'],
  ])('recognizes %s', (text, kind) => { const div = element(text); expect(div.querySelector(`.paste-${kind}`)).not.toBeNull(); expect(div.textContent).toBe(text); });
  it('does not parse other syntax in fences and respects fence lengths and characters', () => {
    const div = element('````md\n# Heading **bold**\n```\n~~~\n````\n# Outside');
    expect(div.querySelectorAll('.paste-heading')).toHaveLength(1);
    expect(div.querySelector('.paste-strong')).toBeNull();
    expect(div.querySelectorAll('.paste-code-block')).toHaveLength(3);
    expect(element('~~~js\n- [x] nope\n~~~').querySelector('.paste-task')).toBeNull();
  });
  it('recognizes CRLF headings and fences while retaining their source endings', () => {
    const html = highlightMarkdown('# Heading\r\n```md\r\n**literal**\r\n```\r\n');
    expect(html).toContain('paste-heading'); expect(html).toContain('paste-code-block'); expect(html).not.toContain('paste-strong');
  });
  it('escapes HTML, attribute delimiters, and ampersands in every context', () => {
    const text = '# <script>alert("x")</script> & \'\n[<img onerror="bad">]("url")\n```\n</span><script>bad</script>\n```';
    const html = highlightMarkdown(text); const div = element(text);
    expect(html).toContain('&lt;script&gt;'); expect(html).toContain('&quot;'); expect(html).toContain('&amp;'); expect(html).toContain('&#39;');
    expect(div.querySelector('script,img')).toBeNull(); expect(div.textContent).toBe(text);
    expect([...div.querySelectorAll('*')].every((node) => node.tagName === 'SPAN' && node.attributes.length === 1)).toBe(true);
  });
  it.each(['', '\n', '# h\n', '# h\r\n\r\n- [x] done\r\n', '日本語🙂\ttext\n\n', '<!--\nabc\n-->tail'])('preserves all source characters and line endings: %j', (text) => {
    // HTML parsing normalizes CRLF; test the pure HTML output by decoding only
    // generated tags/entities so that CRLF preservation is tested independently.
    const decoded = highlightMarkdown(text).replace(/<\/?span(?: class="[^"]+")?>/g, '').replace(/&(amp|lt|gt|quot|#39);/g, (entity) => ({ '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" })[entity]!);
    expect(decoded).toBe(text);
  });
  it('falls back to escaped plain text above the UTF-8 byte threshold', () => {
    const text = '# 日本語\n'.repeat(Math.ceil(maxHighlightBytes / 5));
    expect(highlightMarkdown(text)).not.toContain('<span');
    expect(highlightMarkdown('a'.repeat(maxHighlightBytes) + '<')).toContain('&lt;');
  });
});
