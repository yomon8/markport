import { RequestError, type ApiError } from './api';
import type { TreeView, Page } from './tree';

type DirectoryOptions = {
  view: Pick<TreeView, 'has' | 'setLoading' | 'setPage' | 'hasChild' | 'unloadedOpenPaths' | 'forget' | 'revision' | 'offsets' | 'expandedPaths' | 'shouldLoadSelectedPath' | 'isActive'>;
  getRevision: () => number;
  syncPreviewInstance: (instance: string) => void;
  onRoot: (name?: string) => void;
  onError: () => void;
};

export function createDirectoryBrowser(deps: DirectoryOptions) {
  const { view, syncPreviewInstance } = deps;
  const pageTags = new Map<string, { value: string; checkedAt: number }>();
  async function getPage(path: string, offset: number, focus: string, conditional: boolean, expectedRevision?: number): Promise<Page | null> {
    const tag = pageTags.get(path);
    const headers: Record<string, string> = {};
    if (conditional && !focus && offset === 0 && view.has(path) && tag && Date.now() - tag.checkedAt < 60000) headers['If-None-Match'] = tag.value;
    let response: Response;
    try { response = await fetch(pageURL(path, offset, focus), { cache: 'no-store', headers }); }
    catch { throw new RequestError('network', 'Cannot connect'); }
    if (path === '') {
      const instance = response.headers?.get('X-Markport-Instance') ?? '';
      if (/^[a-f0-9]{32}$/.test(instance)) syncPreviewInstance(instance);
    }
    if (response.status === 304) return null;
    const body = await response.json() as Page & ApiError;
    if (!response.ok) throw new RequestError(body.error ?? 'network', body.message ?? `HTTP ${response.status}`);
    const value = response.headers?.get('ETag');
    if (value && (expectedRevision === undefined || expectedRevision === deps.getRevision())) pageTags.set(path, { value, checkedAt: Date.now() });
    return body;
  }
  function pageURL(path: string, offset = 0, focus = ''): string {
    const query = new URLSearchParams();
    if (path) query.set('path', path);
    if (offset) query.set('offset', String(offset));
    if (focus) query.set('focus', focus);
    return `/api/tree${query.size ? `?${query}` : ''}`;
  }
  async function loadPage(path: string, offset = 0, focus = '', conditional = false, expectedRevision?: number): Promise<Page | null> {
    if (!view.has(path)) view.setLoading(path, true);
    try {
      const page = await getPage(path, offset, focus, conditional, expectedRevision);
      if (expectedRevision !== undefined && expectedRevision !== deps.getRevision()) return null;
      if (!page) return null;
      view.setPage(path, page);
      if (path === '') deps.onRoot(page.root);
      return page;
    } finally { view.setLoading(path, false); }
  }
  async function ensureSelectedPath(path: string, expectedRevision: number): Promise<void> {
    if (!path) return;
    const parts = path.split('/');
    let parent = '';
    for (const part of parts) {
      if (expectedRevision !== deps.getRevision()) return;
      if (!view.hasChild(parent, part)) await loadPage(parent, 0, part, false, expectedRevision);
      parent = parent ? `${parent}/${part}` : part;
    }
  }
  async function loadOpenDirectories(expectedRevision: number): Promise<void> {
    for (;;) {
      if (expectedRevision !== deps.getRevision()) return;
      const next = view.unloadedOpenPaths()[0];
      if (!next) return;
      try { await loadPage(next, 0, '', false, expectedRevision); }
      catch (error) {
        if (!(error instanceof RequestError && error.code === 'not_found')) throw error;
        view.forget(next);
      }
    }
  }
  async function openDirectory(path: string, offset = 0): Promise<void> {
    // A pushed refresh can supersede a lazy load while the folder stays open.
    // Retry that user action after its loading marker has been cleared.
    while (!path || view.isActive(path)) {
      const revision = deps.getRevision();
      await loadPage(path, offset, '', false, revision);
      if (revision === deps.getRevision()) {
        await loadOpenDirectories(revision);
        return;
      }
    }
  }
  async function refreshDirectory(path: string, expectedRevision: number): Promise<void> {
    const before = view.revision(path);
    const offsets = view.offsets(path);
    const first = await loadPage(path, 0, '', true, expectedRevision);
    if (first && before && before !== first.revision) {
      for (const offset of offsets) {
        if (offset === 0) continue;
        const page = await loadPage(path, offset, '', false, expectedRevision);
        if (page?.revision !== first.revision) break;
      }
    }
  }
  async function refreshDirectories(path: string, expectedRevision: number): Promise<void> {
    const activeBefore = view.expandedPaths();
    await refreshDirectory('', expectedRevision);
    if (expectedRevision !== deps.getRevision()) return;
    try { if (view.shouldLoadSelectedPath(path)) await ensureSelectedPath(path, expectedRevision); }
    catch (error) { if (!(error instanceof RequestError && error.code === 'not_found')) throw error; }
    for (const dir of activeBefore) if (dir && view.has(dir) && view.isActive(dir)) {
      if (expectedRevision !== deps.getRevision()) return;
      try { await refreshDirectory(dir, expectedRevision); }
      catch (error) {
        if (!(error instanceof RequestError && error.code === 'not_found')) throw error;
        view.forget(dir);
      }
    }
    if (expectedRevision !== deps.getRevision()) return;
    try { if (view.shouldLoadSelectedPath(path)) await ensureSelectedPath(path, expectedRevision); }
    catch (error) { if (!(error instanceof RequestError && error.code === 'not_found')) throw error; }
    for (const key of pageTags.keys()) if (!view.has(key)) pageTags.delete(key);
    void loadOpenDirectories(expectedRevision).catch(() => deps.onError());
  }
  return { loadPage, openDirectory, ensureSelectedPath, loadOpenDirectories, refreshDirectories, clearTags: () => pageTags.clear() };
}
