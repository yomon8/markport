import { createDirectoryBrowser } from './directoryBrowser';
import { createChangesView } from './changesView';
import { RequestError, type FileReply, type ApiError } from './api';
import { createRightPane } from './rightPane';
import { createPreview } from './preview';
import { createRefreshScheduler } from './refresh';
import { createFileSearch } from './fileSearch';
import { createOutline } from './outline';
import { createContentDecoration } from './contentDecorate';
import { createVimKeys, scrollVim, vimBlocked } from './vimNavigation';
import { FileGitView, fileView, fileViewURL, type FileView } from './fileGit';
import { iconSVG, setIcon } from './icons';
import './style.css';
import { createActivePane } from './activePane';
import { createSplitResize } from './splitResize';
import { drawMermaid } from './mermaid';
import { drawMath } from './math';
import { TreeView } from './tree';
import { effectiveTheme, initTheme } from './theme';
import { renderDiff, diffURL, type ChangesReply, type DiffReply } from './diff';
import { comparisonURL, historyURL, type HistoryPage } from './history';
import { initContentSearch } from './contentSearch';
import { setToolButton } from './toolButtons';
import { createPasteEditor } from './pasteEditor';
import { createContentWidth } from './contentWidth';
import { TabTitle } from './tabTitle';
import { ServerInfo } from './serverInfo';
import { createDiagramOverlay } from './diagramOverlay';
import { createShortcutHelp } from './shortcutHelp';
import { createTableOverlay } from './tableOverlay';
import { createPrintView, printFile } from './printView';
import { editingShortcutTarget, matchesShortcut, shortcutText } from './shortcuts';
import symbolLight from '../../logo/markport-symbol-light.svg';
import symbolDark from '../../logo/markport-symbol-dark.svg';
import favicon from '../../logo/markport-favicon.svg';

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('app missing');
app.innerHTML = `<a class="skip-link" href="#content">Skip to content</a><header><button id="drawer-toggle" type="button" aria-label="Open file list">${iconSVG('menu')}</button><button id="sidebar-toggle" type="button" aria-label="Collapse sidebar" aria-expanded="true">${iconSVG('panelLeft')}</button><span class="brand" role="img" aria-label="markport"><img class="brand-symbol" src="${symbolLight}" alt=""></span><span id="root-name"></span><span id="connection" role="status" data-state="connecting"><span class="connection-label">Connecting…</span></span><div id="header-extras"><button id="theme-toggle" type="button"></button><button id="paste-toggle" type="button" aria-label="Paste Markdown" title="Paste Markdown">${iconSVG('clipboard')}</button></div><button id="header-more" type="button" aria-label="App settings" title="App settings" aria-expanded="false" aria-controls="header-extras">${iconSVG('settings')}</button><button id="reload" type="button" aria-label="Refresh" title="Refresh now"><span class="reload-icon" aria-hidden="true">${iconSVG('refresh')}</span></button></header><div class="layout"><aside id="sidebar"><div class="sidebar-tabs" role="tablist" aria-label="Sidebar views"><button id="files-tab" type="button" role="tab" aria-controls="files-panel">Files</button><button id="changes-tab" type="button" role="tab" aria-controls="changes-tree">Changes</button><button id="history-tab" type="button" role="tab" aria-controls="history-tree">History</button></div><div id="files-panel" role="tabpanel" aria-labelledby="files-tab"><form role="search" onsubmit="return false"><div class="files-search-heading"><label for="search">Search files</label><button id="collapse-all" type="button" aria-label="Collapse all folders" title="Collapse all folders" disabled>Collapse all</button></div><input id="search" type="search" placeholder="Path or file name, e.g. file.md:123"><span id="result-count"></span></form><nav id="tree" aria-label="File list"></nav></div><nav id="changes-tree" role="tabpanel" aria-labelledby="changes-tab" aria-label="Changed files" hidden></nav><nav id="history-tree" role="tabpanel" aria-labelledby="history-tab" aria-label="Commit history" hidden></nav></aside><div id="sidebar-resize" role="separator" aria-orientation="vertical" aria-label="Resize sidebar" tabindex="0"></div><main id="main"><div id="connection-banner" hidden></div><div id="file-title" tabindex="-1"></div><div id="progress" hidden></div><div class="content-layout"><article id="content" tabindex="-1" aria-busy="false"></article><nav id="outline" aria-label="Table of contents" hidden></nav></div></main><div id="split-resize" aria-label="Resize file panes" hidden></div><section id="right-pane" aria-label="Right file" hidden><div id="right-title"><div id="right-path" class="breadcrumbs"></div><div class="right-actions"><span id="right-kind" class="kind-badge"></span><div id="right-views" class="view-segment" role="group" aria-label="Preview or Source"><button id="right-rendered" type="button" aria-pressed="true">Preview</button><button id="right-source" type="button" aria-pressed="false">Source</button></div><button id="right-interactive" type="button" hidden>Enable JavaScript</button><button id="right-copy" type="button" class="title-icon" aria-label="Copy path" title="Copy path">${iconSVG('copy')}</button><button id="right-contents" type="button" class="title-icon" aria-label="Contents" title="Contents" hidden>${iconSVG('list')}</button><button id="right-swap" type="button" class="title-icon" aria-label="Swap panes" title="Swap panes">${iconSVG('swap')}</button><button id="right-only" type="button" class="title-icon" aria-label="Show this file only" title="Show this file only">${iconSVG('maximize')}</button><button id="right-close" type="button" class="title-icon" aria-label="Close split view" title="Close split view">${iconSVG('close')}</button></div></div><article id="right-content" aria-busy="false"></article><nav id="right-outline" aria-label="Right table of contents" hidden></nav></section></div><div id="diagram-overlay" hidden><button type="button" id="overlay-close">Close ×</button><div id="overlay-content"></div></div>`;
const diagramOverlay = createDiagramOverlay();
const tableOverlay = createTableOverlay();
const printView = createPrintView();
const contentWidth = createContentWidth();
const icon = document.querySelector<HTMLLinkElement>('link[rel="icon"]') ?? document.createElement('link');
icon.rel = 'icon'; icon.type = 'image/svg+xml'; icon.href = favicon;
if (!icon.isConnected) document.head.append(icon);
function updateBrand(): void {
  const dark = effectiveTheme() === 'dark';
  document.querySelector<HTMLImageElement>('.brand-symbol')!.src = dark ? symbolDark : symbolLight;
}
const tree = document.querySelector<HTMLElement>('#tree')!;
const changesTree = document.querySelector<HTMLElement>('#changes-tree')!;
const historyTree = document.querySelector<HTMLElement>('#history-tree')!;
const filesPanel = document.querySelector<HTMLElement>('#files-panel')!;
const contentSearch = document.createElement('details');
contentSearch.id = 'content-search';
const filesList = document.createElement('div');
filesList.id = 'files-list';
filesPanel.querySelector('form')!.after(filesList);
filesList.append(contentSearch, tree);
initContentSearch(contentSearch, openSelectedFile);
const filesTab = document.querySelector<HTMLButtonElement>('#files-tab')!;
const changesTab = document.querySelector<HTMLButtonElement>('#changes-tab')!;
const historyTab = document.querySelector<HTMLButtonElement>('#history-tab')!;
const content = document.querySelector<HTMLElement>('#content')!;
const title = document.querySelector<HTMLElement>('#file-title')!;
const search = document.querySelector<HTMLInputElement>('#search')!;
const count = document.querySelector<HTMLElement>('#result-count')!;
const collapseAll = document.querySelector<HTMLButtonElement>('#collapse-all')!;
const connection = document.querySelector<HTMLElement>('#connection')!;
const banner = document.querySelector<HTMLElement>('#connection-banner')!;
const reload = document.querySelector<HTMLButtonElement>('#reload')!;
const helpToggle = document.createElement('button'); helpToggle.id = 'help-toggle'; helpToggle.type = 'button'; helpToggle.textContent = '?';
helpToggle.setAttribute('aria-label', `Keyboard shortcuts (${shortcutText('help')})`); helpToggle.title = `Keyboard shortcuts (${shortcutText('help')})`;
reload.before(helpToggle);
const shortcutHelp = createShortcutHelp(helpToggle);
const infoToggle = document.createElement('button'); infoToggle.id = 'server-info-toggle'; infoToggle.type = 'button';
infoToggle.setAttribute('aria-label', 'Server info'); infoToggle.title = `Server info (${shortcutText('serverInfo')})`; setIcon(infoToggle, 'info');
helpToggle.before(infoToggle);
const serverInfo = new ServerInfo(infoToggle);
const pasteToggle = document.querySelector<HTMLButtonElement>('#paste-toggle')!;
pasteToggle.title = `Paste Markdown (${shortcutText('pasteMode')})`;
const headerMore = document.querySelector<HTMLButtonElement>('#header-more')!;
const headerExtras = document.querySelector<HTMLElement>('#header-extras')!;
const tabTitleButton = document.createElement('button'); tabTitleButton.id = 'tab-title-toggle'; tabTitleButton.type = 'button';
tabTitleButton.textContent = 'Title'; tabTitleButton.setAttribute('aria-label', 'Title'); tabTitleButton.title = 'Set tab title';
headerExtras.append(tabTitleButton);
const tabTitle = new TabTitle(tabTitleButton);
void tabTitle.reload();
const main = document.querySelector<HTMLElement>('#main')!;
const layout = document.querySelector<HTMLElement>('.layout')!;
const rightPane = document.querySelector<HTMLElement>('#right-pane')!;
const activePane = createActivePane({ left: main, right: rightPane, leftTitle: title, rightTitle: document.querySelector<HTMLElement>('#right-title')!, onChange: () => { void syncSelectedFile(); } });
let fileSelectionVersion = 0;
const splitResize = createSplitResize({ container: layout, left: main, right: rightPane, handle: document.querySelector<HTMLElement>('#split-resize')!, storageKey: 'markport-file-split-ratio', horizontal: () => window.innerWidth > 700 });
const rightContent = document.querySelector<HTMLElement>('#right-content')!;
let lineRangeAnchor = 0;
let pendingLineJump = false;
const progress = document.querySelector<HTMLElement>('#progress')!;
const outline = document.querySelector<HTMLElement>('#outline')!;
const sidebar = document.querySelector<HTMLElement>('#sidebar')!;
const drawerToggle = document.querySelector<HTMLButtonElement>('#drawer-toggle')!;
drawerToggle.title = `Open file list (${shortcutText('sidebar')})`;
const sidebarToggle = document.querySelector<HTMLButtonElement>('#sidebar-toggle')!;
sidebarToggle.title = `Collapse sidebar (${shortcutText('sidebar')})`;
const view = new TreeView(tree, search, count, collapseAll, selectedFile,
  (path) => { const current = refresh.revision; void loadPage(path, 0, '', false, current).then(() => loadOpenDirectories(current)).catch(() => status('Refresh failed. Please try again.', 'error')); },
  (path, offset) => { const current = refresh.revision; void loadPage(path, offset, '', false, current).catch(() => status('Refresh failed. Please try again.', 'error')); },
  (query) => onSearchChange(query));
