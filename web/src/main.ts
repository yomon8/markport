import './style.css';
import { drawMermaid } from './mermaid';
import { TreeView, type Page } from './tree';
import { effectiveTheme, initTheme } from './theme';
import { renderChanges, renderDiff, diffURL, reviewButton, type Change, type ChangesReply, type DiffReply } from './diff';
import { ReviewState } from './review';
import { initContentSearch } from './contentSearch';
import { copyText } from './clipboard';
import { createDiagramOverlay } from './diagramOverlay';
import symbolLight from '../../logo/markport-symbol-light.svg';
import symbolDark from '../../logo/markport-symbol-dark.svg';
import favicon from '../../logo/markport-favicon.svg';

type FileReply = { path: string; type: 'image'; assetUrl: string }
  | { path: string; type: 'html'; previewUrl: string }
  | { path: string; type: 'html' | 'markdown' | 'code'; html: string };
type ApiError = { error?: string; message?: string };
class RequestError extends Error { constructor(readonly code: string, message: string) { super(message); } }
const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('app missing');
app.innerHTML = `<a class="skip-link" href="#content">Skip to content</a><header><button id="drawer-toggle" type="button" aria-label="Open file list">☰</button><button id="sidebar-toggle" type="button" aria-label="Collapse sidebar" aria-expanded="true">☰</button><span class="brand" role="img" aria-label="markport"><img class="brand-symbol" src="${symbolLight}" alt=""></span><span id="root-name"></span><span id="connection" role="status" data-state="connecting"><span class="connection-label">Connecting…</span></span><div id="header-extras"><button id="theme-toggle" type="button"></button><button id="paste-toggle" type="button">Paste Markdown</button></div><button id="header-more" type="button" aria-label="More header actions" aria-expanded="false" aria-controls="header-extras">⋯</button><button id="reload" type="button"><span class="reload-icon" aria-hidden="true">↻</span> Refresh</button></header><div class="layout"><aside id="sidebar"><div class="sidebar-tabs" role="tablist" aria-label="Sidebar views"><button id="files-tab" type="button" role="tab" aria-controls="files-panel">Files</button><button id="changes-tab" type="button" role="tab" aria-controls="changes-tree">Changes</button></div><div id="files-panel" role="tabpanel" aria-labelledby="files-tab"><form role="search" onsubmit="return false"><label for="search">Search files</label><input id="search" type="search" placeholder="Path or file name /"><span id="result-count"></span></form><nav id="tree" aria-label="File list"></nav></div><nav id="changes-tree" role="tabpanel" aria-labelledby="changes-tab" aria-label="Changed files" hidden></nav></aside><div id="sidebar-resize" role="separator" aria-orientation="vertical" aria-label="Resize sidebar" tabindex="0"></div><main id="main"><div id="connection-banner" hidden></div><div id="file-title" tabindex="-1"></div><div id="progress" hidden></div><div class="content-layout"><article id="content" tabindex="-1" aria-busy="false"></article><nav id="outline" aria-label="Table of contents" hidden></nav></div></main><section id="right-pane" aria-label="Right file" hidden><div id="right-title"><div id="right-path" class="breadcrumbs"></div><div class="right-actions"><span id="right-kind" class="kind-badge"></span><div id="right-views" class="view-segment" role="group" aria-label="Rendered view or Source"><button id="right-rendered" type="button" aria-pressed="true">Rendered view</button><button id="right-source" type="button" aria-pressed="false">Source</button></div><button id="right-interactive" type="button" hidden>Enable JavaScript</button><button id="right-copy" type="button" class="title-icon" aria-label="Copy path" title="Copy path">⧉</button><button id="right-contents" type="button" class="title-icon" aria-label="Contents" title="Contents" hidden>☷</button><button id="right-swap" type="button" class="title-icon" aria-label="Swap panes" title="Swap panes">⇄</button><button id="right-only" type="button" class="title-icon" aria-label="Show this file only" title="Show this file only">▣</button><button id="right-close" type="button" class="title-icon" aria-label="Close split view" title="Close split view">×</button></div></div><article id="right-content" aria-busy="false"></article><nav id="right-outline" aria-label="Right table of contents" hidden></nav></section></div><div id="diagram-overlay" hidden><button type="button" id="overlay-close">Close ×</button><div id="overlay-content"></div></div>`;
const diagramOverlay = createDiagramOverlay();
const icon = document.querySelector<HTMLLinkElement>('link[rel="icon"]') ?? document.createElement('link');
icon.rel = 'icon'; icon.type = 'image/svg+xml'; icon.href = favicon;
if (!icon.isConnected) document.head.append(icon);
function updateBrand(): void {
  const dark = effectiveTheme() === 'dark';
  document.querySelector<HTMLImageElement>('.brand-symbol')!.src = dark ? symbolDark : symbolLight;
}
const tree = document.querySelector<HTMLElement>('#tree')!;
const changesTree = document.querySelector<HTMLElement>('#changes-tree')!;
const filesPanel = document.querySelector<HTMLElement>('#files-panel')!;
const contentSearch = document.createElement('details');
contentSearch.id = 'content-search';
const filesList = document.createElement('div');
filesList.id = 'files-list';
filesPanel.querySelector('form')!.after(filesList);
filesList.append(contentSearch, tree);
initContentSearch(contentSearch, navigate);
const filesTab = document.querySelector<HTMLButtonElement>('#files-tab')!;
const changesTab = document.querySelector<HTMLButtonElement>('#changes-tab')!;
const content = document.querySelector<HTMLElement>('#content')!;
const title = document.querySelector<HTMLElement>('#file-title')!;
const search = document.querySelector<HTMLInputElement>('#search')!;
const count = document.querySelector<HTMLElement>('#result-count')!;
const connection = document.querySelector<HTMLElement>('#connection')!;
const banner = document.querySelector<HTMLElement>('#connection-banner')!;
const reload = document.querySelector<HTMLButtonElement>('#reload')!;
const pasteToggle = document.querySelector<HTMLButtonElement>('#paste-toggle')!;
const headerMore = document.querySelector<HTMLButtonElement>('#header-more')!;
const headerExtras = document.querySelector<HTMLElement>('#header-extras')!;
const main = document.querySelector<HTMLElement>('#main')!;
const layout = document.querySelector<HTMLElement>('.layout')!;
const rightPane = document.querySelector<HTMLElement>('#right-pane')!;
const rightContent = document.querySelector<HTMLElement>('#right-content')!;
const rightPath = document.querySelector<HTMLElement>('#right-path')!;
const rightKind = document.querySelector<HTMLElement>('#right-kind')!;
const rightViews = document.querySelector<HTMLElement>('#right-views')!;
const rightRendered = document.querySelector<HTMLButtonElement>('#right-rendered')!;
const rightInteractive = document.querySelector<HTMLButtonElement>('#right-interactive')!;
const rightSource = document.querySelector<HTMLButtonElement>('#right-source')!;
const rightOutline = document.querySelector<HTMLElement>('#right-outline')!;
const rightContents = document.querySelector<HTMLButtonElement>('#right-contents')!;
let rightShownPath = ''; let rightShownKey = ''; let rightSourceMode = false; let rightRequest = 0;
let pendingRightScroll: number | undefined;
let rightTag = ''; let rightTagCheckedAt = 0;
let wrapCodeLines = false;
try { wrapCodeLines = localStorage.getItem('markport-wrap-code') === 'true'; } catch { /* Storage may be unavailable. */ }
let lineRangeAnchor = 0;
const progress = document.querySelector<HTMLElement>('#progress')!;
const outline = document.querySelector<HTMLElement>('#outline')!;
const sidebar = document.querySelector<HTMLElement>('#sidebar')!;
const drawerToggle = document.querySelector<HTMLButtonElement>('#drawer-toggle')!;
const sidebarToggle = document.querySelector<HTMLButtonElement>('#sidebar-toggle')!;
const view = new TreeView(tree, search, count, selected,
  (path) => { const current = revision; void loadPage(path, 0, '', false, current).then(() => loadOpenDirectories(current)).catch(() => status('Refresh failed. Please try again.', 'error')); },
  (path, offset) => { const current = revision; void loadPage(path, offset, '', false, current).catch(() => status('Refresh failed. Please try again.', 'error')); },
  onSearchChange);
