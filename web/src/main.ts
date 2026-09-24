import './style.css';
import { drawMermaid } from './mermaid';
import { TreeView, type Page } from './tree';
import { effectiveTheme, initTheme } from './theme';
import { renderChanges, renderDiff, diffURL, type ChangesReply, type DiffReply } from './diff';
import logoLight from '../../logo/markport-logo-horizontal-light.svg';
import logoDark from '../../logo/markport-logo-horizontal-dark.svg';
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
app.innerHTML = `<a class="skip-link" href="#content">本文へ移動</a><header><button id="drawer-toggle" type="button" aria-label="ファイル一覧を開く">☰</button><button id="sidebar-toggle" type="button" aria-label="サイドバーを折りたたむ" aria-expanded="true">☰</button><span class="brand" role="img" aria-label="markport"><img class="brand-horizontal" src="${logoLight}" alt=""><img class="brand-symbol" src="${symbolLight}" alt=""></span><span id="root-name"></span><span id="connection" role="status" data-state="connecting"><span class="connection-label">接続中…</span></span><button id="theme-toggle" type="button"></button><button id="reload" type="button"><span class="reload-icon" aria-hidden="true">↻</span> 最新を取得</button></header><div class="layout"><aside id="sidebar"><div class="sidebar-tabs"><button id="files-tab" type="button">ファイル</button><button id="changes-tab" type="button">変更</button></div><div id="files-panel"><form role="search" onsubmit="return false"><label for="search">ファイルを検索</label><input id="search" type="search" placeholder="パス・ファイル名 /"><span id="result-count"></span></form><nav id="tree" aria-label="ファイル一覧"></nav></div><nav id="changes-tree" aria-label="変更ファイル一覧" hidden></nav></aside><div id="sidebar-resize" role="separator" aria-orientation="vertical" aria-label="サイドバーの幅を変更" tabindex="0"></div><main id="main"><div id="connection-banner" hidden></div><div id="file-title" tabindex="-1"></div><div id="progress" hidden></div><div class="content-layout"><article id="content" tabindex="-1" aria-busy="false"></article><nav id="outline" aria-label="目次" hidden></nav></div></main></div><div id="diagram-overlay" hidden><button type="button" id="overlay-close">閉じる ×</button><div id="overlay-content"></div></div>`;
const icon = document.querySelector<HTMLLinkElement>('link[rel="icon"]') ?? document.createElement('link');
icon.rel = 'icon'; icon.type = 'image/svg+xml'; icon.href = favicon;
if (!icon.isConnected) document.head.append(icon);
function updateBrand(): void {
  const dark = effectiveTheme() === 'dark';
  document.querySelector<HTMLImageElement>('.brand-horizontal')!.src = dark ? logoDark : logoLight;
  document.querySelector<HTMLImageElement>('.brand-symbol')!.src = dark ? symbolDark : symbolLight;
}
const tree = document.querySelector<HTMLElement>('#tree')!;
const changesTree = document.querySelector<HTMLElement>('#changes-tree')!;
const filesPanel = document.querySelector<HTMLElement>('#files-panel')!;
const filesTab = document.querySelector<HTMLButtonElement>('#files-tab')!;
const changesTab = document.querySelector<HTMLButtonElement>('#changes-tab')!;
const content = document.querySelector<HTMLElement>('#content')!;
const title = document.querySelector<HTMLElement>('#file-title')!;
const search = document.querySelector<HTMLInputElement>('#search')!;
const count = document.querySelector<HTMLElement>('#result-count')!;
const connection = document.querySelector<HTMLElement>('#connection')!;
const banner = document.querySelector<HTMLElement>('#connection-banner')!;
const reload = document.querySelector<HTMLButtonElement>('#reload')!;
const main = document.querySelector<HTMLElement>('#main')!;
const progress = document.querySelector<HTMLElement>('#progress')!;
const outline = document.querySelector<HTMLElement>('#outline')!;
const sidebar = document.querySelector<HTMLElement>('#sidebar')!;
const drawerToggle = document.querySelector<HTMLButtonElement>('#drawer-toggle')!;
const sidebarToggle = document.querySelector<HTMLButtonElement>('#sidebar-toggle')!;
const view = new TreeView(tree, search, count, selected,
  (path) => { const current = revision; void loadPage(path, 0, '', false, current).then(() => loadOpenDirectories(current)).catch(() => status('更新できません。再試行してください。', 'error')); },
  (path, offset) => { const current = revision; void loadPage(path, offset, '', false, current).catch(() => status('更新できません。再試行してください。', 'error')); });
