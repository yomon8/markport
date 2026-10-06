// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { copyWithFeedback, createCopyButton } from '../src/copyControls';
import { setIcon } from '../src/icons';

afterEach(() => {
  vi.useRealTimers(); Reflect.deleteProperty(navigator, 'clipboard');
  Reflect.deleteProperty(document, 'execCommand'); document.body.replaceChildren();
});

describe('Copy controls', () => {
  it('reads the current source, reports success, and restores the label after repeated clicks', async () => {
    vi.useFakeTimers();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    let source = 'first'; const button = createCopyButton(() => source); document.body.append(button);
    button.click(); await vi.advanceTimersByTimeAsync(0);
    expect(button.textContent).toBe('Copied'); expect(writeText).toHaveBeenLastCalledWith('first');
    await vi.advanceTimersByTimeAsync(1000); source = 'updated'; button.click();
    await vi.advanceTimersByTimeAsync(1000); expect(button.textContent).toBe('Copied');
    expect(writeText).toHaveBeenLastCalledWith('updated');
    await vi.advanceTimersByTimeAsync(1000); expect(button.textContent).toBe('Copy');
  });

  it('reports failure and preserves existing icon controls', async () => {
    vi.useFakeTimers();
    Object.defineProperty(document, 'execCommand', { configurable: true, value: () => false });
    const button = document.createElement('button'); button.className = 'title-icon'; setIcon(button, 'copy');
    button.title = 'Copy path'; document.body.append(button);
    copyWithFeedback(button, 'path', 'Copy path'); await vi.advanceTimersByTimeAsync(0);
    expect(button.title).toBe('Copy failed'); expect(button.dataset.icon).toBe('close');
    await vi.advanceTimersByTimeAsync(2000);
    expect(button.title).toBe('Copy path'); expect(button.dataset.icon).toBe('copy');
  });
});
