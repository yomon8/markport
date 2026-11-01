// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { createPreview } from '../src/preview';

afterEach(() => { sessionStorage.clear(); document.body.replaceChildren(); });

it('isolates interactive frames per server instance and changes reload keys', () => {
  const invalidate = vi.fn(); const onInstance = vi.fn(); const requestRefresh = vi.fn();
  const preview = createPreview({
    content: document.createElement('article'), rightContent: document.createElement('article'),
    selected: () => 'page.html', navigate: vi.fn(), openRight: vi.fn(),
    invalidate, onInstance, requestRefresh, refreshRight: vi.fn(),
  });
  const url = '/api/preview/page.html?tag=one';
  const safe = preview.createPreviewFrame(url, 'page.html', 'left');
  expect(safe.getAttribute('sandbox')).toBe('allow-same-origin');
  preview.syncPreviewInstance('first'); preview.setInteractive('page.html', true);
  const interactive = preview.createPreviewFrame(url, 'page.html', 'right');
  expect(interactive.getAttribute('sandbox')).toBe('allow-scripts allow-modals');
  expect(interactive.src).toContain('/api/interactive/first/page.html');
  expect(requestRefresh).toHaveBeenCalledOnce();
  expect(sessionStorage.getItem('markport-interactive-preview:first')).toBe('["page.html"]');
  preview.syncPreviewInstance('second'); expect(preview.isInteractive('page.html')).toBe(false);
  preview.syncPreviewInstance('first'); expect(preview.isInteractive('page.html')).toBe(true);
  expect(onInstance).toHaveBeenCalledTimes(3);
  expect(invalidate).toHaveBeenCalledTimes(4);
  const key = preview.filePreviewKey({ type: 'pdf', previewUrl: '/api/pdf?path=a.pdf' }, 'a.pdf');
  preview.reload();
  expect(preview.createPDFFrame('/api/pdf?path=a.pdf', 'a.pdf').src).toContain('reload=1');
  expect(preview.filePreviewKey({ type: 'pdf', previewUrl: '/api/pdf?path=a.pdf' }, 'a.pdf')).not.toBe(key);
  preview.dispose();
});

it('accepts interactive navigation only from the active iframe', () => {
  const content = document.createElement('article'); document.body.append(content);
  const navigate = vi.fn();
  const preview = createPreview({
    content, rightContent: document.createElement('article'), selected: () => 'page.html',
    navigate, openRight: vi.fn(), invalidate: vi.fn(), onInstance: vi.fn(),
    requestRefresh: vi.fn(), refreshRight: vi.fn(),
  });
  preview.syncPreviewInstance('instance'); preview.setInteractive('page.html', true);
  const frame = preview.createPreviewFrame('/api/preview/page.html?tag=one', 'page.html', 'left');
  content.append(frame);
  const data = { markportPreviewLink: `${location.origin}/api/interactive/instance/next.html#heading` };
  window.dispatchEvent(new MessageEvent('message', { origin: 'null', data, source: window }));
  expect(navigate).not.toHaveBeenCalled();
  window.dispatchEvent(new MessageEvent('message', { origin: 'null', data, source: frame.contentWindow }));
  expect(navigate).toHaveBeenCalledWith('/?path=next.html#heading');
  preview.dispose(); navigate.mockClear();
  window.dispatchEvent(new MessageEvent('message', { origin: 'null', data, source: frame.contentWindow }));
  expect(navigate).not.toHaveBeenCalled();
});
