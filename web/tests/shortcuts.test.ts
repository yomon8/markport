// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { matchesShortcut, shortcutText } from '../src/shortcuts';

describe('server info shortcut', () => {
  it('opens with Ctrl+I or Command+I, but not unmodified or modified text keys', () => {
    for (const options of [{ ctrlKey: true }, { metaKey: true }]) {
      expect(matchesShortcut(new KeyboardEvent('keydown', { key: 'i', ...options }), 'serverInfo')).toBe(true);
    }
    for (const options of [{}, { ctrlKey: true, shiftKey: true }, { ctrlKey: true, altKey: true },
      { ctrlKey: true, isComposing: true }, { ctrlKey: true, keyCode: 229 }]) {
      expect(matchesShortcut(new KeyboardEvent('keydown', { key: 'i', ...options }), 'serverInfo')).toBe(false);
    }
  });

  it('labels the opening shortcut for the platform', () => {
    const platform = vi.spyOn(navigator, 'platform', 'get');
    try {
      platform.mockReturnValue('Linux'); expect(shortcutText('serverInfo')).toBe('Ctrl+I');
      platform.mockReturnValue('MacIntel'); expect(shortcutText('serverInfo')).toBe('⌘I');
    } finally { platform.mockRestore(); }
  });
});