let revision = 0; let pending = false; let pendingForeground = false; let activeForeground = false; let running = false;
let displayedPath = ''; let displayedHTML = ''; let displayedSource = false; let sourceMode = new URL(location.href).searchParams.get('source') === '1';
let displayedMode: 'file' | 'diff' | 'changes' | 'paste' = 'file'; let lastFilePath = '';
let sidebarPanel: 'file' | 'changes' = selectedMode() === 'changes' || selectedMode() === 'diff' ? 'changes' : 'file';
let keepTabFocus = false;
let currentChanges: ChangesReply | undefined;
let displayedChanges = '';
const review = new ReviewState();
let reviewVersion = 0;
let onlyUnreviewed = false;
let groupChanges = false;
let previewReload = 0;
let previewInstance = '';
const interactivePaths = new Set<string>();
let displayedTag = '';
let displayedTagCheckedAt = 0;
const pageTags = new Map<string, { value: string; checkedAt: number }>();
let rootName = ''; let outlineObserver: IntersectionObserver | undefined;
const pasteStorageKey = 'markport-pasted-markdown';
const maxPasteBytes = 1 << 20;
let pastedMarkdown = '';
try { pastedMarkdown = sessionStorage.getItem(pasteStorageKey) ?? ''; } catch { /* Storage may be unavailable. */ }
let pasteVersion = 0;
let refreshPastedPreview: (() => void) | undefined;
let loadingTimer: ReturnType<typeof setTimeout> | undefined;
let updatedTimer: ReturnType<typeof setTimeout> | undefined;
let searchIndexTimer: ReturnType<typeof setTimeout> | undefined;
let searchIndexRequest: AbortController | undefined;
let searchIndexVersion = 0;
let searchIndexState: 'idle' | 'loading' | 'ready' | 'error' = 'idle';
let searchIndexCheckedAt = 0;
let searchIndexTag = '';
const savedWidth = Number(localStorage.getItem('markport-sidebar-width'));
if (savedWidth >= 200 && savedWidth <= 480) document.documentElement.style.setProperty('--sidebar-width', `${savedWidth}px`);

