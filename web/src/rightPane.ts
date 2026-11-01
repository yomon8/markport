import { FileGitView, fileView, fileViewURL, swapFilePanes, rightOnlyURL, type FileView } from './fileGit';
import { setIcon } from './icons';
import { renderDiff, type DiffReply } from './diff';
import { drawMermaid } from './mermaid';
import { drawMath } from './math';
import { copyWithFeedback } from './copyControls';
import { RequestError, type FileReply, type ApiError } from './api';
import type { createContentWidth } from './contentWidth';
import type { createActivePane } from './activePane';
import type { createSplitResize } from './splitResize';
import type { createPreview } from './preview';

type RightPaneOptions = {
  main: HTMLElement; layout: HTMLElement; rightPane: HTMLElement; rightContent: HTMLElement; sidebar: HTMLElement;
  contentWidth: Pick<ReturnType<typeof createContentWidth>, 'createButton'>;
  activePane: Pick<ReturnType<typeof createActivePane>, 'setSplit' | 'select'>;
  splitResize: Pick<ReturnType<typeof createSplitResize>, 'setActive'>;
  selected: () => string;
  selectedMode: () => FileView | 'changes' | 'paste' | 'history';
  getSourceMode: () => boolean;
  setSourceMode: (value: boolean) => void;
  setSidebarPanel: (mode: 'file' | 'changes') => void;
  getRememberedBase: () => string;
  getGit: <T>(url: string) => Promise<T>;
  saveScroll: () => void;
  requestRefresh: () => void;
  syncSelectedFile: () => Promise<void>;
  preview: ReturnType<typeof createPreview>;
  decorateContent: (target: HTMLElement, path: string) => void;
  highlightCodeLines: (scroll: boolean, pane: HTMLElement, hash: string) => boolean;
  updateRightOutline: () => void;
  downloadFile: (path: string) => void;
  openPDF: (path: string) => void;
  printFile: (path: string, opener: HTMLButtonElement) => void;
};

