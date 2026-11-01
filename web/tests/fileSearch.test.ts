// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createFileSearch } from '../src/fileSearch';

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

const reply = (status: number, body: unknown = {}, tag = '') => ({
  status, ok: status < 400, json: async () => body, headers: new Headers({ ETag: tag }),
}) as Response;

it('refreshes active searches every ten seconds with ETags and keeps results on 304', async () => {
  const fetch = vi.fn().mockResolvedValueOnce(reply(200, { paths: ['a.md'], ignored: ['out.md'] }, 'v1'))
    .mockResolvedValue(reply(304));
  vi.stubGlobal('fetch', fetch);
  const setSearchIndex = vi.fn();
  const search = createFileSearch({ getQuery: () => 'a', view: { setSearchIndex } });
  await search.loadSearchIndex(true);
  expect(setSearchIndex).toHaveBeenLastCalledWith(['a.md'], 'ready', ['out.md']);
  await vi.advanceTimersByTimeAsync(9999); expect(fetch).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1); expect(fetch).toHaveBeenCalledTimes(2);
  expect(fetch.mock.calls[1][1].headers['If-None-Match']).toBe('v1');
  expect(setSearchIndex).toHaveBeenCalledTimes(2);
  search.dispose(); await vi.advanceTimersByTimeAsync(30000);
  expect(fetch).toHaveBeenCalledTimes(2);
});

it('aborts cleared requests and ignores their late results', async () => {
  let finish: ((value: Response) => void) | undefined;
  let signal: AbortSignal | undefined;
  vi.stubGlobal('fetch', vi.fn((_url: string, init: RequestInit) => {
    signal = init.signal as AbortSignal;
    return new Promise<Response>((resolve) => { finish = resolve; });
  }));
  const setSearchIndex = vi.fn(); let query = 'a';
  const search = createFileSearch({ getQuery: () => query, view: { setSearchIndex } });
  const loading = search.loadSearchIndex();
  query = ''; search.onSearchChange('');
  expect(signal?.aborted).toBe(true);
  finish?.(reply(200, { paths: ['stale.md'] })); await loading;
  expect(setSearchIndex).toHaveBeenLastCalledWith([], 'idle');
  expect(vi.getTimerCount()).toBe(0); search.dispose();
});

it('postpones automatic refresh while hidden and resumes stale searches', async () => {
  const fetch = vi.fn().mockResolvedValue(reply(200, { paths: [] }));
  vi.stubGlobal('fetch', fetch);
  const search = createFileSearch({ getQuery: () => 'a', view: { setSearchIndex: vi.fn() } });
  await search.loadSearchIndex();
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
  await vi.advanceTimersByTimeAsync(10000); expect(fetch).toHaveBeenCalledTimes(1);
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
  search.refreshIfStale(); await vi.advanceTimersByTimeAsync(0);
  expect(fetch).toHaveBeenCalledTimes(2); search.dispose(); vi.restoreAllMocks();
});

it('uses a thirty-second backup in watch mode without resetting repeated fallback notifications', async () => {
  const fetch = vi.fn().mockResolvedValue(reply(200, { paths: [] })); vi.stubGlobal('fetch', fetch);
  const search = createFileSearch({ getQuery: () => 'a', view: { setSearchIndex: vi.fn() } });
  await search.loadSearchIndex(); search.setMode('watch');
  await vi.advanceTimersByTimeAsync(29999); expect(fetch).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1); expect(fetch).toHaveBeenCalledTimes(2);
  search.setMode('poll'); await vi.advanceTimersByTimeAsync(5000); search.setMode('poll');
  await vi.advanceTimersByTimeAsync(5000); expect(fetch).toHaveBeenCalledTimes(3);
  search.dispose();
});