function selected(): string { return new URL(location.href).searchParams.get('path') ?? ''; }
function fileURL(path: string): string { return `/?path=${encodeURIComponent(path)}`; }
function previewStorageKey(): string { return `markport-interactive-preview:${previewInstance}`; }
function syncPreviewInstance(instance: string): void {
  if (!instance || instance === previewInstance) return;
  previewInstance = instance; interactivePaths.clear();
  try {
    const saved = JSON.parse(sessionStorage.getItem(previewStorageKey()) ?? '[]') as unknown;
    if (Array.isArray(saved)) for (const path of saved) if (typeof path === 'string') interactivePaths.add(path);
  } catch { /* Storage may be unavailable. */ }
  displayedHTML = ''; displayedTag = ''; rightShownKey = ''; rightTag = '';
  if (rightSelected()) void refreshRight();
}
function setInteractive(path: string, enabled: boolean): void {
  if (enabled) interactivePaths.add(path); else interactivePaths.delete(path);
  try { if (previewInstance) sessionStorage.setItem(previewStorageKey(), JSON.stringify([...interactivePaths])); } catch { /* Storage may be unavailable. */ }
  displayedHTML = ''; displayedTag = ''; rightShownKey = ''; rightTag = '';
  requestRefresh();
}
function isInteractive(path: string): boolean { return Boolean(previewInstance) && interactivePaths.has(path); }
function previewURL(url: string, path: string): string {
  const preview = isInteractive(path) ? url.replace('/api/preview/', `/api/interactive/${previewInstance}/`) : url;
  return `${preview}&reload=${previewReload}`;
}
function createPreviewFrame(url: string, path: string, pane: 'left' | 'right'): HTMLIFrameElement {
  const frame = document.createElement('iframe'); frame.className = 'html-preview'; frame.title = `Preview of ${path}`;
  frame.setAttribute('sandbox', isInteractive(path) ? 'allow-scripts allow-modals' : 'allow-same-origin');
  frame.referrerPolicy = 'no-referrer'; attachPreviewNavigation(frame, path, pane);
  frame.src = previewURL(url, path);
  return frame;
}
function selectedMode(): 'file' | 'diff' | 'changes' | 'paste' {
  const view = new URL(location.href).searchParams.get('view');
  return view === 'paste' ? 'paste' : view === 'changes' ? 'changes' : view === 'diff' && selected() ? 'diff' : 'file';
}
function showSidebar(mode: 'file' | 'changes'): void {
  const git = mode === 'changes';
  filesPanel.hidden = git; changesTree.hidden = !git;
  filesTab.setAttribute('aria-selected', String(!git)); changesTab.setAttribute('aria-selected', String(git));
  filesTab.tabIndex = git ? -1 : 0; changesTab.tabIndex = git ? 0 : -1;
}
function saveScroll(): void { history.replaceState({ scroll: main.scrollTop }, '', location.href); }
function navigate(url: string): void {
  const target = new URL(url, location.href);
  const right = new URL(location.href).searchParams.get('right');
  if (right && target.searchParams.has('path') && !target.searchParams.has('view')) target.searchParams.set('right', right);
  if (target.href === location.href) return;
  saveScroll(); pasteVersion++; lineRangeAnchor = 0; history.pushState({ scroll: 0 }, '', target); sidebarPanel = selectedMode() === 'changes' || selectedMode() === 'diff' ? 'changes' : 'file'; sourceMode = target.searchParams.get('source') === '1'; sidebar.classList.remove('open'); requestRefresh();
}
function rightSelected(): string { return selectedMode() === 'file' ? new URL(location.href).searchParams.get('right') ?? '' : ''; }
function openRight(path: string): void {
  if (path !== rightSelected()) rightSourceMode = false;
  const url = new URL(location.href); url.searchParams.set('right', path);
  history.pushState(history.state, '', url); sidebar.classList.remove('open'); void refreshRight();
}
function closeRight(): void {
  const url = new URL(location.href); url.searchParams.delete('right');
  history.pushState(history.state, '', url); rightRequest++; rightPane.hidden = true; layout.classList.remove('split'); rightShownPath = ''; rightShownKey = '';
  rightTag = '';
}
function swapPanes(): void {
  const left = selected(); const right = rightSelected();
  if (!left || !right) return;
  const leftScroll = main.scrollTop; const rightScroll = rightPane.scrollTop;
  const leftSource = sourceMode;
  const url = new URL(location.href); url.searchParams.set('path', right); url.searchParams.set('right', left);
  history.replaceState({ scroll: leftScroll }, '', location.href);
  history.pushState({ scroll: rightScroll }, '', url);
  sourceMode = rightSourceMode; rightSourceMode = leftSource;
  if (sourceMode) url.searchParams.set('source', '1'); else url.searchParams.delete('source');
  history.replaceState({ scroll: rightScroll }, '', url);
  rightShownPath = ''; rightShownKey = ''; rightTag = '';
  pendingRightScroll = leftScroll;
  requestRefresh();
}
function showRightOnly(): void {
  const path = rightSelected(); if (!path) return;
  const url = new URL(location.href); url.searchParams.set('path', path); url.searchParams.delete('right');
  if (rightSourceMode) url.searchParams.set('source', '1'); else url.searchParams.delete('source');
  history.replaceState({ scroll: main.scrollTop }, '', location.href);
  history.pushState({ scroll: rightPane.scrollTop }, '', url);
  sourceMode = rightSourceMode; rightPane.hidden = true; layout.classList.remove('split'); requestRefresh();
}
function status(message: string, state: 'ok' | 'connecting' | 'error'): void {
  if (connection.dataset.state === state && connection.title === message) return;
  connection.querySelector<HTMLElement>('.connection-label')!.textContent = message; connection.dataset.state = state; connection.title = message;
  banner.hidden = state === 'ok'; banner.replaceChildren();
  if (state !== 'ok') {
    banner.append(document.createTextNode(state === 'error' ? 'Refresh failed. Check the connection and files.' : 'Checking connection.'));
    if (state === 'error') { const button = document.createElement('button'); button.textContent = 'Refresh now'; button.addEventListener('click', manualRefresh); banner.append(button); }
  }
}
const copyTimers = new WeakMap<HTMLButtonElement, ReturnType<typeof setTimeout>>();
function copyWithFeedback(button: HTMLButtonElement, text: string, label: string): void {
  void copyText(text).then((copied) => {
    clearTimeout(copyTimers.get(button));
    button.textContent = copied ? 'Copied' : 'Copy failed';
    copyTimers.set(button, setTimeout(() => { button.textContent = label; copyTimers.delete(button); }, 2000));
  });
}
function scheduleSearchIndexRefresh(): void {
  clearTimeout(searchIndexTimer);
  if (!search.value.trim()) return;
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
  if (!hadResults) { searchIndexState = 'loading'; view.setSearchIndex([], 'loading'); }
  try {
    const headers: Record<string, string> = {};
    if (searchIndexTag) headers['If-None-Match'] = searchIndexTag;
    if (force) headers['Cache-Control'] = 'no-cache';
    const response = await fetch('/api/search-index', { cache: 'no-store', signal: request.signal, headers });
    if (current !== searchIndexVersion || !search.value.trim()) return;
    searchIndexCheckedAt = Date.now();
    if (response.status === 304) return;
    const body = await response.json() as { paths?: string[] } & ApiError;
    if (!response.ok) throw new RequestError(body.error ?? 'network', body.message ?? `HTTP ${response.status}`);
    if (!Array.isArray(body.paths)) throw new RequestError('invalid_response', 'Invalid file list');
    if (current !== searchIndexVersion || !search.value.trim()) return;
    searchIndexTag = response.headers.get('ETag') ?? '';
    searchIndexState = 'ready';
    view.setSearchIndex(body.paths, 'ready');
  } catch {
    if (current !== searchIndexVersion || !search.value.trim()) return;
    if (!hadResults) { searchIndexState = 'error'; view.setSearchIndex([], 'error'); }
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
    view.setSearchIndex([], 'idle');
  } else if (searchIndexState === 'idle' || searchIndexState === 'error') void loadSearchIndex(true);
}
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
  if (value && (expectedRevision === undefined || expectedRevision === revision)) pageTags.set(path, { value, checkedAt: Date.now() });
  return body;
}
async function getFile(path: string, source: boolean, expectedRevision: number): Promise<FileReply | null> {
  const headers: Record<string, string> = {};
  if (path === displayedPath && source === displayedSource && displayedHTML && displayedTag && Date.now() - displayedTagCheckedAt < 60000) headers['If-None-Match'] = displayedTag;
  let response: Response;
  try { response = await fetch(`/api/file?path=${encodeURIComponent(path)}${source ? '&source=1' : ''}`, { cache: 'no-store', headers }); }
  catch { throw new RequestError('network', 'Cannot connect'); }
  if (response.status === 304) return null;
  const body = await response.json() as FileReply & ApiError;
  if (!response.ok) throw new RequestError(body.error ?? 'network', body.message ?? `HTTP ${response.status}`);
  if (expectedRevision === revision) {
    displayedTag = response.headers?.get('ETag') ?? '';
    displayedTagCheckedAt = Date.now();
  }
  return body;
}
async function getGit<T>(url: string): Promise<T> {
  let response: Response;
  try { response = await fetch(url, { cache: 'no-store' }); }
  catch { throw new RequestError('network', 'Cannot connect'); }
  const body = await response.json() as T & ApiError;
  if (!response.ok) throw new RequestError(body.error ?? 'network', body.message ?? `HTTP ${response.status}`);
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
    if (expectedRevision !== undefined && expectedRevision !== revision) return null;
    if (!page) return null;
    view.setPage(path, page);
    if (path === '') { rootName = page.root || rootName; document.querySelector('#root-name')!.textContent = rootName; }
    return page;
  } finally { view.setLoading(path, false); }
}
async function ensureSelectedPath(path: string, expectedRevision: number): Promise<void> {
  if (!path) return;
  const parts = path.split('/');
  let parent = '';
  for (const part of parts) {
    if (expectedRevision !== revision) return;
    if (!view.hasChild(parent, part)) await loadPage(parent, 0, part, false, expectedRevision);
    parent = parent ? `${parent}/${part}` : part;
  }
}
async function loadOpenDirectories(expectedRevision: number): Promise<void> {
  for (;;) {
    if (expectedRevision !== revision) return;
    const next = view.unloadedOpenPaths()[0];
    if (!next) return;
    try { await loadPage(next, 0, '', false, expectedRevision); }
    catch (error) {
      if (!(error instanceof RequestError && error.code === 'not_found')) throw error;
      view.forget(next);
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
  if (expectedRevision !== revision) return;
  try { await ensureSelectedPath(path, expectedRevision); }
  catch (error) { if (!(error instanceof RequestError && error.code === 'not_found')) throw error; }
  for (const dir of activeBefore) if (dir && view.has(dir)) {
    if (expectedRevision !== revision) return;
    try { await refreshDirectory(dir, expectedRevision); }
    catch (error) {
      if (!(error instanceof RequestError && error.code === 'not_found')) throw error;
      view.forget(dir);
    }
  }
  if (expectedRevision !== revision) return;
  try { await ensureSelectedPath(path, expectedRevision); }
  catch (error) { if (!(error instanceof RequestError && error.code === 'not_found')) throw error; }
  for (const key of pageTags.keys()) if (!view.has(key)) pageTags.delete(key);
  void loadOpenDirectories(expectedRevision).catch(() => status('Refresh failed. Please try again.', 'error'));
}
function showTitle(path: string, kind = '', missing = false): void {
  title.replaceChildren();
  if (selectedMode() === 'changes') {
    const heading = document.createElement('strong'); heading.textContent = 'Git changes'; title.append(heading); document.title = 'Git changes — markport'; return;
  }
  if (!path) { title.textContent = rootName || 'markport'; document.title = 'markport'; return; }
  const crumbs = document.createElement('div'); crumbs.className = 'breadcrumbs';
  const parts = path.split('/');
  parts.forEach((part, index) => {
    if (index) { const separator = document.createElement('span'); separator.className = 'crumb-separator'; separator.textContent = ' / '; crumbs.append(separator); }
    if (index < parts.length - 1) {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'crumb'; button.textContent = part;
      button.addEventListener('click', () => {
        sidebarPanel = 'file'; showSidebar(sidebarPanel);
        if (sidebar.classList.contains('collapsed')) sidebarToggle.click();
        if (window.innerWidth <= 700) sidebar.classList.add('open');
        view.revealDirectory(parts.slice(0, index + 1).join('/'));
      }); crumbs.append(button);
    } else { const label = document.createElement('strong'); label.textContent = part; if (missing) label.className = 'missing'; crumbs.append(label); }
  });
  title.append(crumbs);
  const actions = document.createElement('div'); actions.className = 'title-actions';
  const segment = (choices: { label: string; selected: boolean; disabled?: boolean; select: () => void }[]): void => {
    const group = document.createElement('div'); group.className = 'view-segment'; group.setAttribute('role', 'group'); group.setAttribute('aria-label', choices.map((choice) => choice.label).join(' or '));
    for (const choice of choices) {
      const button = document.createElement('button'); button.type = 'button'; button.textContent = choice.label;
      button.setAttribute('aria-pressed', String(choice.selected)); button.disabled = Boolean(choice.disabled);
      button.addEventListener('click', choice.select); group.append(button);
    }
    actions.append(group);
  };
  if (kind) {
    const badge = document.createElement('span'); badge.className = 'kind-badge';
    const extension = path.split('.').at(-1)?.toLowerCase() ?? '';
    const languages: Record<string, string> = { py: 'Python', go: 'Go', js: 'JavaScript', ts: 'TypeScript', tsx: 'TypeScript', jsx: 'JavaScript', rs: 'Rust', java: 'Java', sh: 'Shell', html: 'HTML', css: 'CSS', json: 'JSON', yaml: 'YAML', yml: 'YAML' };
    badge.textContent = kind === 'diff' ? 'Git Diff' : kind === 'markdown' ? 'Markdown' : kind === 'html' ? 'HTML' : ((languages[extension] ?? extension.toUpperCase()) || 'Code'); actions.append(badge);
  }
  if (selectedMode() === 'diff') {
    const change = currentChanges?.changes.find((item) => item.path === path);
    if (change) {
      const reviewed = review.has(change.path, change.revision);
      actions.append(reviewButton(change, reviewed, () => toggleReview(change)));
      const previous = diffNeighbor(path, -1, onlyUnreviewed);
      const next = diffNeighbor(path, 1, onlyUnreviewed);
      const navigation = document.createElement('div'); navigation.className = 'diff-navigation';
      const addNavigation = (label: string, target: Change | undefined): void => {
        const button = document.createElement('button'); button.type = 'button'; button.textContent = label;
        button.disabled = !target; button.title = target ? `${label}: ${target.path}` : `No ${label.toLowerCase()} file`;
        button.addEventListener('click', () => { if (target) navigate(diffURL(target.path)); }); navigation.append(button);
      };
      addNavigation('Previous (p)', previous);
      addNavigation('Next (n)', next);
      const reviewNext = document.createElement('button'); reviewNext.type = 'button'; reviewNext.textContent = 'Review and next (r)';
      reviewNext.addEventListener('click', markReviewedAndNext); navigation.append(reviewNext);
      actions.append(navigation);
    }
    const deleted = currentChanges?.changes.find((change) => change.path === path)?.status === 'deleted';
    segment([{ label: 'File', selected: false, disabled: deleted, select: () => navigate(fileURL(path)) }, { label: 'Diff', selected: true, select: () => {} }]);
  } else {
    segment([{ label: 'File', selected: true, select: () => {} }, { label: 'Diff', selected: false, select: () => navigate(diffURL(path)) }]);
  }
  if (kind === 'markdown' || kind === 'html') {
    const rendered = kind === 'html' ? 'Preview' : 'Rendered view';
    segment([{ label: rendered, selected: !sourceMode, select: () => { if (sourceMode) { sourceMode = false; requestRefresh(); } } }, { label: 'Source', selected: sourceMode, select: () => { if (!sourceMode) { sourceMode = true; requestRefresh(); } } }]);
  }
  if (kind === 'html') {
    const interactive = document.createElement('button'); interactive.type = 'button'; interactive.className = 'interactive-toggle';
    const enabled = interactivePaths.has(path);
    interactive.textContent = enabled ? 'Disable JavaScript' : 'Enable JavaScript';
    interactive.setAttribute('aria-pressed', String(enabled));
    interactive.title = 'Allow scripts in this HTML preview until this tab is closed';
    interactive.addEventListener('click', () => setInteractive(path, !enabled)); actions.append(interactive);
  }
  const auxiliary = document.createElement('div'); auxiliary.className = 'title-auxiliary';
  const menuButton = document.createElement('button'); menuButton.type = 'button'; menuButton.className = 'title-more'; menuButton.textContent = '⋯'; menuButton.title = 'More actions'; menuButton.setAttribute('aria-label', 'More actions'); menuButton.setAttribute('aria-expanded', 'false'); menuButton.setAttribute('aria-haspopup', 'menu');
  const menu = document.createElement('div'); menu.className = 'title-menu'; menu.setAttribute('role', 'menu'); menu.hidden = true;
  const closeMenu = (): void => { menu.hidden = true; menuButton.setAttribute('aria-expanded', 'false'); menuButton.focus(); };
  menuButton.addEventListener('click', () => { menu.hidden = !menu.hidden; menuButton.setAttribute('aria-expanded', String(!menu.hidden)); if (!menu.hidden) menu.querySelector<HTMLButtonElement>('button')?.focus(); });
  menu.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') { event.preventDefault(); closeMenu(); return; }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault(); const items = [...menu.querySelectorAll<HTMLButtonElement>('button')]; const index = items.indexOf(document.activeElement as HTMLButtonElement);
    items[(index + (event.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length]?.focus();
  });
  const addAux = (label: string, icon: string, action: (button: HTMLButtonElement) => void, visible = true): void => {
    if (!visible) return;
    const desktop = document.createElement('button'); desktop.type = 'button'; desktop.className = 'title-icon'; desktop.textContent = icon; desktop.title = label; desktop.setAttribute('aria-label', label); desktop.addEventListener('click', () => action(desktop)); auxiliary.append(desktop);
    const mobile = document.createElement('button'); mobile.type = 'button'; mobile.setAttribute('role', 'menuitem'); mobile.textContent = label; mobile.addEventListener('click', () => { action(mobile); closeMenu(); }); menu.append(mobile);
  };
  addAux('Open on right', '◫', () => openRight(path), selectedMode() === 'file');
  addAux('Copy path', '⧉', (button) => copyWithFeedback(button, path, button.classList.contains('title-icon') ? '⧉' : 'Copy path'));
  addAux('Contents', '☷', () => outline.classList.toggle('open'), !outline.hidden);
  const mobileChoices = [...actions.querySelectorAll<HTMLButtonElement>('.view-segment button, .review-toggle, .diff-navigation button, .interactive-toggle')].map((control) => {
    const item = document.createElement('button'); item.type = 'button';
    item.textContent = control.getAttribute('aria-label') ?? control.textContent;
    item.disabled = control.disabled;
    if (control.hasAttribute('aria-pressed')) {
      item.setAttribute('role', 'menuitemradio'); item.setAttribute('aria-checked', control.getAttribute('aria-pressed')!);
    } else item.setAttribute('role', 'menuitem');
    item.addEventListener('click', () => { closeMenu(); control.click(); });
    return item;
  });
  menu.prepend(...mobileChoices);
  const parentCrumb = [...crumbs.querySelectorAll<HTMLButtonElement>('.crumb')].at(-1);
  if (parentCrumb) {
    const parentAction = document.createElement('button'); parentAction.type = 'button'; parentAction.textContent = 'Show parent folder'; parentAction.setAttribute('role', 'menuitem');
    parentAction.addEventListener('click', () => { closeMenu(); parentCrumb.click(); });
    menu.append(parentAction);
  }
  actions.append(auxiliary, menuButton, menu);
  title.append(actions); document.title = `${parts.at(-1)} — markport`;
}
function toggleReview(change: Change): void {
  review.set(change.path, change.revision, !review.has(change.path, change.revision));
  reviewVersion++;
  updateChangeViews();
  if (selectedMode() === 'diff' && selected() === change.path) showTitle(change.path, 'diff');
}
function diffNeighbor(path: string, direction: -1 | 1, unreviewedOnly: boolean): Change | undefined {
  const changes = currentChanges?.changes ?? [];
  const index = changes.findIndex((change) => change.path === path);
  if (index < 0) return undefined;
  for (let next = index + direction; next >= 0 && next < changes.length; next += direction) {
    const change = changes[next];
    if (!unreviewedOnly || !review.has(change.path, change.revision)) return change;
  }
  return undefined;
}
function markReviewedAndNext(): void {
  if (selectedMode() !== 'diff') return;
  const path = selected(); const change = currentChanges?.changes.find((item) => item.path === path);
  if (!change) return;
  review.set(change.path, change.revision, true); reviewVersion++;
  const next = diffNeighbor(path, 1, true);
  updateChangeViews();
  if (next) navigate(diffURL(next.path)); else showTitle(path, 'diff');
}
function setReviewFilter(value: boolean): void {
  onlyUnreviewed = value;
  reviewVersion++;
  updateChangeViews();
  if (selectedMode() === 'diff') showTitle(selected(), 'diff');
}
function setGroupChanges(value: boolean): void { groupChanges = value; reviewVersion++; updateChangeViews(); }
function updateChangeViews(): void {
  if (!currentChanges) return;
  const key = `${JSON.stringify(currentChanges)}:${reviewVersion}`;
  const isReviewed = (change: Change): boolean => review.has(change.path, change.revision);
  if (displayedChanges !== key) {
    renderChanges(changesTree, currentChanges, isReviewed, toggleReview, onlyUnreviewed, setReviewFilter, groupChanges, setGroupChanges, true);
    displayedChanges = key;
  }
  const path = selected();
  const active = [...changesTree.querySelectorAll<HTMLAnchorElement>('a[href]')].find((link) => selectedMode() === 'diff' && link.getAttribute('href') === diffURL(path));
  active?.setAttribute('aria-current', 'page');
  if (selectedMode() === 'diff' && displayedMode === 'diff' && displayedPath === path) {
    const change = currentChanges.changes.find((item) => item.path === path);
    const button = title.querySelector<HTMLButtonElement>('.review-toggle');
    if (change && button?.getAttribute('aria-pressed') !== String(isReviewed(change))) showTitle(path, 'diff');
  }
  if (selectedMode() === 'changes' && displayedHTML !== key) {
    content.dataset.kind = 'changes';
    renderChanges(content, currentChanges, isReviewed, toggleReview, onlyUnreviewed, setReviewFilter, groupChanges, setGroupChanges);
    displayedHTML = key;
    outline.hidden = true; showTitle('');
  }
}
function showEmpty(): void {
  const detailText = `${view.fileCount()} ${view.fileCount() === 1 ? 'file' : 'files'} loaded from ${rootName || 'the root directory'}. Open a folder to see more, or press / to search.`;
  if (content.querySelector('.empty-state p')?.textContent === detailText) return;
  content.replaceChildren(); const box = document.createElement('div'); box.className = 'empty-state';
  const heading = document.createElement('h2'); heading.textContent = 'Select a file';
  const detail = document.createElement('p'); detail.textContent = detailText;
  box.append(heading, detail); content.append(box); outline.hidden = true;
}
function showPaste(): void {
  content.dataset.kind = 'paste';
  const heading = document.createElement('strong'); heading.textContent = 'Pasted Markdown';
  const titleActions = document.createElement('div'); titleActions.className = 'title-actions';
  const toggle = document.createElement('button'); toggle.type = 'button'; toggle.id = 'paste-view-toggle'; toggle.textContent = 'Rendered view';
  titleActions.append(toggle); title.replaceChildren(heading, titleActions);
  document.title = 'Pasted Markdown — markport';
  outline.hidden = true;
  const editor = document.createElement('div'); editor.className = 'paste-editor';
  const label = document.createElement('label'); label.htmlFor = 'paste-input'; label.textContent = 'Markdown Text';
  const input = document.createElement('textarea'); input.id = 'paste-input'; input.placeholder = 'Paste Markdown here'; input.value = pastedMarkdown;
  const actions = document.createElement('div'); actions.className = 'paste-actions';
  const clearButton = document.createElement('button'); clearButton.type = 'button'; clearButton.textContent = 'Clear';
  const notice = document.createElement('p'); notice.className = 'paste-notice'; notice.setAttribute('role', 'status');
  const preview = document.createElement('div'); preview.className = 'paste-preview'; preview.hidden = true;
  actions.append(clearButton); editor.append(label, input, actions, notice);
  content.replaceChildren(editor, preview);
  let rendered = false;
  let renderedMarkdown = '';
  const message = (text: string, error = false): void => { notice.textContent = text; notice.classList.toggle('error', error); };
  const showText = (): void => {
    pasteVersion++; rendered = false; editor.hidden = false; preview.hidden = true; toggle.textContent = 'Rendered view';
    outlineObserver?.disconnect(); outline.replaceChildren(); outline.hidden = true; input.focus();
  };
  const renderPaste = async (force = false): Promise<void> => {
    const markdown = input.value;
    if (!markdown.trim()) { message('Paste Markdown text to render.', true); return; }
    if (new TextEncoder().encode(markdown).length > maxPasteBytes) { message('Markdown exceeds the 1 MiB limit.', true); return; }
    const current = ++pasteVersion;
    rendered = true; editor.hidden = true; preview.hidden = false; toggle.textContent = 'Markdown Text';
    if (!force && renderedMarkdown === markdown) { updateOutline(); return; }
    preview.textContent = 'Rendering…'; outline.hidden = true;
    try {
      const response = await fetch('/api/render', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ markdown }) });
      const body = await response.json() as { html?: string } & ApiError;
      if (!response.ok) throw new RequestError(body.error ?? 'network', body.message ?? `HTTP ${response.status}`);
      if (typeof body.html !== 'string') throw new RequestError('invalid_response', 'Invalid render response');
      if (current !== pasteVersion || selectedMode() !== 'paste' || !rendered) return;
      preview.innerHTML = body.html; renderedMarkdown = markdown; decorateContent(); updateOutline();
      message('');
      void drawMermaid(content, () => current === pasteVersion && selectedMode() === 'paste' && rendered);
    } catch (error) {
      if (current === pasteVersion && selectedMode() === 'paste' && rendered) {
        showText(); message(error instanceof Error ? error.message : 'Cannot render Markdown.', true);
      }
    }
  };
  input.addEventListener('input', () => {
    pasteVersion++; pastedMarkdown = input.value; renderedMarkdown = ''; preview.replaceChildren(); message('');
    try {
      if (new TextEncoder().encode(pastedMarkdown).length > maxPasteBytes) {
        sessionStorage.removeItem(pasteStorageKey); message('Markdown exceeds the 1 MiB limit.', true);
      } else if (pastedMarkdown) sessionStorage.setItem(pasteStorageKey, pastedMarkdown);
      else sessionStorage.removeItem(pasteStorageKey);
    } catch { message('This tab could not save the text for reloading.', true); }
  });
  toggle.addEventListener('click', () => { if (rendered) showText(); else void renderPaste(); });
  clearButton.addEventListener('click', () => {
    pasteVersion++; pastedMarkdown = ''; renderedMarkdown = ''; input.value = ''; preview.replaceChildren(); message('');
    try { sessionStorage.removeItem(pasteStorageKey); } catch { message('This tab could not clear saved text.', true); }
    input.focus();
  });
  refreshPastedPreview = () => { if (rendered) void renderPaste(true); };
}
function showError(error: unknown, path: string): void {
  const code = error instanceof RequestError ? error.code : 'network';
  const errorKey = JSON.stringify([path, code, error instanceof Error ? error.message : '']);
  if (content.querySelector('.file-error')?.getAttribute('data-error-key') === errorKey) return;
  const messages: Record<string, [string, string]> = {
    not_found: ['File not found', 'This file was deleted or moved.'],
    too_large: ['File too large', 'This file exceeds the size limit.'],
    invalid_asset: ['Cannot display image', 'The image could not be loaded. Check the file and try again.'],
    binary: ['Cannot display file', 'Binary files cannot be displayed.'],
    unreadable: ['Cannot read file', 'This file cannot be read.'],
    not_regular: ['Cannot read file', 'This file cannot be read.'],
    network: ['Cannot connect', 'Cannot connect to the server. Check that markport is running.'],
    no_change: ['No diff', 'This file has no changes since HEAD.'],
    git_unavailable: ['Cannot display Git diff', 'Check that Git is available for this repository.'],
    git_failure: ['Cannot load Git diff', 'Please try again.'],
  };
  const [heading, description] = messages[code] ?? ['Cannot display file', 'Please try again.'];
  content.replaceChildren(); const box = document.createElement('div'); box.className = 'file-error'; box.dataset.errorKey = errorKey; box.setAttribute('role', 'alert');
  const icon = document.createElement('span'); icon.textContent = '⚠'; icon.setAttribute('aria-hidden', 'true');
  const h = document.createElement('h2'); h.textContent = heading; const p = document.createElement('p');
  const size = code === 'too_large' && error instanceof RequestError ? error.message.match(/(\d+ MiB) limit \(actual (\d+(?:\.\d+)? MiB)\)/) : undefined;
  p.textContent = size ? `This file exceeds the ${size[1]} limit (${size[2]}).` : description;
  const button = document.createElement('button'); button.type = 'button'; button.textContent = code === 'not_found' ? 'Back to root' : 'Try again'; button.addEventListener('click', () => code === 'not_found' ? navigate('/') : manualRefresh());
  box.append(icon, h, p, button); content.append(box); outline.hidden = true; showTitle(path, '', code === 'not_found');
}
function decorateContent(target = content, path = displayedPath): void {
  function setWrap(frame: HTMLElement, enabled: boolean): void {
    frame.classList.toggle('wrapped', enabled);
    const numbers = [...frame.querySelectorAll<HTMLElement>('.lntd:first-child .lnt')];
    const lines = [...frame.querySelectorAll<HTMLElement>('.lntd:last-child .line')];
    lines.forEach((line, index) => {
      const existing = line.querySelector('.wrapped-line-number');
      const code = line.querySelector<HTMLElement>('.cl');
      if (enabled) {
        if (!existing && numbers[index]) {
          const anchor = document.createElement('a'); anchor.className = 'wrapped-line-number';
          anchor.href = `#L${index + 1}`; anchor.textContent = String(index + 1);
          anchor.setAttribute('aria-label', `Line ${index + 1}`); line.prepend(anchor);
        }
        const tail = line.lastChild;
        if (tail?.nodeType === Node.TEXT_NODE && tail.textContent?.endsWith('\n')) {
          tail.textContent = tail.textContent.slice(0, -1); line.dataset.wrapNewline = 'true';
        }
        const codeTail = code?.lastChild;
        if (codeTail?.nodeType === Node.TEXT_NODE && codeTail.textContent?.endsWith('\n')) {
          codeTail.textContent = codeTail.textContent.slice(0, -1); code!.dataset.wrapNewline = 'true';
        }
      } else {
        existing?.remove();
        if (line.dataset.wrapNewline === 'true') { line.append(document.createTextNode('\n')); delete line.dataset.wrapNewline; }
        if (code?.dataset.wrapNewline === 'true') { code.append(document.createTextNode('\n')); delete code.dataset.wrapNewline; }
      }
    });
  }
  function wrapCode(element: HTMLElement): void {
    const frame = document.createElement('div'); frame.className = 'code-frame';
    const toolbar = document.createElement('div'); toolbar.className = 'code-toolbar';
    const label = document.createElement('span'); label.textContent = element.closest<HTMLElement>('[data-language]')?.dataset.language || (target.dataset.kind === 'code' ? path.split('.').at(-1) : 'text') || 'text';
    const button = document.createElement('button'); button.type = 'button'; button.textContent = 'Copy';
    button.addEventListener('click', () => {
      const lines = [...element.querySelectorAll<HTMLElement>('.lntd:last-child .line')];
      if (lines.length) {
        const text = lines.map((line) => (line.querySelector<HTMLElement>('.cl')?.textContent ?? '').replace(/\n$/, '')).join('\n');
        const last = lines.at(-1)!;
        const trailing = last.dataset.wrapNewline === 'true' || last.querySelector<HTMLElement>('.cl')?.dataset.wrapNewline === 'true' || last.textContent?.endsWith('\n');
        copyWithFeedback(button, text + (trailing ? '\n' : ''), 'Copy');
      } else copyWithFeedback(button, element.textContent ?? '', 'Copy');
    });
    const wrap = document.createElement('button'); wrap.type = 'button'; wrap.textContent = 'Wrap lines'; wrap.setAttribute('aria-pressed', String(wrapCodeLines));
    wrap.addEventListener('click', () => {
      wrapCodeLines = !wrapCodeLines;
      try { localStorage.setItem('markport-wrap-code', String(wrapCodeLines)); } catch { /* Storage may be unavailable. */ }
      for (const codeFrame of document.querySelectorAll<HTMLElement>('.code-frame')) {
        setWrap(codeFrame, wrapCodeLines);
        codeFrame.querySelector<HTMLButtonElement>('.code-wrap-toggle')?.setAttribute('aria-pressed', String(wrapCodeLines));
      }
      highlightCodeLines(false);
    });
    wrap.className = 'code-wrap-toggle';
    const controls = document.createElement('div'); controls.className = 'code-toolbar-actions'; controls.append(wrap, button);
    if (element.querySelector('.lntable')) {
      const copyLink = document.createElement('button'); copyLink.type = 'button'; copyLink.className = 'copy-line-link'; copyLink.textContent = 'Copy line link'; copyLink.hidden = true;
      copyLink.addEventListener('click', () => copyWithFeedback(copyLink, location.href, 'Copy line link'));
      controls.prepend(copyLink);
    }
    toolbar.append(label, controls); element.before(frame); frame.append(toolbar, element); setWrap(frame, wrapCodeLines);
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => {
      const scroller = element.classList.contains('chroma') ? element : element.querySelector<HTMLElement>('pre') ?? element;
      const updateOverflow = (): void => { frame.classList.toggle('overflows', scroller.scrollLeft + scroller.clientWidth < scroller.scrollWidth - 1); };
      scroller.addEventListener('scroll', updateOverflow); updateOverflow();
    });
  }
  for (const block of target.querySelectorAll<HTMLElement>('.chroma')) {
    if (block.closest('[data-mermaid],.code-frame,.chroma .chroma')) continue;
    wrapCode(block);
  }
  for (const pre of target.querySelectorAll<HTMLPreElement>('pre')) {
    if (pre.closest('[data-mermaid],.code-frame')) continue;
    wrapCode(pre);
  }
  for (const img of target.querySelectorAll<HTMLImageElement>('img')) {
    img.loading = 'lazy'; img.decoding = 'async';
    img.addEventListener('error', () => { const note = document.createElement('span'); note.className = 'image-error'; note.textContent = img.alt || 'Cannot load image'; img.replaceWith(note); });
  }
  for (const table of target.querySelectorAll('table')) {
    if (table.closest('.chroma')) continue;
    const wrap = document.createElement('div'); wrap.className = 'table-wrap'; table.before(wrap); wrap.append(table);
  }
  updateTableHeaders();
}
function highlightCodeLines(scroll: boolean): boolean {
  const match = /^#L(\d+)(?:-L(\d+))?$/.exec(location.hash);
  for (const marked of content.querySelectorAll<HTMLElement>('.selected-code-line')) marked.classList.remove('selected-code-line');
  for (const button of content.querySelectorAll<HTMLButtonElement>('.copy-line-link')) button.hidden = !match;
  if (!match) return false;
  const start = Number(match[1]); const end = match[2] ? Number(match[2]) : start;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 1 || end < start || end - start > 500) return false;
  if (!lineRangeAnchor) lineRangeAnchor = start;
  const numbers = [...content.querySelectorAll<HTMLElement>('.lntd:first-child .lnt')];
  const lines = [...content.querySelectorAll<HTMLElement>('.lntd:last-child .line')];
  for (let line = start; line <= end; line++) {
    numbers[line - 1]?.classList.add('selected-code-line');
    lines[line - 1]?.classList.add('selected-code-line');
  }
  const target = wrapCodeLines ? lines[start - 1] : numbers[start - 1];
  if (scroll && target) target.scrollIntoView({ block: 'center' });
  return Boolean(target);
}
function updateTableHeaders(): void {
  const top = main.getBoundingClientRect().top + title.getBoundingClientRect().height;
  for (const table of content.querySelectorAll<HTMLTableElement>('.table-wrap table')) {
    const head = table.tHead;
    if (!head) continue;
    const distance = Math.max(0, Math.min(table.offsetHeight - head.offsetHeight, top - table.getBoundingClientRect().top));
    head.style.transform = `translateY(${distance}px)`;
  }
}
main.addEventListener('scroll', updateTableHeaders);
function updateOutline(): void {
  outlineObserver?.disconnect(); outline.replaceChildren();
  const headings = [...content.querySelectorAll<HTMLElement>('h1[id],h2[id],h3[id],h4[id],h5[id],h6[id]')];
  outline.hidden = headings.length < 3;
  if (outline.hidden) return;
  for (const heading of headings) {
    const link = document.createElement('a'); link.href = `#${encodeURIComponent(heading.id)}`; link.textContent = heading.textContent; link.className = `outline-h${heading.tagName.slice(1)}`;
    link.addEventListener('click', (event) => { event.preventDefault(); history.replaceState(history.state, '', `#${encodeURIComponent(heading.id)}`); heading.scrollIntoView(); outline.classList.remove('open'); }); outline.append(link);
  }
  if (typeof IntersectionObserver !== 'undefined') {
    outlineObserver = new IntersectionObserver((entries) => { for (const entry of entries) if (entry.isIntersecting) for (const link of outline.querySelectorAll('a')) link.classList.toggle('active', decodeURIComponent(link.hash.slice(1)) === entry.target.id); }, { root: main, rootMargin: '-15% 0px -70% 0px' });
    headings.forEach((heading) => outlineObserver?.observe(heading));
  }
}
function updateRightOutline(): void {
  rightOutline.replaceChildren(); rightOutline.classList.remove('open');
  const headings = [...rightContent.querySelectorAll<HTMLElement>('h1[id],h2[id],h3[id],h4[id],h5[id],h6[id]')];
  rightOutline.hidden = headings.length < 3; rightContents.hidden = rightOutline.hidden;
  for (const heading of headings) {
    const link = document.createElement('a'); link.href = `#${encodeURIComponent(heading.id)}`;
    link.textContent = heading.textContent; link.className = `outline-h${heading.tagName.slice(1)}`;
    link.addEventListener('click', (event) => { event.preventDefault(); heading.scrollIntoView(); rightOutline.classList.remove('open'); });
    rightOutline.append(link);
  }
}
function showRightTitle(path: string, kind: FileReply['type']): void {
  rightPath.replaceChildren(); rightPath.title = path;
  const parts = path.split('/');
  if (parts.length > 1) {
    const parent = document.createElement('span'); parent.className = 'breadcrumb-parent';
    parent.textContent = `${parts.slice(0, -1).join('/')} / `; rightPath.append(parent);
  }
  const name = document.createElement('strong'); name.textContent = parts.at(-1) ?? path; rightPath.append(name);
  rightKind.textContent = kind === 'markdown' ? 'Markdown' : kind === 'html' ? 'HTML' : kind === 'image' ? 'Image' : (parts.at(-1)?.split('.').at(-1)?.toUpperCase() || 'Code');
  rightViews.hidden = kind !== 'markdown' && kind !== 'html';
  rightRendered.textContent = kind === 'html' ? 'Preview' : 'Rendered view';
  rightRendered.setAttribute('aria-pressed', String(!rightSourceMode));
  rightSource.setAttribute('aria-pressed', String(rightSourceMode));
}
function beginLoading(): void { content.setAttribute('aria-busy', 'true'); reload.disabled = true; clearTimeout(loadingTimer); loadingTimer = setTimeout(() => { progress.hidden = false; }, 200); }
function endLoading(): void { clearTimeout(loadingTimer); progress.hidden = true; reload.disabled = false; content.setAttribute('aria-busy', 'false'); }
function requestRefresh(foreground = true): void {
  if (!foreground && (activeForeground || pendingForeground)) return;
  revision++; pending = true; pendingForeground ||= foreground; if (!running) void refreshLoop();
}
function manualRefresh(): void {
  displayedTag = ''; rightTag = ''; pageTags.clear(); previewReload++; requestRefresh();
  if (selectedMode() === 'paste') refreshPastedPreview?.();
  if (search.value.trim()) void loadSearchIndex(true);
}

