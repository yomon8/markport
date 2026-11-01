import type { TreeView } from './tree';

type ApiError = { error?: string; message?: string };
type FileSearchOptions = { getQuery: () => string; view: Pick<TreeView, 'setSearchIndex'> };

export function createFileSearch(deps: FileSearchOptions) {
  let searchIndexTimer: ReturnType<typeof setTimeout> | undefined;
  let searchIndexRequest: AbortController | undefined;
  let searchIndexVersion = 0;
  let searchIndexState: 'idle' | 'loading' | 'ready' | 'error' = 'idle';
  let searchIndexCheckedAt = 0;
  let searchIndexTag = '';
  function scheduleSearchIndexRefresh(): void {
    clearTimeout(searchIndexTimer);
    if (!deps.getQuery().trim()) return;
    searchIndexTimer = setTimeout(() => {
      if (document.hidden) { scheduleSearchIndexRefresh(); return; }
      void loadSearchIndex();
    }, 10000);
  }
  async function loadSearchIndex(force = false): Promise<void> {
    clearTimeout(searchIndexTimer);
    searchIndexRequest?.abort();
    const request = new AbortController();
    searchIndexRequest = request;
    const current = ++searchIndexVersion;
    const hadResults = searchIndexState === 'ready';
    if (!hadResults) { searchIndexState = 'loading'; deps.view.setSearchIndex([], 'loading'); }
    try {
      const headers: Record<string, string> = {};
      if (searchIndexTag) headers['If-None-Match'] = searchIndexTag;
      if (force) headers['Cache-Control'] = 'no-cache';
      const response = await fetch('/api/search-index', { cache: 'no-store', signal: request.signal, headers });
      if (current !== searchIndexVersion || !deps.getQuery().trim()) return;
      searchIndexCheckedAt = Date.now();
      if (response.status === 304) return;
      const body = await response.json() as { paths?: string[]; ignored?: string[] } & ApiError;
      if (!response.ok) throw new Error(body.message ?? `HTTP ${response.status}`);
      if (!Array.isArray(body.paths)) throw new Error('Invalid file list');
      if (current !== searchIndexVersion || !deps.getQuery().trim()) return;
      searchIndexTag = response.headers.get('ETag') ?? '';
      searchIndexState = 'ready';
      deps.view.setSearchIndex(body.paths, 'ready', Array.isArray(body.ignored) ? body.ignored : []);
    } catch {
      if (current !== searchIndexVersion || !deps.getQuery().trim()) return;
      if (!hadResults) { searchIndexState = 'error'; deps.view.setSearchIndex([], 'error'); }
    } finally {
      if (current === searchIndexVersion) {
        searchIndexRequest = undefined;
        scheduleSearchIndexRefresh();
      }
    }
  }
  function onSearchChange(query: string): void {
    if (!query) {
      searchIndexVersion++;
      searchIndexRequest?.abort(); searchIndexRequest = undefined;
      clearTimeout(searchIndexTimer);
      searchIndexState = 'idle';
      searchIndexTag = '';
      deps.view.setSearchIndex([], 'idle');
    } else if (searchIndexState === 'idle' || searchIndexState === 'error') void loadSearchIndex(true);
  }
  function refreshIfStale(): void {
    if (deps.getQuery().trim() && Date.now() - searchIndexCheckedAt >= 10000 && !searchIndexRequest) void loadSearchIndex();
  }
  return { loadSearchIndex, onSearchChange, refreshIfStale, dispose: () => onSearchChange('') };
}