export function createRightPane(deps: RightPaneOptions) {
  const { main, layout, rightPane, rightContent, sidebar, contentWidth, activePane, splitResize,
    selected, selectedMode, getGit, saveScroll, requestRefresh, syncSelectedFile,
    preview, decorateContent, highlightCodeLines, updateRightOutline, downloadFile, openPDF } = deps;
  const { createPreviewFrame, createPDFFrame, filePreviewKey, setInteractive } = preview;
  const rightPath = document.querySelector<HTMLElement>('#right-path')!;
  const rightKind = document.querySelector<HTMLElement>('#right-kind')!;
  const rightViews = document.querySelector<HTMLElement>('#right-views')!;
  const rightRendered = document.querySelector<HTMLButtonElement>('#right-rendered')!;
  const rightInteractive = document.querySelector<HTMLButtonElement>('#right-interactive')!;
  const rightSource = document.querySelector<HTMLButtonElement>('#right-source')!;
  const rightOutline = document.querySelector<HTMLElement>('#right-outline')!;
  const rightContents = document.querySelector<HTMLButtonElement>('#right-contents')!;
  const rightDownload = document.createElement('button');
  rightDownload.type = 'button'; rightDownload.className = 'title-icon'; setIcon(rightDownload, 'download');
  rightDownload.setAttribute('aria-label', 'Download'); rightDownload.title = 'Download';
  document.querySelector('#right-copy')!.before(rightDownload);
  const rightOpenPDF = document.createElement('button');
  rightOpenPDF.type = 'button'; rightOpenPDF.className = 'title-icon'; setIcon(rightOpenPDF, 'external');
  rightOpenPDF.setAttribute('aria-label', 'Open PDF in new tab'); rightOpenPDF.title = 'Open PDF in new tab'; rightOpenPDF.hidden = true;
  rightDownload.before(rightOpenPDF);
  const rightPrint = document.createElement('button');
  rightPrint.type = 'button'; rightPrint.className = 'title-icon'; setIcon(rightPrint, 'printer');
  rightPrint.setAttribute('aria-label', 'Print / Save as PDF'); rightPrint.title = 'Print / Save as PDF'; rightPrint.hidden = true;
  rightDownload.before(rightPrint);
  const rightWidth = contentWidth.createButton(); rightWidth.hidden = true;
  rightPrint.before(rightWidth);
  let rightShownPath = ''; let rightShownKey = ''; let rightSourceMode = new URL(location.href).searchParams.get('right-source') === '1'; let rightRequest = 0;
  let pendingRightScroll: number | undefined;
  let rightTag = ''; let rightTagCheckedAt = 0;
  let rightLineHash = '';
  let rightLinePath = '';
  let pendingRightLineJump = false;
  const rightFileGit = new FileGitView(rightContent, 'right', getGit, navigateRight);
  function navigateRight(url: URL): void {
    history.replaceState({ ...history.state, scroll: main.scrollTop, rightScroll: rightPane.scrollTop }, '', location.href);
    history.pushState({ ...history.state, rightScroll: 0 }, '', url);
    rightPane.scrollTop = 0; rightShownKey = ''; rightTag = '';
    void refreshRight();
  }
  const rightFileViews = document.createElement('div'); rightFileViews.className = 'view-segment right-file-views';
  rightFileViews.setAttribute('role', 'group'); rightFileViews.setAttribute('aria-label', 'File or Diff or History or Blame');
  for (const [mode, label] of [['file', 'File'], ['diff', 'Diff'], ['file-history', 'History'], ['blame', 'Blame']] as const) {
    const button = document.createElement('button'); button.type = 'button'; button.textContent = label; button.dataset.fileView = mode;
    button.addEventListener('click', () => {
      const url = fileViewURL(new URL(location.href), 'right', mode);
      if (mode === 'diff' && deps.getRememberedBase()) url.searchParams.set('right-base', deps.getRememberedBase());
      navigateRight(url);
    }); rightFileViews.append(button);
  }
  rightViews.before(rightFileViews);
  const rightMore = document.createElement('button'); rightMore.type = 'button'; rightMore.className = 'right-more title-more';
  setIcon(rightMore, 'more'); rightMore.setAttribute('aria-label', 'File actions'); rightMore.title = 'File actions'; rightMore.setAttribute('aria-haspopup', 'menu'); rightMore.setAttribute('aria-expanded', 'false');
  const rightMenu = document.createElement('div'); rightMenu.className = 'right-menu title-menu'; rightMenu.setAttribute('role', 'menu'); rightMenu.hidden = true;
  document.querySelector('#right-title .right-actions')!.append(rightMore, rightMenu);
  function closeRightMenu(): void { rightMenu.hidden = true; rightMore.setAttribute('aria-expanded', 'false'); rightMore.focus(); }
  function updateRightMenu(): void {
    if (!rightMenu.hidden) return;
    rightMenu.replaceChildren();
    for (const control of document.querySelectorAll<HTMLButtonElement>('#right-title .right-actions>button:not(.right-more), #right-title .view-segment:not([hidden]) button')) {
      if (control.hidden || control.classList.contains('content-width-toggle')) continue;
      const item = document.createElement('button'); item.type = 'button'; item.textContent = control.getAttribute('aria-label') ?? control.textContent; item.disabled = control.disabled;
      item.setAttribute('role', control.hasAttribute('aria-pressed') ? 'menuitemradio' : 'menuitem');
      if (control.hasAttribute('aria-pressed')) item.setAttribute('aria-checked', control.getAttribute('aria-pressed')!);
      item.addEventListener('click', () => { closeRightMenu(); control.click(); }); rightMenu.append(item);
    }
  }
  rightMore.addEventListener('click', () => {
    if (!rightMenu.hidden) { closeRightMenu(); return; }
    updateRightMenu(); rightMenu.hidden = false; rightMore.setAttribute('aria-expanded', 'true'); rightMenu.querySelector<HTMLButtonElement>('button')?.focus();
  });
  rightMenu.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') { event.preventDefault(); closeRightMenu(); return; }
    if (!['ArrowDown', 'ArrowUp'].includes(event.key)) return;
    event.preventDefault(); const items = [...rightMenu.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')]; const index = items.indexOf(document.activeElement as HTMLButtonElement);
    items[(index + (event.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length]?.focus();
  });
  function rightSelected(): string { return ['file', 'diff', 'file-history', 'blame'].includes(selectedMode()) ? new URL(location.href).searchParams.get('right') ?? '' : ''; }
  function openRight(path: string, line?: number, keepTreeFocus = false): void {
    const source = Boolean(line) && /\.(md|markdown|html|htm)$/i.test(path);
    if (path !== rightSelected() || line) {
      if (rightSourceMode !== source) { rightTag = ''; rightShownKey = ''; }
      rightSourceMode = source;
    }
    rightLineHash = line ? `#L${line}` : ''; rightLinePath = path; pendingRightLineJump = Boolean(line);
    const url = new URL(location.href);
    if (path !== rightSelected()) for (const key of [...url.searchParams.keys()]) if (key.startsWith('right-')) url.searchParams.delete(key);
    url.searchParams.set('right', path); url.searchParams.delete('right-view');
    for (const key of ['right-commit', 'right-revision-path', 'right-revision-view', 'right-base']) url.searchParams.delete(key);
    if (rightSourceMode) url.searchParams.set('right-source', '1'); else url.searchParams.delete('right-source');
    saveScroll(); history.pushState({ ...history.state, rightScroll: 0 }, '', url); if (!keepTreeFocus) sidebar.classList.remove('open');
    activePane.setSplit(true); activePane.select('right'); void syncSelectedFile(); void refreshRight();
  }
  function closeRight(): void {
    const url = new URL(location.href); url.searchParams.delete('right');
    for (const key of [...url.searchParams.keys()]) if (key.startsWith('right-')) url.searchParams.delete(key);
    rightFileGit.invalidate();
    history.pushState(history.state, '', url); rightRequest++; rightPane.hidden = true; layout.classList.remove('split'); splitResize.setActive(false); activePane.setSplit(false); rightShownPath = ''; rightShownKey = '';
    rightTag = '';
  }
  function swapPanes(): void {
    if (!selected() || !rightSelected()) return;
    const leftScroll = main.scrollTop; const rightScroll = rightPane.scrollTop;
    const original = new URL(location.href);
    if (deps.getSourceMode()) original.searchParams.set('source', '1'); else original.searchParams.delete('source');
    if (rightSourceMode) original.searchParams.set('right-source', '1'); else original.searchParams.delete('right-source');
    const url = swapFilePanes(original);
    history.replaceState({ ...history.state, scroll: leftScroll, rightScroll }, '', location.href);
    history.pushState({ scroll: rightScroll, rightScroll: leftScroll }, '', url);
    main.scrollTop = rightScroll;
    deps.setSourceMode(url.searchParams.get('source') === '1'); rightSourceMode = url.searchParams.get('right-source') === '1';
    rightShownPath = ''; rightShownKey = ''; rightTag = '';
    deps.setSidebarPanel(selectedMode() === 'diff' ? 'changes' : 'file');
    pendingRightScroll = leftScroll;
    requestRefresh();
  }
  function showRightOnly(): void {
    if (!rightSelected()) return;
    const original = new URL(location.href);
    if (rightSourceMode) original.searchParams.set('right-source', '1'); else original.searchParams.delete('right-source');
    const url = rightOnlyURL(original);
    history.replaceState({ ...history.state, scroll: main.scrollTop, rightScroll: rightPane.scrollTop }, '', location.href);
    history.pushState({ scroll: rightPane.scrollTop }, '', url);
    deps.setSourceMode(url.searchParams.get('source') === '1'); rightPane.hidden = true; layout.classList.remove('split'); splitResize.setActive(false); activePane.setSplit(false);
    deps.setSidebarPanel(selectedMode() === 'diff' ? 'changes' : 'file');
    requestRefresh();
  }
  function showRightTitle(path: string, kind: FileReply['type'] | 'diff' | 'History' | 'Blame'): void {
    rightWidth.hidden = kind !== 'markdown' || rightContent.dataset.kind !== 'markdown' || rightSourceMode;
    rightPath.replaceChildren(); rightPath.title = path;
    const parts = path.split('/');
    if (parts.length > 1) {
      const parent = document.createElement('span'); parent.className = 'breadcrumb-parent';
      parent.textContent = `${parts.slice(0, -1).join('/')} / `; rightPath.append(parent);
    }
    const name = document.createElement('strong'); name.textContent = parts.at(-1) ?? path; rightPath.append(name);
    rightKind.textContent = kind === 'History' || kind === 'Blame' ? kind : kind === 'diff' ? 'Git Diff' : kind === 'markdown' ? 'Markdown' : kind === 'html' ? 'HTML' : kind === 'image' ? 'Image' : (parts.at(-1)?.split('.').at(-1)?.toUpperCase() || 'Code');
    const mode = fileView(new URL(location.href), 'right');
    rightViews.hidden = mode !== 'file' || (kind !== 'markdown' && kind !== 'html');
    for (const button of rightFileViews.querySelectorAll<HTMLButtonElement>('button')) button.setAttribute('aria-pressed', String(button.dataset.fileView === mode));
    rightRendered.textContent = 'Preview';
    rightRendered.setAttribute('aria-pressed', String(!rightSourceMode));
    rightSource.setAttribute('aria-pressed', String(rightSourceMode));
  }
  async function refreshRight(): Promise<void> {
    const path = rightSelected(); const request = ++rightRequest;
    const mode = fileView(new URL(location.href), 'right');
    rightSourceMode = new URL(location.href).searchParams.get('right-source') === '1';
    if (path !== rightLinePath) { rightLineHash = ''; pendingRightLineJump = false; }
    const applyLine = (): void => {
      highlightCodeLines(pendingRightLineJump, rightContent, rightLineHash);
      pendingRightLineJump = false;
    };
    rightPane.hidden = !path; layout.classList.toggle('split', Boolean(path)); splitResize.setActive(Boolean(path)); activePane.setSplit(Boolean(path));
    if (!path) { rightFileGit.invalidate(); rightShownPath = ''; rightShownKey = ''; rightDownload.hidden = true; rightOpenPDF.hidden = true; rightPrint.hidden = true; return; }
    if (path !== rightShownPath) { rightPane.scrollTop = 0; rightShownKey = ''; rightTag = ''; rightDownload.hidden = true; rightOpenPDF.hidden = true; rightPrint.hidden = true; }
    if (mode === 'file-history' || mode === 'blame') {
      showRightTitle(path, mode === 'blame' ? 'Blame' : 'History'); rightKind.hidden = false;
      rightDownload.hidden = true; rightPrint.hidden = true; rightOpenPDF.hidden = true; rightInteractive.hidden = true; rightOutline.hidden = true; rightContents.hidden = true;
      rightShownPath = path; rightShownKey = ''; rightTag = '';
      await rightFileGit.refresh(path);
      if (request === rightRequest && pendingRightScroll !== undefined) { rightPane.scrollTop = pendingRightScroll; pendingRightScroll = undefined; }
      return;
    }
    rightFileGit.invalidate();
    rightContent.setAttribute('aria-busy', 'true');
    try {
      if (mode === 'diff') {
        const url = new URL(location.href); const base = url.searchParams.get('right-base') ?? '';
        const diff = await getGit<DiffReply>(`/api/git/diff?path=${encodeURIComponent(path)}${base ? `&base=${encodeURIComponent(base)}` : ''}`);
        if (request !== rightRequest || path !== rightSelected() || fileView(new URL(location.href), 'right') !== mode) return;
        const key = JSON.stringify(diff);
        if (rightShownKey !== key || rightContent.dataset.kind !== 'diff') { const scroll = rightPane.scrollTop; rightContent.dataset.kind = 'diff'; renderDiff(rightContent, diff); rightShownKey = key; rightPane.scrollTop = scroll; }
        showRightTitle(path, 'diff'); rightShownPath = path;
        rightDownload.hidden = true; rightPrint.hidden = true; rightOpenPDF.hidden = true; rightInteractive.hidden = true; rightOutline.hidden = true; rightContents.hidden = true;
        if (pendingRightScroll !== undefined) { rightPane.scrollTop = pendingRightScroll; pendingRightScroll = undefined; }
        return;
      }
      const headers: Record<string, string> = {};
      if (rightShownPath === path && rightTag && Date.now() - rightTagCheckedAt < 60000) headers['If-None-Match'] = rightTag;
      const response = await fetch(`/api/file?path=${encodeURIComponent(path)}${rightSourceMode ? '&source=1' : ''}`, { cache: 'no-store', headers });
      if (request !== rightRequest || path !== rightSelected()) return;
      rightTag = response.headers.get('ETag') ?? '';
      rightTagCheckedAt = Date.now();
      if (response.status === 304) { applyLine(); return; }
      const file = await response.json() as FileReply & ApiError;
      if (!response.ok) throw new RequestError(file.error ?? 'network', file.message ?? `HTTP ${response.status}`);
      if (request !== rightRequest || path !== rightSelected()) return;
      const key = `${rightSourceMode}\n${filePreviewKey(file, path)}`;
      if (rightShownPath !== path || rightShownKey !== key) {
        const scroll = rightShownPath === path ? rightPane.scrollTop : 0;
        rightContent.dataset.kind = file.type === 'image' || file.type === 'pdf' ? file.type : rightSourceMode ? 'code' : file.type;
        if (file.type === 'pdf') {
          rightContent.replaceChildren(createPDFFrame(file.previewUrl, path));
        } else if ('previewUrl' in file) {
          rightContent.replaceChildren(createPreviewFrame(file.previewUrl, path, 'right'));
        } else if (file.type === 'image') {
          const img = document.createElement('img'); img.className = 'image-preview'; img.alt = path.split('/').at(-1) ?? path;
          img.src = file.assetUrl; img.addEventListener('error', () => { if (img.isConnected) rightContent.textContent = 'Cannot display image.'; }); rightContent.replaceChildren(img);
        } else { rightContent.innerHTML = file.html; decorateContent(rightContent, path); }
        rightShownKey = key;
        updateRightOutline();
        void drawMermaid(rightContent, () => rightShownKey === key && path === rightSelected());
        void drawMath(rightContent, () => rightShownKey === key && path === rightSelected() && rightContent.dataset.kind === 'markdown');
        showRightTitle(path, file.type);
        rightPane.scrollTop = scroll;
      } else {
        showRightTitle(path, file.type);
      }
      rightKind.hidden = false; rightDownload.hidden = false; rightOpenPDF.hidden = file.type !== 'pdf';
      rightPrint.hidden = file.type !== 'markdown';
      rightInteractive.hidden = file.type !== 'html';
      rightInteractive.textContent = preview.hasInteractive(path) ? 'Disable JavaScript' : 'Enable JavaScript';
      rightInteractive.setAttribute('aria-pressed', String(preview.hasInteractive(path)));
      rightShownPath = path;
      if (pendingRightScroll !== undefined) { rightPane.scrollTop = pendingRightScroll; pendingRightScroll = undefined; }
      applyLine();
    } catch (error) {
      if (request !== rightRequest || path !== rightSelected()) return;
      showRightTitle(path, 'code'); rightKind.hidden = true;
      rightDownload.hidden = !(error instanceof RequestError && ['binary', 'too_large', 'invalid_asset', 'invalid_pdf'].includes(error.code));
      rightOpenPDF.hidden = true;
      rightPrint.hidden = true;
      rightContent.replaceChildren(); const message = document.createElement('div'); message.className = 'file-error'; message.setAttribute('role', 'alert');
      message.textContent = error instanceof RequestError && error.code === 'not_found' ? 'File not found.' : 'Cannot display file. Please try again.'; rightContent.append(message);
      rightInteractive.hidden = true; rightViews.hidden = true; rightOutline.hidden = true; rightContents.hidden = true;
      rightShownPath = path; rightShownKey = '';
    } finally { if (request === rightRequest) rightContent.setAttribute('aria-busy', 'false'); }
  }
  document.querySelector('#right-close')!.addEventListener('click', closeRight);
  rightSource.addEventListener('click', () => { const url = new URL(location.href); url.searchParams.set('right-source', '1'); rightSourceMode = true; navigateRight(url); });
  rightRendered.addEventListener('click', () => { rightLineHash = ''; pendingRightLineJump = false; const url = new URL(location.href); url.searchParams.delete('right-source'); rightSourceMode = false; navigateRight(url); });
  rightContents.addEventListener('click', () => rightOutline.classList.toggle('open'));
  document.querySelector('#right-copy')!.addEventListener('click', (event) => { const path = rightSelected(); if (path) copyWithFeedback(event.currentTarget as HTMLButtonElement, path, 'Copy path'); });
  rightDownload.addEventListener('click', () => { const path = rightSelected(); if (path) downloadFile(path); });
  rightPrint.addEventListener('click', () => { const path = rightSelected(); if (path) deps.printFile(path, rightPrint); });
  rightOpenPDF.addEventListener('click', () => { const path = rightSelected(); if (path) openPDF(path); });
  document.querySelector('#right-swap')!.addEventListener('click', swapPanes);
  document.querySelector('#right-only')!.addEventListener('click', showRightOnly);
  rightInteractive.addEventListener('click', () => { const path = rightSelected(); if (path) setInteractive(path, !preview.hasInteractive(path)); });
  return {
    rightSelected, openRight, closeRight, swapPanes, showRightOnly, refreshRight,
    get lineHash() { return rightLineHash; },
    invalidate: () => { rightShownKey = ''; rightTag = ''; },
    invalidateTag: () => { rightTag = ''; },
    selectLine: (number: number) => { rightLineHash = `#L${number}`; highlightCodeLines(true, rightContent, rightLineHash); },
    restoreScroll: () => {
      pendingRightScroll = history.state?.rightScroll ?? 0; rightPane.scrollTop = pendingRightScroll ?? 0;
      rightShownKey = ''; rightTag = '';
    },
  };
}