function attachPreviewNavigation(frame: HTMLIFrameElement, path: string, pane: 'left' | 'right' = 'left'): void {
  if (isInteractive(path)) return;
  frame.addEventListener('load', () => {
    if (!frame.isConnected || (pane === 'left' ? selected() : rightSelected()) !== path) return;
    let document: Document | null;
    try { document = frame.contentDocument; } catch { return; }
    document?.addEventListener('click', (event) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = (event.target as Element).closest?.('a[href]') as HTMLAnchorElement | null;
      if (!link) return;
      const url = new URL(link.href);
      const current = frame.contentWindow?.location.href;
      if (url.hash && current && url.href.split('#')[0] === current.split('#')[0]) return;
      if (url.origin === location.origin && url.pathname.startsWith('/api/preview/')) {
        event.preventDefault();
        try {
          const next = decodeURIComponent(url.pathname.slice('/api/preview/'.length));
          if (pane === 'right') openRight(next); else navigate(fileURL(next) + url.hash);
        } catch { /* Invalid URL encoding. */ }
      } else if (url.protocol === 'http:' || url.protocol === 'https:') {
        event.preventDefault(); window.open(url.href, '_blank', 'noopener,noreferrer');
      }
    });
  });
}
window.addEventListener('message', (event: MessageEvent) => {
  if (event.origin !== 'null' || !event.data || typeof event.data.markportPreviewLink !== 'string') return;
  const leftFrame = content.querySelector<HTMLIFrameElement>('.html-preview');
  const rightFrame = rightContent.querySelector<HTMLIFrameElement>('.html-preview');
  const pane = event.source === leftFrame?.contentWindow ? 'left' : event.source === rightFrame?.contentWindow ? 'right' : null;
  if (!pane || !isInteractive(pane === 'left' ? selected() : rightSelected())) return;
  let url: URL;
  try { url = new URL(event.data.markportPreviewLink); } catch { return; }
  const interactivePrefix = `/api/interactive/${previewInstance}/`;
  if (url.origin === location.origin && url.pathname.startsWith(interactivePrefix)) {
    let next: string;
    try { next = decodeURIComponent(url.pathname.slice(interactivePrefix.length)); } catch { return; }
    if (!next || next.split('/').some((part) => !part || part === '.' || part === '..')) return;
    if (pane === 'right') openRight(next); else navigate(fileURL(next) + url.hash);
  } else if (url.protocol === 'http:' || url.protocol === 'https:') {
    window.open(url.href, '_blank', 'noopener,noreferrer');
  }
});
async function refreshRight(): Promise<void> {
  const path = rightSelected(); const request = ++rightRequest;
  rightPane.hidden = !path; layout.classList.toggle('split', Boolean(path));
  if (!path) { rightShownPath = ''; rightShownKey = ''; return; }
  if (path !== rightShownPath) { rightPane.scrollTop = 0; rightShownKey = ''; rightTag = ''; }
  rightContent.setAttribute('aria-busy', 'true');
  try {
    const headers: Record<string, string> = {};
    if (rightShownPath === path && rightTag && Date.now() - rightTagCheckedAt < 60000) headers['If-None-Match'] = rightTag;
    const response = await fetch(`/api/file?path=${encodeURIComponent(path)}${rightSourceMode ? '&source=1' : ''}`, { cache: 'no-store', headers });
    if (request !== rightRequest || path !== rightSelected()) return;
    rightTag = response.headers.get('ETag') ?? '';
    rightTagCheckedAt = Date.now();
    if (response.status === 304) return;
    const file = await response.json() as FileReply & ApiError;
    if (!response.ok) throw new RequestError(file.error ?? 'network', file.message ?? `HTTP ${response.status}`);
    if (request !== rightRequest || path !== rightSelected()) return;
    const key = `${rightSourceMode}\n${'assetUrl' in file ? file.assetUrl : 'previewUrl' in file ? previewURL(file.previewUrl, path) : file.html}`;
    if (rightShownPath !== path || rightShownKey !== key) {
      const scroll = rightShownPath === path ? rightPane.scrollTop : 0;
      rightContent.dataset.kind = file.type === 'image' ? 'image' : rightSourceMode ? 'code' : file.type;
      if ('previewUrl' in file) {
        rightContent.replaceChildren(createPreviewFrame(file.previewUrl, path, 'right'));
      } else if (file.type === 'image') {
        const img = document.createElement('img'); img.className = 'image-preview'; img.alt = path.split('/').at(-1) ?? path;
        img.src = file.assetUrl; img.addEventListener('error', () => { if (img.isConnected) rightContent.textContent = 'Cannot display image.'; }); rightContent.replaceChildren(img);
      } else { rightContent.innerHTML = file.html; decorateContent(rightContent, path); }
      rightPane.scrollTop = scroll; rightShownKey = key;
      updateRightOutline();
      void drawMermaid(rightContent, () => request === rightRequest && path === rightSelected());
    }
    showRightTitle(path, file.type);
    rightInteractive.hidden = file.type !== 'html';
    rightInteractive.textContent = interactivePaths.has(path) ? 'Disable JavaScript' : 'Enable JavaScript';
    rightInteractive.setAttribute('aria-pressed', String(interactivePaths.has(path)));
    rightShownPath = path;
    if (pendingRightScroll !== undefined) { rightPane.scrollTop = pendingRightScroll; pendingRightScroll = undefined; }
  } catch (error) {
    if (request !== rightRequest || path !== rightSelected()) return;
    rightContent.replaceChildren(); const message = document.createElement('div'); message.className = 'file-error'; message.setAttribute('role', 'alert');
    message.textContent = error instanceof RequestError && error.code === 'not_found' ? 'File not found.' : 'Cannot display file. Please try again.'; rightContent.append(message);
    rightInteractive.hidden = true; rightViews.hidden = true; rightOutline.hidden = true; rightContents.hidden = true;
    rightShownPath = path; rightShownKey = '';
  } finally { if (request === rightRequest) rightContent.setAttribute('aria-busy', 'false'); }
}
async function refreshLoop(): Promise<void> {
  running = true;
  try {
    while (pending) {
      pending = false; const foreground = pendingForeground; pendingForeground = false;
      const current = revision; const path = selected(); const source = sourceMode; const mode = selectedMode(); const preserveTabFocus = keepTabFocus; keepTabFocus = false;
      void refreshRight();
      showSidebar(sidebarPanel);
      if (path !== displayedPath || mode !== displayedMode) displayedTag = '';
      if (foreground) { activeForeground = true; beginLoading(); }
      const treePromise = refreshDirectories(mode === 'changes' || mode === 'paste' ? '' : path, current);
      const gitPromise = mode === 'changes' || mode === 'diff' ? getGit<ChangesReply>('/api/git/changes') : Promise.resolve(undefined);
      const filePromise = mode === 'diff' ? getGit<DiffReply>(`/api/git/diff?path=${encodeURIComponent(path)}`).then((value) => ({ value }), (error: unknown) => ({ error }))
        : mode === 'file' && path ? getFile(path, source, current).then((value) => ({ value }), (error: unknown) => ({ error })) : Promise.resolve(null);
      try {
        const [, fileReply, changesReply] = await Promise.all([treePromise, filePromise, gitPromise]);
        if (current !== revision || path !== selected() || mode !== selectedMode()) { pending = true; continue; }
        if (mode === 'file' && !path && view.firstReadme()) { history.replaceState({ scroll: 0 }, '', fileURL(view.firstReadme()!)); pending = true; pendingForeground ||= foreground; revision++; continue; }
        const pathChanged = path !== displayedPath || mode !== displayedMode;
        if (pathChanged) { main.scrollTop = history.state?.scroll ?? 0; displayedHTML = ''; view.pruneInactive(); }
        displayedPath = path; displayedMode = mode;
        if (path) lastFilePath = path;
        if (changesReply) {
          currentChanges = changesReply;
          if (review.sync(changesReply)) reviewVersion++;
          updateChangeViews();
        }
        if (mode === 'changes') {
          status('Checking every few seconds', 'ok'); continue;
        }
        if (mode === 'paste') {
          if (pathChanged || content.dataset.kind !== 'paste') showPaste();
          status('Checking every few seconds', 'ok'); continue;
        }
        if (!path) { if (pathChanged) showTitle(''); showEmpty(); status('Checking every few seconds', 'ok'); continue; }
        if (fileReply && 'error' in fileReply) {
          if (fileReply.error instanceof RequestError && fileReply.error.code === 'network') throw fileReply.error;
          showError(fileReply.error, path); displayedHTML = ''; displayedTag = ''; status('Checking every few seconds', 'ok'); continue;
        }
        if (mode === 'diff' && fileReply && 'value' in fileReply) {
          const diff = fileReply.value as DiffReply;
          const displayKey = `${diff.kind}\n${diff.patch}`;
          if (displayedHTML !== displayKey) {
            content.dataset.kind = 'diff'; renderDiff(content, diff); displayedHTML = displayKey;
            outline.hidden = true; showTitle(path, 'diff');
          }
          status('Checking every few seconds', 'ok'); continue;
        }
        if (fileReply && 'value' in fileReply) {
          const file = fileReply.value as FileReply | null;
          if (!file) { status('Checking every few seconds', 'ok'); continue; }
          const displayKey = 'assetUrl' in file ? file.assetUrl : 'previewUrl' in file ? previewURL(file.previewUrl, path) : file.html;
          const changed = displayedHTML !== displayKey || displayedSource !== source;
          if (changed) {
            const oldScroll = main.scrollTop;
            content.dataset.kind = file.type === 'image' ? 'image' : source ? 'code' : file.type;
            if ('previewUrl' in file) {
              content.replaceChildren(createPreviewFrame(file.previewUrl, path, 'left'));
            } else if (file.type === 'image') {
              const img = document.createElement('img'); img.className = 'image-preview'; img.alt = path.split('/').at(-1) ?? path;
              img.addEventListener('error', () => { if (img.isConnected && selected() === path) { displayedHTML = ''; showError(new RequestError('invalid_asset', 'image load failed'), path); } });
              img.src = file.assetUrl; content.replaceChildren(img);
            } else { content.innerHTML = file.html; decorateContent(); }
            displayedHTML = displayKey; displayedSource = source;
            updateOutline(); showTitle(path, file.type);
            if (!pathChanged && oldScroll > 0) main.scrollTop = oldScroll;
            if (location.hash && file.type !== 'html' && !highlightCodeLines(pathChanged)) {
              try { if (pathChanged) document.getElementById(decodeURIComponent(location.hash.slice(1)))?.scrollIntoView(); } catch { /* Invalid fragment. */ }
            }
            if (!pathChanged && current > 1) {
              title.classList.add('updated'); const note = document.createElement('span'); note.className = 'update-note'; note.textContent = 'Updated'; title.querySelector('.title-actions')?.prepend(note);
              clearTimeout(updatedTimer); updatedTimer = setTimeout(() => { title.classList.remove('updated'); note.remove(); }, 3500);
            }
            void drawMermaid(content, () => path === selected() && source === sourceMode);
          }
          if (pathChanged) view.reveal(path);
          if (pathChanged && !preserveTabFocus) title.focus({ preventScroll: true });
        }
        status('Checking every few seconds', 'ok');
      } catch (error) {
        if (current !== revision) { pending = true; continue; }
        if (foreground || path !== displayedPath || mode !== displayedMode || !(error instanceof RequestError && error.code === 'network')) showError(error, path);
        status('Refresh failed. Please try again.', 'error');
      } finally { if (foreground) { activeForeground = false; endLoading(); } }
    }
  } finally { running = false; if (pending) void refreshLoop(); }
}

