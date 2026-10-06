// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { createToolButton, setToolButton, toolFeedback } from '../src/toolButtons';

afterEach(() => { document.body.replaceChildren(); });

describe('document tool buttons', () => {
  it('provides an accessible name and updates the tooltip when the action changes', () => {
    const button = createToolButton('code', 'Source'); document.body.append(button); button.focus();
    expect(button.textContent).toBe(''); expect(button.querySelector('svg')!.getAttribute('aria-hidden')).toBe('true');
    const tooltip = document.querySelector('[role="tooltip"]')!;
    expect(tooltip.textContent).toBe('Source'); expect(button.getAttribute('aria-describedby')).toBe(tooltip.id);
    setToolButton(button, 'diagram', 'Diagram');
    expect(tooltip.textContent).toBe('Diagram'); expect(button.getAttribute('aria-label')).toBe('Diagram');
    document.dispatchEvent(new Event('scroll')); window.dispatchEvent(new Event('resize'));
    expect(tooltip.isConnected).toBe(true);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(document.querySelector('[role="tooltip"]')).toBeNull(); expect(document.activeElement).toBe(button);
    toolFeedback(button, 'Copied'); expect(document.querySelector('[role="tooltip"]')!.textContent).toBe('Copied');
    toolFeedback(button);
    button.blur(); button.focus(); expect(document.querySelector('[role="tooltip"]')!.textContent).toBe('Diagram');
  });

  it('allows pointer movement into the tooltip and hides it on leaving', () => {
    const button = createToolButton('copy', 'Copy'); document.body.append(button);
    button.dispatchEvent(new MouseEvent('mouseenter'));
    const tooltip = document.querySelector('[role="tooltip"]')!;
    button.dispatchEvent(new MouseEvent('mouseleave', { relatedTarget: tooltip }));
    tooltip.dispatchEvent(new MouseEvent('mouseenter')); expect(tooltip.isConnected).toBe(true);
    tooltip.dispatchEvent(new MouseEvent('mouseleave')); expect(tooltip.isConnected).toBe(false);
  });

  it('removes a tooltip when its button is removed or its dialog closes', async () => {
    const dialog = document.createElement('dialog'); dialog.open = true;
    const button = createToolButton('close', 'Close'); dialog.append(button); document.body.append(dialog); button.focus();
    expect(dialog.querySelector('[role="tooltip"]')).not.toBeNull();
    dialog.open = false; await Promise.resolve();
    expect(document.querySelector('[role="tooltip"]')).toBeNull();
    dialog.open = true; button.blur(); button.focus(); button.remove(); await Promise.resolve();
    expect(document.querySelector('[role="tooltip"]')).toBeNull();
  });
});