let revision = 0; let pending = false; let running = false;
let displayedPath = ''; let displayedHTML = ''; let displayedSource = false; let sourceMode = false;
let displayedMode: 'file' | 'diff' | 'changes' = 'file'; let lastFilePath = '';
let currentChanges: ChangesReply | undefined;
let previewReload = 0;
let displayedTag = '';
let displayedTagCheckedAt = 0;
const pageTags = new Map<string, { value: string; checkedAt: number }>();
let rootName = ''; let outlineObserver: IntersectionObserver | undefined;
let loadingTimer: ReturnType<typeof setTimeout> | undefined;
let updatedTimer: ReturnType<typeof setTimeout> | undefined;
const savedWidth = Number(localStorage.getItem('markport-sidebar-width'));
if (savedWidth >= 200 && savedWidth <= 480) document.documentElement.style.setProperty('--sidebar-width', `${savedWidth}px`);

function selected(): string { return new URL(location.href).searchParams.get('path') ?? ''; }
function fileURL(path: string): string { return `/?path=${encodeURIComponent(path)}`; }
function selectedMode(): 'file' | 'diff' | 'changes' {
  const view = new URL(location.href).searchParams.get('view');
  return view === 'changes' ? 'changes' : view === 'diff' && selected() ? 'diff' : 'file';
}
function showSidebar(mode: 'file' | 'diff' | 'changes'): void {
  const git = mode !== 'file';
  filesPanel.hidden = git; changesTree.hidden = !git;
  filesTab.setAttribute('aria-pressed', String(!git)); changesTab.setAttribute('aria-pressed', String(git));
}
function saveScroll(): void { history.replaceState({ scroll: main.scrollTop }, '', location.href); }
function navigate(url: string): void { saveScroll(); history.pushState({ scroll: 0 }, '', url); sourceMode = false; sidebar.classList.remove('open'); requestRefresh(); }
function status(message: string, state: 'ok' | 'connecting' | 'error'): void {
  connection.querySelector<HTMLElement>('.connection-label')!.textContent = message; connection.dataset.state = state; connection.title = message;
  banner.hidden = state === 'ok'; banner.replaceChildren();
  if (state !== 'ok') {
    banner.append(document.createTextNode(state === 'error' ? '更新できません。接続とファイルの状態を確認してください。' : '接続を確認しています。'));
    if (state === 'error') { const button = document.createElement('button'); button.textContent = '手動で最新を取得'; button.addEventListener('click', manualRefresh); banner.append(button); }
  }
}
async function getPage(path: string, offset: number, focus: string, conditional: boolean, expectedRevision?: number): Promise<Page | null> {
  const tag = pageTags.get(path);
  const headers: Record<string, string> = {};
  if (conditional && !focus && offset === 0 && view.has(path) && tag && Date.now() - tag.checkedAt < 60000) headers['If-None-Match'] = tag.value;
  let response: Response;
  try { response = await fetch(pageURL(path, offset, focus), { cache: 'no-store', headers }); }
  catch { throw new RequestError('network', '接続できません'); }
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
  catch { throw new RequestError('network', '接続できません'); }
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
  catch { throw new RequestError('network', '接続できません'); }
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
  void loadOpenDirectories(expectedRevision).catch(() => status('更新できません。再試行してください。', 'error'));
}
function showTitle(path: string, kind = '', missing = false): void {
  title.replaceChildren();
  if (selectedMode() === 'changes') {
    const heading = document.createElement('strong'); heading.textContent = 'Gitの変更'; title.append(heading); document.title = 'Gitの変更 — markport'; return;
  }
  if (!path) { title.textContent = rootName || 'markport'; document.title = 'markport'; return; }
  const crumbs = document.createElement('div'); crumbs.className = 'breadcrumbs';
  const parts = path.split('/');
  parts.forEach((part, index) => {
    if (index) crumbs.append(document.createTextNode(' / '));
    if (index < parts.length - 1) {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'crumb'; button.textContent = part;
      button.addEventListener('click', () => { view.reveal(parts.slice(0, index + 1).join('/')); sidebar.classList.add('open'); }); crumbs.append(button);
    } else { const label = document.createElement('strong'); label.textContent = part; if (missing) label.className = 'missing'; crumbs.append(label); }
  });
  title.append(crumbs);
  const actions = document.createElement('div'); actions.className = 'title-actions';
  if (kind) {
    const badge = document.createElement('span'); badge.className = 'kind-badge';
    const extension = path.split('.').at(-1)?.toLowerCase() ?? '';
    const languages: Record<string, string> = { py: 'Python', go: 'Go', js: 'JavaScript', ts: 'TypeScript', tsx: 'TypeScript', jsx: 'JavaScript', rs: 'Rust', java: 'Java', sh: 'Shell', html: 'HTML', css: 'CSS', json: 'JSON', yaml: 'YAML', yml: 'YAML' };
    badge.textContent = kind === 'diff' ? 'Git Diff' : kind === 'markdown' ? 'Markdown' : kind === 'html' ? 'HTML' : ((languages[extension] ?? extension.toUpperCase()) || 'Code'); actions.append(badge);
  }
  if (selectedMode() === 'diff') {
    if (currentChanges?.changes.find((change) => change.path === path)?.status !== 'deleted') {
      const file = document.createElement('button'); file.type = 'button'; file.textContent = 'ファイル'; file.addEventListener('click', () => navigate(fileURL(path))); actions.append(file);
    }
  } else {
    const diff = document.createElement('button'); diff.type = 'button'; diff.textContent = '差分'; diff.addEventListener('click', () => navigate(diffURL(path))); actions.append(diff);
  }
  const copy = document.createElement('button'); copy.type = 'button'; copy.textContent = 'パスをコピー'; copy.addEventListener('click', () => { void navigator.clipboard.writeText(path).then(() => { copy.textContent = 'コピーしました'; setTimeout(() => { copy.textContent = 'パスをコピー'; }, 2000); }); }); actions.append(copy);
  if (kind === 'markdown' || kind === 'html') { const source = document.createElement('button'); source.type = 'button'; source.textContent = sourceMode ? kind === 'html' ? 'プレビュー' : '整形表示' : 'ソース'; source.addEventListener('click', () => { sourceMode = !sourceMode; requestRefresh(); }); actions.append(source); }
  const toc = document.createElement('button'); toc.type = 'button'; toc.id = 'outline-toggle'; toc.textContent = '目次'; toc.hidden = outline.hidden; toc.addEventListener('click', () => outline.classList.toggle('open')); actions.append(toc);
  title.append(actions); document.title = `${parts.at(-1)} — markport`;
}
function showEmpty(): void {
  content.replaceChildren(); const box = document.createElement('div'); box.className = 'empty-state';
  const heading = document.createElement('h2'); heading.textContent = 'ファイルを選択してください';
  const detail = document.createElement('p'); detail.textContent = `${rootName || '閲覧ルート'}で${view.fileCount()}ファイルを読み込み済みです。フォルダを開くと続きが表示されます。/ キーで検索できます。`;
  box.append(heading, detail); content.append(box); outline.hidden = true;
}
function showError(error: unknown, path: string): void {
  const code = error instanceof RequestError ? error.code : 'network';
  const messages: Record<string, [string, string]> = {
    not_found: ['ファイルが見つかりません', 'このファイルは削除されたか、移動されました。'],
    too_large: ['ファイルが大きすぎます', 'サイズ上限を超えるため表示できません。'],
    invalid_asset: ['画像を表示できません', '画像を読み込めません。ファイルを確認して再試行してください。'],
    binary: ['表示できないファイルです', 'バイナリファイルのため表示できません。'],
    unreadable: ['ファイルを読み取れません', 'このファイルは読み取れません。'],
    not_regular: ['ファイルを読み取れません', 'このファイルは読み取れません。'],
    network: ['接続できません', 'サーバーに接続できません。markportが起動しているか確認してください。'],
    no_change: ['差分はありません', 'このファイルにHEADからの変更はありません。'],
    git_unavailable: ['Gitの差分を表示できません', 'Gitが利用できるリポジトリを確認してください。'],
    git_failure: ['Gitの差分を取得できません', '再試行してください。'],
  };
  const [heading, description] = messages[code] ?? ['ファイルを表示できません', 'もう一度お試しください。'];
  content.replaceChildren(); const box = document.createElement('div'); box.className = 'file-error'; box.setAttribute('role', 'alert');
  const icon = document.createElement('span'); icon.textContent = '⚠'; icon.setAttribute('aria-hidden', 'true');
  const h = document.createElement('h2'); h.textContent = heading; const p = document.createElement('p');
  const size = code === 'too_large' && error instanceof RequestError ? error.message.match(/(\d+ MiB) limit \(actual (\d+(?:\.\d+)? MiB)\)/) : undefined;
  p.textContent = size ? `${size[1]}を超えるため表示できません（${size[2]}）。` : description;
  const button = document.createElement('button'); button.type = 'button'; button.textContent = code === 'not_found' ? 'ルートへ戻る' : '再試行'; button.addEventListener('click', () => code === 'not_found' ? navigate('/') : manualRefresh());
  box.append(icon, h, p, button); content.append(box); showTitle(path, '', code === 'not_found'); outline.hidden = true;
}
function decorateContent(): void {
  function wrapCode(element: HTMLElement): void {
    const frame = document.createElement('div'); frame.className = 'code-frame';
    const toolbar = document.createElement('div'); toolbar.className = 'code-toolbar';
    const label = document.createElement('span'); label.textContent = element.closest<HTMLElement>('[data-language]')?.dataset.language || (content.dataset.kind === 'code' ? displayedPath.split('.').at(-1) : 'text') || 'text';
    const button = document.createElement('button'); button.type = 'button'; button.textContent = 'コピー';
    button.addEventListener('click', () => {
      const code = element.querySelector<HTMLElement>('.lntd:last-child pre') ?? element;
      void navigator.clipboard.writeText(code.textContent ?? '').then(() => { button.textContent = 'コピーしました'; setTimeout(() => { button.textContent = 'コピー'; }, 2000); });
    });
    toolbar.append(label, button); element.before(frame); frame.append(toolbar, element);
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => {
      const scroller = element.querySelector<HTMLElement>('.lntd:last-child pre') ?? element.querySelector<HTMLElement>('pre') ?? element;
      frame.classList.toggle('overflows', scroller.scrollWidth > scroller.clientWidth + 1);
    });
  }
  for (const block of content.querySelectorAll<HTMLElement>('.chroma')) {
    if (block.closest('[data-mermaid],.code-frame,.chroma .chroma')) continue;
    wrapCode(block);
  }
  for (const pre of content.querySelectorAll<HTMLPreElement>('pre')) {
    if (pre.closest('[data-mermaid],.code-frame')) continue;
    wrapCode(pre);
  }
  for (const img of content.querySelectorAll<HTMLImageElement>('img')) {
    img.loading = 'lazy'; img.decoding = 'async';
    img.addEventListener('error', () => { const note = document.createElement('span'); note.className = 'image-error'; note.textContent = img.alt || '画像を読み込めません'; img.replaceWith(note); });
  }
  for (const table of content.querySelectorAll('table')) {
    if (table.closest('.chroma')) continue;
    const wrap = document.createElement('div'); wrap.className = 'table-wrap'; table.before(wrap); wrap.append(table);
  }
  updateTableHeaders();
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
function beginLoading(): void { content.setAttribute('aria-busy', 'true'); reload.disabled = true; clearTimeout(loadingTimer); loadingTimer = setTimeout(() => { progress.hidden = false; }, 200); }
function endLoading(): void { clearTimeout(loadingTimer); progress.hidden = true; reload.disabled = false; content.setAttribute('aria-busy', 'false'); }
function requestRefresh(): void { revision++; pending = true; if (!running) void refreshLoop(); }
function manualRefresh(): void { displayedTag = ''; pageTags.clear(); previewReload++; requestRefresh(); }