let displayedPath = ''; let displayedHTML = ''; let displayedSource = false; let sourceMode = new URL(location.href).searchParams.get('source') === '1';
let displayedMode: FileView | 'changes' | 'paste' | 'history' = 'file'; let lastFilePath = '';
let sidebarPanel: 'file' | 'changes' | 'history' = selectedMode() === 'history' ? 'history' : selectedMode() === 'changes' || selectedMode() === 'diff' ? 'changes' : 'file';
let keepTabFocus = false;
let keyboardTreePath = '';
let rememberedBase = new URL(location.href).searchParams.get('base') ?? '';
let displayedTag = '';
let displayedTagCheckedAt = 0;
let rootName = '';
let pasteVersion = 0;
let refreshPastedPreview: (() => void) | undefined;
let pasteEditor: ReturnType<typeof createPasteEditor> | undefined;
let loadingTimer: ReturnType<typeof setTimeout> | undefined;
let updatedTimer: ReturnType<typeof setTimeout> | undefined;
const fileSearch = createFileSearch({ getQuery: () => search.value, view });
const { loadSearchIndex, onSearchChange } = fileSearch;
const refresh = createRefreshScheduler({
  run: refreshLoop, interval: 3000, onVisible: fileSearch.refreshIfStale,
  onIndexChange: () => { if (search.value.trim()) void loadSearchIndex(true); },
  onModeChange: fileSearch.setMode,
});
const preview = createPreview({
  content, rightContent, selected: (pane) => pane === 'left' ? selected() : rightSelected(),
  navigate, openRight: (path) => openRight(path), requestRefresh, refreshRight: () => { void refreshRight(); },
  invalidate: () => { displayedHTML = ''; displayedTag = ''; rightController.invalidate(); },
  onInstance: () => { void tabTitle.reload(true); void serverInfo.reloadIfOpen(); },
});
const { syncPreviewInstance, createPreviewFrame, createPDFFrame, filePreviewKey } = preview;
const rightController = createRightPane({
  main, layout, rightPane, rightContent, sidebar, contentWidth, activePane, splitResize,
  selected, selectedMode, getSourceMode: () => sourceMode, setSourceMode: (value) => { sourceMode = value; },
  setSidebarPanel: (mode) => { sidebarPanel = mode; }, getRememberedBase: () => rememberedBase,
  getGit, saveScroll, requestRefresh, syncSelectedFile, preview,
  decorateContent: (root, path) => decorateContent(root, path),
  highlightCodeLines: (scroll, root, hash) => highlightCodeLines(scroll, root, hash),
  updateRightOutline: () => updateRightOutline(), downloadFile, openPDF,
  printFile: (path, opener) => printView.open(printFile(path), opener),
});
const { rightSelected, openRight, refreshRight } = rightController;
const rightOutline = document.querySelector<HTMLElement>('#right-outline')!;
const rightContents = document.querySelector<HTMLButtonElement>('#right-contents')!;
const outlineController = createOutline({ content, outline, main, rightContent, rightOutline, rightContents });
const { updateOutline, updateRightOutline } = outlineController;
const decoration = createContentDecoration({
  content, rightContent, main, title, contentWidth, tableOverlay,
  getPath: () => displayedPath, getRightHash: () => rightController.lineHash,
  onLineStart: (line) => { if (!lineRangeAnchor) lineRangeAnchor = line; },
});
const { decorateContent, highlightCodeLines } = decoration;
const directoryBrowser = createDirectoryBrowser({
  view, getRevision: () => refresh.revision, syncPreviewInstance,
  onRoot: (name) => { rootName = name || rootName; document.querySelector('#root-name')!.textContent = rootName; },
  onError: () => status('Refresh failed. Please try again.', 'error'),
});
const { loadPage, ensureSelectedPath, loadOpenDirectories, refreshDirectories } = directoryBrowser;
const changesView = createChangesView({
  content, title, outline, main, changesTree, historyTree, changesTab, sidebar, sidebarToggle,
  view, tabTitle, contentWidth, preview, printView, selected, selectedMode, selectedBase,
  getSourceMode: () => sourceMode, setSourceMode: (value) => { sourceMode = value; },
  getRememberedBase: () => rememberedBase, getRootName: () => rootName,
  getDisplayedHTML: () => displayedHTML, setDisplayedHTML: (html) => { displayedHTML = html; },
  getDisplayedPath: () => displayedPath, getDisplayedMode: () => displayedMode,
  showFiles: () => { sidebarPanel = 'file'; showSidebar(sidebarPanel); },
  selectFileView, navigate, openRight, openPDF, downloadFile, requestRefresh, getGit,
});
const { showTitle, syncComparisonControls, diffNeighbor, markReviewedAndNext } = changesView;
const savedWidth = Number(localStorage.getItem('markport-sidebar-width'));
if (savedWidth >= 200 && savedWidth <= 480) document.documentElement.style.setProperty('--sidebar-width', `${savedWidth}px`);