tree.addEventListener('click', (event) => {
  const rightButton = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-right-path]');
  if (rightButton) { openRight(rightButton.dataset.rightPath!); return; }
  const link = (event.target as HTMLElement).closest<HTMLAnchorElement>('a[href]');
  if (!link || event.metaKey || event.ctrlKey || event.shiftKey) return;
  event.preventDefault(); navigate(link.href);
});
changesTree.addEventListener('click', (event) => {
  const link = (event.target as HTMLElement).closest<HTMLAnchorElement>('a[href]');
  if (!link || event.metaKey || event.ctrlKey || event.shiftKey) return;
  event.preventDefault(); navigate(link.href);
});
function selectSidebarTab(mode: 'file' | 'changes'): void {
  const target = mode === 'file' ? lastFilePath ? fileURL(lastFilePath) : '/' : '/?view=changes';
  keepTabFocus = new URL(target, location.href).href !== location.href;
  sidebarPanel = mode; showSidebar(mode);
  navigate(target);
  if (window.innerWidth <= 700) sidebar.classList.add('open');
  (mode === 'file' ? filesTab : changesTab).focus();
}
filesTab.addEventListener('click', () => selectSidebarTab('file'));
changesTab.addEventListener('click', () => selectSidebarTab('changes'));
document.querySelector<HTMLElement>('.sidebar-tabs')!.addEventListener('keydown', (event) => {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  event.preventDefault();
  const mode = event.key === 'Home' ? 'file' : event.key === 'End' ? 'changes' : document.activeElement === filesTab ? 'changes' : 'file';
  selectSidebarTab(mode);
});
pasteToggle.addEventListener('click', () => { headerExtras.classList.remove('open'); headerMore.setAttribute('aria-expanded', 'false'); navigate('/?view=paste'); });
headerMore.addEventListener('click', () => {
  const open = headerExtras.classList.toggle('open'); headerMore.setAttribute('aria-expanded', String(open));
  if (open) headerExtras.querySelector<HTMLButtonElement>('button')?.focus();
});
headerExtras.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape' || !headerExtras.classList.contains('open') || !document.querySelector<HTMLElement>('#theme-menu')?.hidden) return;
  event.preventDefault(); headerExtras.classList.remove('open'); headerMore.setAttribute('aria-expanded', 'false'); headerMore.focus();
});
function onContentClick(event: MouseEvent, pane: 'left' | 'right'): void {
  const target = event.target as HTMLElement;
  const lineLink = pane === 'left' ? target.closest<HTMLAnchorElement>('.lnlinks, .wrapped-line-number') : null;
  if (lineLink) {
    const number = Number(lineLink.hash.slice(2));
    if (Number.isSafeInteger(number) && number > 0) {
      event.preventDefault();
      const start = event.shiftKey && lineRangeAnchor ? Math.min(number, lineRangeAnchor) : number;
      const end = event.shiftKey && lineRangeAnchor ? Math.max(number, lineRangeAnchor) : number;
      if (!event.shiftKey) lineRangeAnchor = number;
      const url = new URL(location.href); url.hash = end > start ? `L${start}-L${end}` : `L${start}`;
      history.replaceState(history.state, '', url); highlightCodeLines(true);
    }
    return;
  }
  const action = target.closest<HTMLButtonElement>('[data-diagram-action]');
  if (action) {
    const diagram = action.closest<HTMLElement>('[data-mermaid]')!;
    if (action.dataset.diagramAction === 'source') {
      const image = diagram.querySelector<HTMLElement>('.diagram-image')!; const showing = image.hidden; image.hidden = !showing;
      let source = diagram.querySelector<HTMLElement>('.diagram-source');
      if (!source) { source = document.createElement('pre'); source.className = 'diagram-source'; source.textContent = diagram.dataset.source ?? ''; diagram.append(source); }
      source.hidden = showing; action.textContent = showing ? 'Source' : 'Diagram';
    } else {
      const svg = diagram.querySelector<SVGSVGElement>('.diagram-image svg');
      if (svg) diagramOverlay.open(svg, action);
    }
    return;
  }
  const link = target.closest<HTMLAnchorElement>('a[href]');
  if (!link || event.metaKey || event.ctrlKey || event.shiftKey || link.origin !== location.origin || link.pathname !== '/' || !new URL(link.href).searchParams.has('path')) return;
  if (link.pathname === location.pathname && link.search === location.search && link.hash) return;
  event.preventDefault(); if (pane === 'right') openRight(new URL(link.href).searchParams.get('path')!); else navigate(link.href);
}
content.addEventListener('click', (event) => onContentClick(event, 'left'));
rightContent.addEventListener('click', (event) => onContentClick(event, 'right'));
document.querySelector('#right-close')!.addEventListener('click', closeRight);
rightSource.addEventListener('click', () => { rightSourceMode = true; rightShownKey = ''; rightTag = ''; void refreshRight(); });
rightRendered.addEventListener('click', () => { rightSourceMode = false; rightShownKey = ''; rightTag = ''; void refreshRight(); });
rightContents.addEventListener('click', () => rightOutline.classList.toggle('open'));
document.querySelector('#right-copy')!.addEventListener('click', (event) => { const path = rightSelected(); if (path) copyWithFeedback(event.currentTarget as HTMLButtonElement, path, '⧉'); });
document.querySelector('#right-swap')!.addEventListener('click', swapPanes);
document.querySelector('#right-only')!.addEventListener('click', showRightOnly);
rightInteractive.addEventListener('click', () => { const path = rightSelected(); if (path) setInteractive(path, !interactivePaths.has(path)); });
window.addEventListener('popstate', () => { pasteVersion++; sidebarPanel = selectedMode() === 'changes' || selectedMode() === 'diff' ? 'changes' : 'file'; sourceMode = new URL(location.href).searchParams.get('source') === '1'; requestRefresh(); });
window.addEventListener('hashchange', () => { highlightCodeLines(true); });
window.addEventListener('keydown', (event) => {
  if (event.isComposing || event.keyCode === 229) return;
  const target = event.target;
  const editing = target instanceof HTMLElement && (target.isContentEditable || target.closest('input, textarea, [contenteditable]') !== null);
  if (editing) return;
  if (selectedMode() === 'diff' && !event.ctrlKey && !event.metaKey && !event.altKey) {
    if (event.key === 'n' || event.key === 'p') {
      const next = diffNeighbor(selected(), event.key === 'n' ? 1 : -1, onlyUnreviewed);
      if (next) { event.preventDefault(); navigate(diffURL(next.path)); }
      return;
    }
    if (event.key === 'r') { event.preventDefault(); markReviewedAndNext(); return; }
  }
  if ((event.key === '/' || ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k'))) { event.preventDefault(); search.focus(); sidebar.classList.add('open'); }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'b') { event.preventDefault(); sidebarToggle.click(); }
  if (event.key === 'Escape') { sidebar.classList.remove('open'); outline.classList.remove('open'); diagramOverlay.close(); }
});
reload.addEventListener('click', manualRefresh);
drawerToggle.addEventListener('click', () => sidebar.classList.toggle('open'));
sidebarToggle.addEventListener('click', () => { const collapsed = sidebar.classList.toggle('collapsed'); sidebarToggle.setAttribute('aria-expanded', String(!collapsed)); sidebarToggle.setAttribute('aria-label', collapsed ? 'Expand sidebar' : 'Collapse sidebar'); });
const resize = document.querySelector<HTMLElement>('#sidebar-resize')!;
resize.addEventListener('pointerdown', (event) => { resize.setPointerCapture(event.pointerId); resize.classList.add('dragging'); });
resize.addEventListener('pointermove', (event) => { if (!resize.hasPointerCapture(event.pointerId)) return; const width = Math.max(200, Math.min(480, event.clientX)); document.documentElement.style.setProperty('--sidebar-width', `${width}px`); localStorage.setItem('markport-sidebar-width', String(width)); });
resize.addEventListener('pointerup', () => resize.classList.remove('dragging'));
resize.addEventListener('pointercancel', () => resize.classList.remove('dragging'));
resize.addEventListener('keydown', (event) => { if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return; const width = Math.max(200, Math.min(480, Number(localStorage.getItem('markport-sidebar-width') ?? 280) + (event.key === 'ArrowRight' ? 10 : -10))); document.documentElement.style.setProperty('--sidebar-width', `${width}px`); localStorage.setItem('markport-sidebar-width', String(width)); });
initTheme(document.querySelector<HTMLButtonElement>('#theme-toggle')!, () => { updateBrand(); if (content.querySelector('[data-mermaid]')) { if (selectedMode() === 'paste') refreshPastedPreview?.(); else { displayedHTML = ''; requestRefresh(); } } if (rightContent.querySelector('[data-mermaid]')) { rightShownKey = ''; void refreshRight(); } });
updateBrand();
status('Checking every few seconds', 'ok');
requestRefresh();
const pollTimer = setInterval(() => { if (!document.hidden) requestRefresh(false); }, 3000);
window.addEventListener('pagehide', () => { clearInterval(pollTimer); onSearchChange(''); });
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) {
    requestRefresh(false);
    if (search.value.trim() && Date.now() - searchIndexCheckedAt >= 10000 && !searchIndexRequest) void loadSearchIndex();
  }
});