function attachPreviewNavigation(frame: HTMLIFrameElement, path: string): void {
  frame.addEventListener('load', () => {
    if (!frame.isConnected || selected() !== path) return;
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
        try { navigate(fileURL(decodeURIComponent(url.pathname.slice('/api/preview/'.length))) + url.hash); } catch { /* Invalid URL encoding. */ }
      } else if (url.protocol === 'http:' || url.protocol === 'https:') {
        event.preventDefault(); window.open(url.href, '_blank', 'noopener,noreferrer');
      }
    });
  });
}
async function refreshLoop(): Promise<void> {
  running = true;
  try {
    while (pending) {
      pending = false; const current = revision; const path = selected(); const source = sourceMode; const mode = selectedMode();
      showSidebar(mode);
      if (path !== displayedPath || mode !== displayedMode) displayedTag = '';
      beginLoading();
      const treePromise = refreshDirectories(mode === 'changes' ? '' : path, current);
      const gitPromise = mode !== 'file' ? getGit<ChangesReply>('/api/git/changes') : Promise.resolve(undefined);
      const filePromise = mode === 'diff' ? getGit<DiffReply>(`/api/git/diff?path=${encodeURIComponent(path)}`).then((value) => ({ value }), (error: unknown) => ({ error }))
        : mode === 'file' && path ? getFile(path, source, current).then((value) => ({ value }), (error: unknown) => ({ error })) : Promise.resolve(null);
      try {
        const [, fileReply, changesReply] = await Promise.all([treePromise, filePromise, gitPromise]);
        if (current !== revision || path !== selected() || mode !== selectedMode()) { pending = true; continue; }
        if (mode === 'file' && !path && view.firstReadme()) { history.replaceState({ scroll: 0 }, '', fileURL(view.firstReadme()!)); pending = true; revision++; continue; }
        const pathChanged = path !== displayedPath || mode !== displayedMode;
        if (pathChanged) { main.scrollTop = history.state?.scroll ?? 0; displayedHTML = ''; view.pruneInactive(); }
        displayedPath = path; displayedMode = mode;
        if (path) lastFilePath = path;
        if (changesReply) {
          currentChanges = changesReply;
          renderChanges(changesTree, changesReply, true);
          [...changesTree.querySelectorAll<HTMLAnchorElement>('a[href]')].find((link) => link.getAttribute('href') === diffURL(path))?.setAttribute('aria-current', 'page');
        }
        if (mode === 'changes') {
          const displayKey = JSON.stringify(changesReply);
          if (displayedHTML !== displayKey) {
            content.dataset.kind = 'changes'; renderChanges(content, changesReply!); displayedHTML = displayKey;
            outline.hidden = true; showTitle('');
          }
          status('数秒おきに確認中', 'ok'); continue;
        }
        if (!path) { showTitle(''); showEmpty(); continue; }
        if (fileReply && 'error' in fileReply) { showError(fileReply.error, path); displayedHTML = ''; displayedTag = ''; continue; }
        if (mode === 'diff' && fileReply && 'value' in fileReply) {
          const diff = fileReply.value as DiffReply;
          const displayKey = `${diff.kind}\n${diff.patch}`;
          if (displayedHTML !== displayKey) {
            content.dataset.kind = 'diff'; renderDiff(content, diff); displayedHTML = displayKey;
            outline.hidden = true; showTitle(path, 'diff');
          }
          status('数秒おきに確認中', 'ok'); continue;
        }
        if (fileReply && 'value' in fileReply) {
          const file = fileReply.value as FileReply | null;
          if (!file) { status('数秒おきに確認中', 'ok'); continue; }
          const displayKey = 'assetUrl' in file ? file.assetUrl : 'previewUrl' in file ? `${file.previewUrl}&reload=${previewReload}` : file.html;
          const changed = displayedHTML !== displayKey || displayedSource !== source;
          if (changed) {
            const oldScroll = main.scrollTop;
            content.dataset.kind = file.type === 'image' ? 'image' : source ? 'code' : file.type;
            if ('previewUrl' in file) {
              const frame = document.createElement('iframe'); frame.className = 'html-preview'; frame.title = `${path} のプレビュー`;
              frame.setAttribute('sandbox', 'allow-same-origin'); frame.referrerPolicy = 'no-referrer';
              attachPreviewNavigation(frame, path); frame.src = displayKey; content.replaceChildren(frame);
            } else if (file.type === 'image') {
              const img = document.createElement('img'); img.className = 'image-preview'; img.alt = path.split('/').at(-1) ?? path;
              img.addEventListener('error', () => { if (img.isConnected && selected() === path) { displayedHTML = ''; showError(new RequestError('invalid_asset', 'image load failed'), path); } });
              img.src = file.assetUrl; content.replaceChildren(img);
            } else { content.innerHTML = file.html; decorateContent(); }
            displayedHTML = displayKey; displayedSource = source;
            updateOutline(); showTitle(path, file.type);
            if (!pathChanged && oldScroll > 0) main.scrollTop = oldScroll;
            if (location.hash && file.type !== 'html') { try { document.getElementById(decodeURIComponent(location.hash.slice(1)))?.scrollIntoView(); } catch { /* Invalid fragment. */ } }
            if (!pathChanged && current > 1) {
              title.classList.add('updated'); const note = document.createElement('span'); note.className = 'update-note'; note.textContent = '更新しました'; title.querySelector('.title-actions')?.prepend(note);
              clearTimeout(updatedTimer); updatedTimer = setTimeout(() => { title.classList.remove('updated'); note.remove(); }, 3500);
            }
            void drawMermaid(content, () => path === selected() && source === sourceMode);
          }
          view.reveal(path);
          if (pathChanged) title.focus({ preventScroll: true });
        }
        status('数秒おきに確認中', 'ok');
      } catch (error) {
        if (current !== revision) { pending = true; continue; }
        showError(error, path); status('更新できません。再試行してください。', 'error');
      } finally { endLoading(); }
    }
  } finally { running = false; if (pending) void refreshLoop(); }
}