function selected(): string { return new URL(location.href).searchParams.get('path') ?? ''; }
function selectedFile(): string { return activePane.current() === 'right' && rightSelected() ? rightSelected() : selected(); }
async function syncSelectedFile(): Promise<void> {
  const version = ++fileSelectionVersion; const path = selectedFile(); const current = refresh.revision;
  view.render();
  try {
    if (view.shouldLoadSelectedPath(path)) await ensureSelectedPath(path, current);
    if (version !== fileSelectionVersion || current !== refresh.revision || path !== selectedFile()) return;
    await loadOpenDirectories(current);
  } catch (error) {
    if (!(error instanceof RequestError && error.code === 'not_found') && version === fileSelectionVersion) status('Refresh failed. Please try again.', 'error');
  }
}
function openSelectedFile(href: string, keepTreeFocus = false): void {
  const url = new URL(href, location.href);
  const path = url.searchParams.get('path');
  if (activePane.current() === 'right' && rightSelected() && path) {
    const line = /^#L(\d+)$/.exec(url.hash);
    openRight(path, line ? Number(line[1]) : undefined, keepTreeFocus);
  } else { activePane.select('left'); navigate(href, keepTreeFocus); }
}
function selectedBase(): string { return new URL(location.href).searchParams.get('base') ?? ''; }
function fileURL(path: string): string { return `/?path=${encodeURIComponent(path)}`; }
function downloadFile(path: string): void {
  const link = document.createElement('a');
  link.href = `/api/download?path=${encodeURIComponent(path)}`;
  link.download = path.split('/').at(-1) ?? path;
  document.body.append(link); link.click(); link.remove();
}
function pdfFileURL(path: string): string { return `/api/pdf?path=${encodeURIComponent(path)}`; }
function openPDF(path: string): void { window.open(pdfFileURL(path), '_blank', 'noopener,noreferrer'); }
const leftFileGit = new FileGitView(content, 'left', getGit, (url) => navigate(url.href));
function selectFileView(mode: FileView): void {
  const url = fileViewURL(new URL(location.href), 'left', mode);
  if (mode === 'diff' && rememberedBase) url.searchParams.set('base', rememberedBase);
  if (sourceMode) url.searchParams.set('source', '1');
  navigate(url.href);
}
function selectedMode(): FileView | 'changes' | 'paste' | 'history' {
  const view = new URL(location.href).searchParams.get('view');
  return view === 'history' ? 'history' : view === 'paste' ? 'paste' : view === 'changes' ? 'changes' : selected() ? fileView(new URL(location.href), 'left') : 'file';
}
function showSidebar(mode: 'file' | 'changes' | 'history'): void {
  filesPanel.hidden = mode !== 'file'; changesTree.hidden = mode !== 'changes'; historyTree.hidden = mode !== 'history';
  for (const [tab, value] of [[filesTab, 'file'], [changesTab, 'changes'], [historyTab, 'history']] as const) {
    tab.setAttribute('aria-selected', String(mode === value)); tab.tabIndex = mode === value ? 0 : -1;
  }
}
function saveScroll(): void { history.replaceState({ ...history.state, scroll: main.scrollTop, rightScroll: rightPane.scrollTop }, '', location.href); }
function navigate(url: string, keepTreeFocus = false): void {
  const target = new URL(url, location.href);
  keyboardTreePath = keepTreeFocus ? target.searchParams.get('path') ?? '' : '';
  const right = new URL(location.href).searchParams.get('right');
  if (right && target.searchParams.has('path') && !['history', 'changes', 'paste'].includes(target.searchParams.get('view') ?? '')) {
    const previous = new URL(location.href);
    target.searchParams.set('right', right);
    for (const [key, value] of previous.searchParams) if (key.startsWith('right-') && !target.searchParams.has(key)) target.searchParams.set(key, value);
  }
  if (target.href === location.href) { highlightCodeLines(true); return; }
  pendingLineJump = /^#L\d+(?:-L\d+)?$/.test(target.hash);
  if (target.searchParams.get('view') === 'changes' || target.searchParams.get('view') === 'diff') rememberedBase = target.searchParams.get('base') ?? '';
  saveScroll(); pasteVersion++; lineRangeAnchor = 0; history.pushState({ scroll: 0, rightScroll: rightPane.scrollTop }, '', target); sidebarPanel = selectedMode() === 'history' ? 'history' : selectedMode() === 'changes' || selectedMode() === 'diff' ? 'changes' : 'file'; sourceMode = target.searchParams.get('source') === '1'; if (!keepTreeFocus) sidebar.classList.remove('open'); requestRefresh();
}
const liveMessage = 'Live · auto-refresh on';
function status(message: string, state: 'ok' | 'connecting' | 'error'): void {
  if (connection.dataset.state === state && connection.title === message) return;
  connection.querySelector<HTMLElement>('.connection-label')!.textContent = message; connection.dataset.state = state; connection.title = message; connection.setAttribute('aria-label', message);
  banner.hidden = state === 'ok'; banner.replaceChildren();
  if (state !== 'ok') {
    banner.append(document.createTextNode(state === 'error' ? 'Refresh failed. Check the connection and files.' : 'Checking connection.'));
    if (state === 'error') { const button = document.createElement('button'); button.textContent = 'Refresh now'; button.addEventListener('click', manualRefresh); banner.append(button); }
  }
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
  if (expectedRevision === refresh.revision) {
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
function showEmpty(): void {
  const detailText = 'Select a file from the list, or press / to search.';
  if (content.querySelector('.empty-state p')?.textContent === detailText) return;
  content.replaceChildren(); const box = document.createElement('div'); box.className = 'empty-state';
  const heading = document.createElement('h2'); heading.textContent = 'Select a file';
  const detail = document.createElement('p'); detail.textContent = detailText;
  box.append(heading, detail); content.append(box); outline.hidden = true;
}
function showPaste(): void {
  pasteEditor?.dispose();
  tabTitle.setFallback('Pasted Markdown — markport');
  outline.hidden = true;
  pasteEditor = createPasteEditor({
    content, title, main,
    isActive: () => selectedMode() === 'paste',
    nextVersion: () => ++pasteVersion,
    version: () => pasteVersion,
    onPrint: (markdown, button) => printView.open(markdown, button),
    createWidthButton: contentWidth.createButton,
    onText: () => { outlineController.clear(); },
    onPreview: (preview, current) => {
      decorateContent(); updateOutline();
      void drawMermaid(preview, current); void drawMath(preview, current);
    },
  });
  refreshPastedPreview = pasteEditor.refresh;
}
function showError(error: unknown, path: string): void {
  const code = error instanceof RequestError ? error.code : 'network';
  const comparison = (selectedMode() === 'changes' || selectedMode() === 'diff') && Boolean(selectedBase());
  const errorKey = JSON.stringify([path, code, error instanceof Error ? error.message : '']);
  if (content.querySelector('.file-error')?.getAttribute('data-error-key') === errorKey) return;
  const messages: Record<string, [string, string]> = {
    not_found: ['File not found', 'This file was deleted or moved.'],
    too_large: ['File too large', 'This file exceeds the size limit.'],
    invalid_asset: ['Cannot display image', 'The image could not be loaded. Check the file and try again.'],
    invalid_pdf: ['Cannot display PDF', 'This file is not a valid PDF.'],
    binary: ['Cannot display file', 'Binary files cannot be displayed.'],
    unreadable: ['Cannot read file', 'This file cannot be read.'],
    not_regular: ['Cannot read file', 'This file cannot be read.'],
    network: ['Cannot connect', 'Cannot connect to the server. Check that markport is running.'],
    no_change: ['No diff', 'This file has no changes since HEAD.'],
    git_unavailable: ['Cannot display Git diff', 'Check that Git is available for this repository.'],
    git_failure: ['Cannot load Git diff', 'Please try again.'],
  };
  const [heading, description] = comparison && code === 'not_found' ? ['Commit not found', 'Enter a commit from the current history and try again.']
    : comparison && code === 'no_change' ? ['No diff', 'This file has no changes since the selected commit.']
      : messages[code] ?? ['Cannot display file', 'Please try again.'];
  content.replaceChildren(); const box = document.createElement('div'); box.className = 'file-error'; box.dataset.errorKey = errorKey; box.setAttribute('role', 'alert');
  const icon = document.createElement('span'); icon.textContent = '⚠'; icon.setAttribute('aria-hidden', 'true');
  const h = document.createElement('h2'); h.textContent = heading; const p = document.createElement('p');
  const size = code === 'too_large' && error instanceof RequestError ? error.message.match(/(\d+ MiB) limit \(actual (\d+(?:\.\d+)? MiB)\)/) : undefined;
  p.textContent = size ? `This file exceeds the ${size[1]} limit (${size[2]}).` : description;
  const button = document.createElement('button'); button.type = 'button'; button.textContent = code === 'not_found' && !comparison ? 'Back to root' : 'Try again'; button.addEventListener('click', () => code === 'not_found' && !comparison ? navigate('/') : manualRefresh());
  box.append(icon, h, p, button); content.append(box); outline.hidden = true; showTitle(path, '', code === 'not_found', ['binary', 'too_large', 'invalid_asset', 'invalid_pdf'].includes(code));
}
function beginLoading(): void { content.setAttribute('aria-busy', 'true'); reload.disabled = true; clearTimeout(loadingTimer); loadingTimer = setTimeout(() => { progress.hidden = false; }, 200); }
function endLoading(): void { clearTimeout(loadingTimer); progress.hidden = true; reload.disabled = false; content.setAttribute('aria-busy', 'false'); }
function requestRefresh(foreground = true): void { refresh.request(foreground); }
function manualRefresh(): void {
  void tabTitle.reload();
  void serverInfo.reloadIfOpen();
  displayedTag = ''; rightController.invalidateTag(); directoryBrowser.clearTags(); preview.reload(); requestRefresh();
  if (selectedMode() === 'paste') refreshPastedPreview?.();
  if (search.value.trim()) void loadSearchIndex(true);
}

async function refreshLoop({ revision: current, foreground }: { revision: number; foreground: boolean }): Promise<void> {
  const path = selected(); const source = sourceMode; const mode = selectedMode(); const commitID = new URL(location.href).searchParams.get('commit') ?? ''; const base = selectedBase(); const knownHistoryHead = changesView.historyPage?.head; const preserveTabFocus = keepTabFocus; keepTabFocus = false;
  if (mode === 'changes' || mode === 'diff') rememberedBase = base;
  void refreshRight();
  showSidebar(sidebarPanel);
  syncComparisonControls();
  if (path !== displayedPath || mode !== displayedMode) displayedTag = '';
  if (foreground) { beginLoading(); }
  const treePromise = refreshDirectories(mode === 'changes' || mode === 'paste' || mode === 'history' ? '' : selectedFile(), current);
  const gitPromise = mode === 'changes' || mode === 'diff' ? getGit<ChangesReply>(`/api/git/changes${base ? `?base=${encodeURIComponent(base)}` : ''}`)
    : ['file', 'file-history', 'blame'].includes(mode) ? getGit<ChangesReply>(`/api/git/changes${rememberedBase ? `?base=${encodeURIComponent(rememberedBase)}` : ''}`).catch(() => undefined) : Promise.resolve(undefined);
  const historyPromise = mode === 'history' ? getGit<HistoryPage>('/api/git/history') : Promise.resolve(undefined);
  const commitPromise = mode === 'history' && commitID ? changesView.getCommit(commitID, knownHistoryHead) : Promise.resolve(undefined);
  const historicalDiffPromise = mode === 'history' && commitID && path ? changesView.getHistoricalDiff(commitID, path, knownHistoryHead) : Promise.resolve(undefined);
  const filePromise = mode === 'diff' ? getGit<DiffReply>(`/api/git/diff?path=${encodeURIComponent(path)}${base ? `&base=${encodeURIComponent(base)}` : ''}`).then((value) => ({ value }), (error: unknown) => ({ error }))
    : mode === 'file' && path ? getFile(path, source, current).then((value) => ({ value }), (error: unknown) => ({ error })) : Promise.resolve(null);
  try {
    const [, fileReply, changesReply, firstHistory, commitReply, historyDiffReply] = await Promise.all([treePromise, filePromise, gitPromise, historyPromise, commitPromise, historicalDiffPromise]);
    if (current !== refresh.revision || path !== selected() || mode !== selectedMode() || commitID !== (new URL(location.href).searchParams.get('commit') ?? '') || base !== selectedBase()) { refresh.retry(); return; }
    if ((mode === 'changes' || mode === 'diff') && changesReply?.base && changesReply.base !== base) {
      const canonical = new URL(location.href); canonical.searchParams.set('base', changesReply.base);
      history.replaceState(history.state, '', canonical); rememberedBase = changesReply.base; syncComparisonControls();
    }
    if (mode === 'file' && !path && view.firstReadme()) { history.replaceState({ scroll: 0 }, '', fileURL(view.firstReadme()!)); refresh.retry(foreground, true); return; }
    const pathChanged = path !== displayedPath || mode !== displayedMode;
    if (mode !== 'paste' && pasteEditor) { pasteEditor.dispose(); pasteEditor = undefined; refreshPastedPreview = undefined; }
    if (pathChanged) { main.scrollTop = history.state?.scroll ?? 0; displayedHTML = ''; view.pruneInactive(); }
    displayedPath = path; displayedMode = mode;
    if (path && mode !== 'history') lastFilePath = path;
    if (changesReply) changesView.acceptChanges(changesReply);
    if (firstHistory && changesView.mergeHistory(firstHistory, knownHistoryHead)) { refresh.retry(false, true); return; }
    if (mode === 'history') {
      if (changesView.renderHistory(commitID, path, commitReply, historyDiffReply, pathChanged)) { refresh.retry(false, true); return; }
      status(liveMessage, 'ok'); return;
    }
    if (mode === 'file-history' || mode === 'blame') {
      outline.hidden = true;
      if (pathChanged || content.dataset.kind !== 'file-git') showTitle(path, mode === 'blame' ? 'Blame' : 'History');
      await leftFileGit.refresh(path);
      if (pathChanged && activePane.current() === 'left' && keyboardTreePath !== path) view.reveal(path);
      if (pathChanged && !preserveTabFocus && keyboardTreePath !== path) activePane.withoutActivation(() => title.focus({ preventScroll: true }));
      status(liveMessage, 'ok'); return;
    }
    leftFileGit.invalidate();
    if (mode === 'changes') {
      status(liveMessage, 'ok'); return;
    }
    if (mode === 'paste') {
      if (pathChanged || content.dataset.kind !== 'paste') showPaste();
      status(liveMessage, 'ok'); return;
    }
    if (!path) { if (pathChanged) showTitle(''); showEmpty(); status(liveMessage, 'ok'); return; }
    if (fileReply && 'error' in fileReply) {
      if (fileReply.error instanceof RequestError && fileReply.error.code === 'network') throw fileReply.error;
      showError(fileReply.error, path); displayedHTML = ''; displayedTag = ''; status(liveMessage, 'ok'); return;
    }
    if (mode === 'diff' && fileReply && 'value' in fileReply) {
      const diff = fileReply.value as DiffReply;
      const displayKey = `${diff.kind}\n${diff.patch}`;
      if (displayedHTML !== displayKey) {
        content.dataset.kind = 'diff'; renderDiff(content, diff); displayedHTML = displayKey;
        outline.hidden = true; showTitle(path, 'diff');
      }
      status(liveMessage, 'ok'); return;
    }
    if (fileReply && 'value' in fileReply) {
      const file = fileReply.value as FileReply | null;
      if (!file) { highlightCodeLines(pendingLineJump); pendingLineJump = false; status(liveMessage, 'ok'); return; }
      const displayKey = filePreviewKey(file, path);
      const changed = displayedHTML !== displayKey || displayedSource !== source;
      if (changed) {
        const oldScroll = main.scrollTop;
        content.dataset.kind = file.type === 'image' || file.type === 'pdf' ? file.type : source ? 'code' : file.type;
        if (file.type === 'pdf') {
          content.replaceChildren(createPDFFrame(file.previewUrl, path));
        } else if ('previewUrl' in file) {
          content.replaceChildren(createPreviewFrame(file.previewUrl, path, 'left'));
        } else if (file.type === 'image') {
          const img = document.createElement('img'); img.className = 'image-preview'; img.alt = path.split('/').at(-1) ?? path;
          img.addEventListener('error', () => { if (img.isConnected && selected() === path) { displayedHTML = ''; showError(new RequestError('invalid_asset', 'image load failed'), path); } });
          img.src = file.assetUrl; content.replaceChildren(img);
        } else { content.innerHTML = file.html; decorateContent(); }
        displayedHTML = displayKey; displayedSource = source;
        updateOutline(); showTitle(path, file.type);
        if (location.hash && file.type !== 'html' && !highlightCodeLines(pathChanged)) {
          try { if (pathChanged) document.getElementById(decodeURIComponent(location.hash.slice(1)))?.scrollIntoView(); } catch { /* Invalid fragment. */ }
        }
        if (!pathChanged && current > 1) {
          title.classList.add('updated'); const note = document.createElement('span'); note.className = 'update-note'; note.textContent = 'Updated'; title.querySelector('.title-actions')?.prepend(note);
          clearTimeout(updatedTimer); updatedTimer = setTimeout(() => { title.classList.remove('updated'); note.remove(); }, 3500);
        }
        if (!pathChanged && oldScroll > 0) main.scrollTop = oldScroll;
        void drawMermaid(content, () => path === selected() && source === sourceMode);
        void drawMath(content, () => selectedMode() === 'file' && path === selected() && !sourceMode);
      }
      highlightCodeLines(pendingLineJump); pendingLineJump = false;
      if (pathChanged && activePane.current() === 'left' && keyboardTreePath !== path) view.reveal(path);
      if (pathChanged && !preserveTabFocus && keyboardTreePath !== path) activePane.withoutActivation(() => title.focus({ preventScroll: true }));
    }
    status(liveMessage, 'ok');
  } catch (error) {
    if (current !== refresh.revision) { refresh.retry(); return; }
    if ((mode === 'changes' || mode === 'diff') && base !== (changesView.currentChanges?.base ?? '')) changesView.failComparison();
    if (foreground || path !== displayedPath || mode !== displayedMode || !(error instanceof RequestError && error.code === 'network')) showError(error, path);
    status('Refresh failed. Please try again.', 'error');
  } finally { if (foreground) { endLoading(); } }
}

tree.addEventListener('click', (event) => {
  const rightButton = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-right-path]');
  if (rightButton) { openRight(rightButton.dataset.rightPath!, rightButton.dataset.rightLine ? Number(rightButton.dataset.rightLine) : undefined, view.keyboardOpening || (event.detail === 0 && document.activeElement === rightButton)); return; }
  const link = (event.target as HTMLElement).closest<HTMLAnchorElement>('a[href]');
  if (!link || event.metaKey || event.ctrlKey || event.shiftKey) return;
  event.preventDefault(); openSelectedFile(link.href, view.keyboardOpening);
});
changesTree.addEventListener('click', (event) => {
  const link = (event.target as HTMLElement).closest<HTMLAnchorElement>('a[href]');
  if (!link || event.metaKey || event.ctrlKey || event.shiftKey) return;
  event.preventDefault(); navigate(link.href);
});
historyTree.addEventListener('click', (event) => {
  const link = (event.target as HTMLElement).closest<HTMLAnchorElement>('a[href]');
  if (!link || event.metaKey || event.ctrlKey || event.shiftKey) return;
  event.preventDefault(); navigate(link.href);
});
function selectSidebarTab(mode: 'file' | 'changes' | 'history'): void {
  const target = mode === 'file' ? lastFilePath ? fileURL(lastFilePath) : '/' : mode === 'changes' ? comparisonURL(rememberedBase) : historyURL();
  keepTabFocus = new URL(target, location.href).href !== location.href;
  sidebarPanel = mode; showSidebar(mode);
  navigate(target);
  if (window.innerWidth <= 700) sidebar.classList.add('open');
  (mode === 'file' ? filesTab : mode === 'changes' ? changesTab : historyTab).focus();
}
filesTab.addEventListener('click', () => selectSidebarTab('file'));
changesTab.addEventListener('click', () => selectSidebarTab('changes'));
historyTab.addEventListener('click', () => selectSidebarTab('history'));
document.querySelector<HTMLElement>('.sidebar-tabs')!.addEventListener('keydown', (event) => {
  if (!matchesShortcut(event, 'tabSwitch') && !matchesShortcut(event, 'tabFirst') && !matchesShortcut(event, 'tabLast')) return;
  event.preventDefault();
  const mode = matchesShortcut(event, 'tabFirst') ? 'file' : matchesShortcut(event, 'tabLast') ? 'history' : document.activeElement === filesTab ? 'changes' : document.activeElement === changesTab ? 'history' : 'file';
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
  if (event.defaultPrevented) return;
  const target = event.target as HTMLElement;
  const lineLink = target.closest<HTMLAnchorElement>('.lnlinks, .wrapped-line-number');
  if (lineLink) {
    const number = Number(lineLink.hash.slice(2));
    if (Number.isSafeInteger(number) && number > 0) {
      event.preventDefault();
      if (pane === 'right') { rightController.selectLine(number); return; }
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
      source.hidden = showing; setToolButton(action, showing ? 'code' : 'diagram', showing ? 'Source' : 'Diagram');
    } else {
      const svg = diagram.querySelector<SVGSVGElement>('.diagram-image svg');
      if (svg) diagramOverlay.open(svg, action);
    }
    return;
  }
  const link = target.closest<HTMLAnchorElement>('a[href]');
  if (!link || event.metaKey || event.ctrlKey || event.shiftKey || link.origin !== location.origin || link.pathname !== '/' || !(new URL(link.href).searchParams.has('path') || ['history', 'changes'].includes(new URL(link.href).searchParams.get('view') ?? ''))) return;
  if (link.pathname === location.pathname && link.search === location.search && link.hash) return;
  event.preventDefault(); if (pane === 'right' && new URL(link.href).searchParams.has('path')) openRight(new URL(link.href).searchParams.get('path')!); else navigate(link.href);
}
content.addEventListener('click', (event) => onContentClick(event, 'left'));
rightContent.addEventListener('click', (event) => onContentClick(event, 'right'));
window.addEventListener('popstate', () => { keyboardTreePath = ''; rightController.restoreScroll(); pasteVersion++; sidebarPanel = selectedMode() === 'history' ? 'history' : selectedMode() === 'changes' || selectedMode() === 'diff' ? 'changes' : 'file'; sourceMode = new URL(location.href).searchParams.get('source') === '1'; requestRefresh(); void syncSelectedFile(); });
window.addEventListener('hashchange', () => { highlightCodeLines(true); });
const vimKeys = createVimKeys();
document.addEventListener('focusin', vimKeys.reset);
window.addEventListener('blur', vimKeys.reset);
window.addEventListener('popstate', vimKeys.reset);
window.addEventListener('keydown', (event) => {
  const target = event.target;
  if (selectedMode() === 'paste' || vimBlocked() || (target instanceof Element && target.closest('#sidebar, #sidebar-resize, #split-resize'))) vimKeys.reset();
  else if (scrollVim(activePane.current() === 'right' ? rightPane : main, vimKeys.read(event))) { event.preventDefault(); return; }
  if (event.defaultPrevented || event.isComposing || event.keyCode === 229) return;
  if (editingShortcutTarget(event.target)) return;
  if (matchesShortcut(event, 'pasteMode') || matchesShortcut(event, 'themeMenu')) {
    if (event.repeat || document.querySelector('dialog[open]')) return;
    if ([...document.querySelectorAll<HTMLElement>('[role="menu"]')].some((menu) => menu.getClientRects().length > 0)) return;
    event.preventDefault();
    if (matchesShortcut(event, 'pasteMode')) { if (selectedMode() !== 'paste') pasteToggle.click(); }
    else {
      if (window.innerWidth <= 700) { headerExtras.classList.add('open'); headerMore.setAttribute('aria-expanded', 'true'); }
      document.querySelector<HTMLButtonElement>('#theme-toggle')!.click();
    }
    return;
  }
  if (matchesShortcut(event, 'contentWidth')) {
    if (event.repeat || window.innerWidth <= 700 || document.querySelector('dialog[open]')) return;
    if ([...document.querySelectorAll<HTMLElement>('[role="menu"]')].some((menu) => menu.getClientRects().length > 0)) return;
    if (![...document.querySelectorAll<HTMLButtonElement>('.content-width-toggle')].some((button) => !button.hidden && button.getClientRects().length > 0)) return;
    event.preventDefault(); contentWidth.cycle(); return;
  }
  if (selectedMode() === 'diff' && !event.ctrlKey && !event.metaKey && !event.altKey) {
    if (matchesShortcut(event, 'nextChange') || matchesShortcut(event, 'previousChange')) {
      const next = diffNeighbor(selected(), matchesShortcut(event, 'nextChange') ? 1 : -1, changesView.onlyUnreviewed);
      if (next) { event.preventDefault(); navigate(diffURL(next.path, selectedBase())); }
      return;
    }
    if (matchesShortcut(event, 'reviewNext')) { event.preventDefault(); markReviewedAndNext(); return; }
  }
  if (matchesShortcut(event, 'search')) {
    event.preventDefault(); sidebarPanel = 'file'; showSidebar('file');
    sidebar.classList.remove('collapsed'); sidebarToggle.setAttribute('aria-expanded', 'true');
    sidebarToggle.setAttribute('aria-label', 'Collapse sidebar'); sidebarToggle.title = `Collapse sidebar (${shortcutText('sidebar')})`;
    if (window.innerWidth <= 700) sidebar.classList.add('open');
    search.focus();
  }
  if (matchesShortcut(event, 'sidebar')) { event.preventDefault(); if (window.innerWidth <= 700) drawerToggle.click(); else sidebarToggle.click(); }
  if (matchesShortcut(event, 'serverInfo')) { event.preventDefault(); serverInfo.open(); }
  if (matchesShortcut(event, 'help')) { event.preventDefault(); shortcutHelp.open(); }
  if (matchesShortcut(event, 'close')) { sidebar.classList.remove('open'); outline.classList.remove('open'); diagramOverlay.close(); tableOverlay.close(); shortcutHelp.close(); }
});
reload.addEventListener('click', manualRefresh);
drawerToggle.addEventListener('click', () => { const open = sidebar.classList.toggle('open'); drawerToggle.title = `${open ? 'Close' : 'Open'} file list (${shortcutText('sidebar')})`; drawerToggle.setAttribute('aria-label', `${open ? 'Close' : 'Open'} file list`); });
sidebarToggle.addEventListener('click', () => { const collapsed = sidebar.classList.toggle('collapsed'); sidebarToggle.setAttribute('aria-expanded', String(!collapsed)); sidebarToggle.setAttribute('aria-label', collapsed ? 'Expand sidebar' : 'Collapse sidebar'); sidebarToggle.title = `${collapsed ? 'Expand' : 'Collapse'} sidebar (${shortcutText('sidebar')})`; });
const resize = document.querySelector<HTMLElement>('#sidebar-resize')!;
resize.addEventListener('pointerdown', (event) => { resize.setPointerCapture(event.pointerId); resize.classList.add('dragging'); });
resize.addEventListener('pointermove', (event) => { if (!resize.hasPointerCapture(event.pointerId)) return; const width = Math.max(200, Math.min(480, event.clientX)); document.documentElement.style.setProperty('--sidebar-width', `${width}px`); localStorage.setItem('markport-sidebar-width', String(width)); });
resize.addEventListener('pointerup', () => resize.classList.remove('dragging'));
resize.addEventListener('pointercancel', () => resize.classList.remove('dragging'));
resize.addEventListener('keydown', (event) => { if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return; const width = Math.max(200, Math.min(480, Number(localStorage.getItem('markport-sidebar-width') ?? 280) + (event.key === 'ArrowRight' ? 10 : -10))); document.documentElement.style.setProperty('--sidebar-width', `${width}px`); localStorage.setItem('markport-sidebar-width', String(width)); });
initTheme(document.querySelector<HTMLButtonElement>('#theme-toggle')!, () => {
  updateBrand();
  const mode = selectedMode(); const path = selected(); const right = rightSelected();
  const updateOverlay = (): void => diagramOverlay.refresh();
  void drawMermaid(content, () => mode === selectedMode() && path === selected(), updateOverlay);
  void drawMermaid(rightContent, () => right === rightSelected(), updateOverlay);
});
updateBrand();
status(liveMessage, 'ok');
requestRefresh();
window.addEventListener('pagehide', () => { preview.dispose(); outlineController.dispose(); decoration.dispose(); contentWidth.dispose(); activePane.dispose(); splitResize.dispose(); printView.close(); pasteEditor?.dispose(); refresh.dispose(); fileSearch.dispose(); tabTitle.dispose(); serverInfo.dispose(); });
