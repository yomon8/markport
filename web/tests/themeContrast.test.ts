import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('../src/themes.css', import.meta.url), 'utf8');
function palette(selector: string): Record<string, string> {
  const block = css.slice(css.indexOf(selector)).split('}')[0];
  return Object.fromEntries([...block.matchAll(/(--[\w-]+): (#[\da-f]+)/g)].map((match) => [match[1], match[2]]));
}
function luminance(hex: string): number {
  let value = hex.slice(1);
  if (value.length === 3) value = [...value].map((digit) => digit + digit).join('');
  const channels = [0, 2, 4].map((offset) => parseInt(value.slice(offset, offset + 2), 16) / 255)
    .map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}
function contrast(a: string, b: string): number {
  const [low, high] = [luminance(a), luminance(b)].sort((a, b) => a - b);
  return (high + 0.05) / (low + 0.05);
}

describe.each(['sepia', 'nord'])('%s contrast', (theme) => {
  const colors = palette(`[data-theme=${theme}]`);
  const pairs: string[][] = [];
  for (const foreground of ['--text', '--text-muted', '--accent']) {
    for (const background of ['--bg', '--surface', '--sidebar', '--hover', '--accent-soft']) pairs.push([foreground, background]);
  }
  pairs.push(['--mark-text', '--mark-bg'], ['--success-text', '--success-bg'], ['--danger', '--danger-bg'],
    ['--text', '--diff-added-bg'], ['--text', '--diff-deleted-bg'], ['--text', '--line-highlight-bg'],
    ['--icon-image', '--sidebar'], ['--icon-code', '--sidebar'],
    ['--syntax-added', '--syntax-added-bg'], ['--syntax-deleted', '--syntax-deleted-bg']);
  if (theme === 'sepia') pairs.push(['--syntax-error-text', '--syntax-deleted']);
  else pairs.push(['--syntax-error-text', '--code-bg']);
  for (const token of Object.keys(colors).filter((name) => name.startsWith('--syntax-') && !name.endsWith('-bg') && name !== '--syntax-error-text')) {
    pairs.push([token, '--code-bg'], [token, '--line-highlight-bg']);
  }
  it('keeps text, syntax, search marks, and diff colors above 4.5:1', () => {
    for (const [foreground, background] of pairs) {
      expect(contrast(colors[foreground], colors[background]), `${foreground} on ${background}`).toBeGreaterThanOrEqual(4.5);
    }
  });
});