tree.addEventListener('click', (event) => {
  const link = (event.target as HTMLElement).closest<HTMLAnchorElement>('a[href]');
  if (!link || event.metaKey || event.ctrlKey || event.shiftKey) return;
  event.preventDefault(); navigate(link.href);
});
changesTree.addEventListener('click', (event) => {
  const link = (event.target as HTMLElement).closest<HTMLAnchorElement>('a[href]');
  if (!link || event.metaKey || event.ctrlKey || event.shiftKey) return;
  event.preventDefault(); navigate(link.href);
});
filesTab.addEventListener('click', () => navigate(lastFilePath ? fileURL(lastFilePath) : '/'));
changesTab.addEventListener('click', () => navigate('/?view=changes'));
content.addEventListener('click', (event) => {
  const target = event.target as HTMLElement;
  const action = target.closest<HTMLButtonElement>('[data-diagram-action]');
  if (action) {
    const diagram = action.closest<HTMLElement>('[data-mermaid]')!;
    if (action.dataset.diagramAction === 'source') {
      const image = diagram.querySelector<HTMLElement>('.diagram-image')!; const showing = image.hidden; image.hidden = !showing;
      let source = diagram.querySelector<HTMLElement>('.diagram-source');
      if (!source) { source = document.createElement('pre'); source.className = 'diagram-source'; source.textContent = diagram.dataset.source ?? ''; diagram.append(source); }
      source.hidden = showing; action.textContent = showing ? 'ソース' : '図';
    } else {
      document.querySelector<HTMLElement>('#overlay-content')!.innerHTML = diagram.querySelector('.diagram-image')?.innerHTML ?? '';
      document.querySelector<HTMLElement>('#diagram-overlay')!.hidden = false;
    }
    return;
  }
  const link = target.closest<HTMLAnchorElement>('a[href]');
  if (!link || event.metaKey || event.ctrlKey || event.shiftKey || link.origin !== location.origin || link.pathname !== '/' || !new URL(link.href).searchParams.has('path')) return;
  if (link.pathname === location.pathname && link.search === location.search && link.hash) return;
  event.preventDefault(); navigate(link.href);
});
document.querySelector('#overlay-close')!.addEventListener('click', () => { document.querySelector<HTMLElement>('#diagram-overlay')!.hidden = true; });
window.addEventListener('popstate', requestRefresh);
window.addEventListener('keydown', (event) => {
  if ((event.key === '/' || ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k')) && !(event.target instanceof HTMLInputElement)) { event.preventDefault(); search.focus(); sidebar.classList.add('open'); }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'b') { event.preventDefault(); sidebarToggle.click(); }
  if (event.key === 'Escape') { sidebar.classList.remove('open'); outline.classList.remove('open'); document.querySelector<HTMLElement>('#diagram-overlay')!.hidden = true; }
});
reload.addEventListener('click', manualRefresh);
drawerToggle.addEventListener('click', () => sidebar.classList.toggle('open'));
sidebarToggle.addEventListener('click', () => { const collapsed = sidebar.classList.toggle('collapsed'); sidebarToggle.setAttribute('aria-expanded', String(!collapsed)); sidebarToggle.setAttribute('aria-label', collapsed ? 'サイドバーを開く' : 'サイドバーを折りたたむ'); });
const resize = document.querySelector<HTMLElement>('#sidebar-resize')!;
resize.addEventListener('pointerdown', (event) => { resize.setPointerCapture(event.pointerId); });
resize.addEventListener('pointermove', (event) => { if (!resize.hasPointerCapture(event.pointerId)) return; const width = Math.max(200, Math.min(480, event.clientX)); document.documentElement.style.setProperty('--sidebar-width', `${width}px`); localStorage.setItem('markport-sidebar-width', String(width)); });
resize.addEventListener('keydown', (event) => { if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return; const width = Math.max(200, Math.min(480, Number(localStorage.getItem('markport-sidebar-width') ?? 280) + (event.key === 'ArrowRight' ? 10 : -10))); document.documentElement.style.setProperty('--sidebar-width', `${width}px`); localStorage.setItem('markport-sidebar-width', String(width)); });
initTheme(document.querySelector<HTMLButtonElement>('#theme-toggle')!, () => { updateBrand(); if (content.querySelector('[data-mermaid]')) { displayedHTML = ''; requestRefresh(); } });
updateBrand();
status('数秒おきに確認中', 'ok');
requestRefresh();
const pollTimer = setInterval(() => { if (!document.hidden) requestRefresh(); }, 3000);
window.addEventListener('pagehide', () => clearInterval(pollTimer));
document.addEventListener('visibilitychange', () => { if (!document.hidden) requestRefresh(); });
