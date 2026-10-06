// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { copyWithFeedback, createCopyButton, resetCopyButton } from '../src/copyControls';
import { setIcon } from '../src/icons';
import { createToolButton } from '../src/toolButtons';

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
    expect(button.dataset.icon).toBe('check'); expect(button.dataset.feedback).toBe('Copied'); expect(writeText).toHaveBeenLastCalledWith('first');
    await vi.advanceTimersByTimeAsync(1000); source = 'updated'; button.click();
    await vi.advanceTimersByTimeAsync(1000); expect(button.dataset.feedback).toBe('Copied');
    expect(writeText).toHaveBeenLastCalledWith('updated');
    await vi.advanceTimersByTimeAsync(1000); expect(button.dataset.icon).toBe('copy'); expect(button.dataset.feedback).toBeUndefined();
    expect(button.getAttribute('aria-label')).toBe('Copy');
    expect(document.querySelector('.tool-status')!.textContent).toBe('Copied');
  });

  it('reports failure with an icon, tooltip and live announcement', async () => {
    vi.useFakeTimers();
    Object.defineProperty(document, 'execCommand', { configurable: true, value: () => false });
    const button = createCopyButton(() => 'source'); document.body.append(button);
    button.click(); await vi.advanceTimersByTimeAsync(0);
    expect(button.dataset.icon).toBe('close'); expect(button.getAttribute('aria-label')).toBe('Copy');
    expect(document.querySelector('[role="tooltip"]')!.textContent).toBe('Copy failed');
    expect(document.querySelector('[role="status"]')!.textContent).toBe('Copy failed');
    await vi.advanceTimersByTimeAsync(2000);
    expect(button.dataset.icon).toBe('copy'); expect(document.querySelector('[role="tooltip"]')).toBeNull();
  });

  it('resets feedback and ignores a pending copy when reopening an overlay', async () => {
    vi.useFakeTimers();
    let resolve!: () => void;
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    const button = createCopyButton(() => 'source'); document.body.append(button);
    button.click(); await vi.advanceTimersByTimeAsync(0); resetCopyButton(button);
    expect(button.dataset.icon).toBe('copy'); expect(button.dataset.feedback).toBeUndefined();
    writeText.mockImplementationOnce(() => new Promise<void>((done) => { resolve = done; }));
    button.click(); resetCopyButton(button); resolve(); await vi.advanceTimersByTimeAsync(0);
    expect(button.dataset.icon).toBe('copy'); expect(button.dataset.feedback).toBeUndefined();
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

  it('restores the original title icon after repeated copies', async () => {
    vi.useFakeTimers();
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn().mockResolvedValue(undefined) } });
    const button = document.createElement('button'); button.className = 'title-icon'; setIcon(button, 'copy'); document.body.append(button);
    copyWithFeedback(button, 'path', 'Copy path'); await vi.advanceTimersByTimeAsync(0);
    copyWithFeedback(button, 'path', 'Copy path'); await vi.advanceTimersByTimeAsync(2000);
    expect(button.dataset.icon).toBe('copy'); expect(button.title).toBe('Copy path');
  });

  it('preserves the link icon through reset and repeated copy feedback', async () => {
    vi.useFakeTimers();
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn().mockResolvedValue(undefined) } });
    const button = createToolButton('link', 'Copy line link'); document.body.append(button);
    resetCopyButton(button, 'Copy line link'); expect(button.dataset.icon).toBe('link');
    copyWithFeedback(button, 'url', 'Copy line link'); await vi.advanceTimersByTimeAsync(0);
    copyWithFeedback(button, 'url', 'Copy line link'); await vi.advanceTimersByTimeAsync(2000);
    expect(button.dataset.icon).toBe('link'); expect(button.getAttribute('aria-label')).toBe('Copy line link');
  });
});
