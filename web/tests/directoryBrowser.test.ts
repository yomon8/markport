// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { createDirectoryBrowser } from '../src/directoryBrowser';
import { TreeView } from '../src/tree';

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); document.body.replaceChildren(); });

function setup(getRevision = () => 1) {
  document.body.innerHTML = '<nav></nav><input><span></span><button></button>';
  const view = new TreeView(document.querySelector('nav')!, document.querySelector('input')!, document.querySelector('span')!, document.querySelector('button')!, () => '', vi.fn(), vi.fn(), vi.fn());
  const onRoot = vi.fn(); const syncPreviewInstance = vi.fn();
  const controller = createDirectoryBrowser({ view, getRevision, onRoot, syncPreviewInstance, onError: vi.fn() });
  return { controller, view, onRoot, syncPreviewInstance };
}
const reply = (status = 200) => ({ status, ok: true, headers: new Headers({ ETag: 'v1', 'X-Markport-Instance': 'a'.repeat(32) }),
  json: async () => ({ root: 'project', entries: [{ path: 'a.md', name: 'a.md', type: 'file' }], offset: 0, nextOffset: null, revision: 'one' }),
}) as Response;

it('uses conditional requests and updates the root and preview instance', async () => {
  const fetch = vi.fn().mockResolvedValueOnce(reply()).mockResolvedValue(reply(304)); vi.stubGlobal('fetch', fetch);
  const { controller, view, onRoot, syncPreviewInstance } = setup();
  await controller.loadPage('', 0, '', false, 1);
  expect(view.has('')).toBe(true); expect(onRoot).toHaveBeenCalledWith('project');
  const link = document.querySelector('nav a');
  await controller.loadPage('', 0, '', true, 1);
  expect(fetch.mock.calls[1][1].headers['If-None-Match']).toBe('v1');
  expect(document.querySelector('nav a')).toBe(link);
  expect(syncPreviewInstance).toHaveBeenCalledWith('a'.repeat(32));
  controller.clearTags(); await controller.loadPage('', 0, '', true, 1);
  expect(fetch.mock.calls[2][1].headers['If-None-Match']).toBeUndefined();
});

it('does not install pages or cache tags from superseded refreshes', async () => {
  let finish: ((response: Response) => void) | undefined; let revision = 1;
  const fetch = vi.fn().mockImplementationOnce(() => new Promise<Response>((resolve) => { finish = resolve; })).mockResolvedValue(reply());
  vi.stubGlobal('fetch', fetch);
  const { controller, view, onRoot } = setup(() => revision);
  const loading = controller.loadPage('', 0, '', false, 1);
  revision = 2; finish?.(reply()); await loading;
  expect(view.has('')).toBe(false); expect(onRoot).not.toHaveBeenCalled();
  await controller.loadPage('', 0, '', true, 2);
  expect(fetch.mock.calls[1][1].headers['If-None-Match']).toBeUndefined();
  expect(view.has('')).toBe(true);
});
