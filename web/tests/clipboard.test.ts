// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { copyText } from '../src/clipboard';

afterEach(() => {
  Reflect.deleteProperty(navigator, 'clipboard');
  Reflect.deleteProperty(document, 'execCommand');
  document.body.replaceChildren();
});

describe('copyText', () => {
  it('copies when the Clipboard API is unavailable and restores focus and selection', async () => {
    const before = document.createElement('button');
    const selected = document.createElement('span'); selected.textContent = 'keep selected';
    document.body.append(before, selected);
    before.focus();
    const range = document.createRange(); range.selectNodeContents(selected);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);
    expect(window.getSelection()?.toString()).toBe('keep selected');
    const command = vi.fn(() => true);
    Object.defineProperty(document, 'execCommand', { configurable: true, value: command });

    expect(await copyText('copied code\n')).toBe(true);
    expect(command).toHaveBeenCalledWith('copy');
    expect(document.querySelector('textarea')).toBeNull();
    expect(document.activeElement).toBe(before);
    expect(window.getSelection()?.toString()).toBe('keep selected');
  });

  it('falls back after Clipboard API rejection and reports failure when both methods fail', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('NotAllowedError'));
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    const command = vi.fn(() => true);
    Object.defineProperty(document, 'execCommand', { configurable: true, value: command });

    expect(await copyText('first')).toBe(true);
    expect(writeText).toHaveBeenCalledWith('first');
    expect(command).toHaveBeenCalledWith('copy');
    command.mockReturnValue(false);
    expect(await copyText('second')).toBe(false);
  });
});
