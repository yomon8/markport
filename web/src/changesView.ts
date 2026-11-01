import { renderChanges, orderedChanges, reviewButton, gitStatusIndicator, diffURL, type Change, type ChangesReply, type DiffReply } from './diff';
import { comparisonBase, comparisonOptions, comparisonURL, historyURL, renderCommit, renderCommitDiff, renderHistoryList, type Commit, type CommitDetail, type HistoryPage } from './history';
import { ReviewState } from './review';
import { setIcon, type IconName } from './icons';
import { copyWithFeedback } from './copyControls';
import { shortcutText } from './shortcuts';
import { printFile, type createPrintView } from './printView';
import type { FileView } from './fileGit';
import type { TreeView } from './tree';
import type { TabTitle } from './tabTitle';
import type { createContentWidth } from './contentWidth';
import type { createPreview } from './preview';

type Mode = FileView | 'changes' | 'paste' | 'history';
type ChangesViewOptions = {
  content: HTMLElement; title: HTMLElement; outline: HTMLElement; main: HTMLElement;
  changesTree: HTMLElement; historyTree: HTMLElement; changesTab: HTMLButtonElement;
  sidebar: HTMLElement; sidebarToggle: HTMLButtonElement;
  view: Pick<TreeView, 'revealDirectory'>;
  tabTitle: Pick<TabTitle, 'setFallback'>;
  contentWidth: Pick<ReturnType<typeof createContentWidth>, 'createButton'>;
  preview: Pick<ReturnType<typeof createPreview>, 'hasInteractive' | 'setInteractive'>;
  printView: Pick<ReturnType<typeof createPrintView>, 'open'>;
  selected: () => string; selectedMode: () => Mode; selectedBase: () => string;
  getSourceMode: () => boolean; setSourceMode: (value: boolean) => void;
  getRememberedBase: () => string; getRootName: () => string;
  getDisplayedHTML: () => string; setDisplayedHTML: (html: string) => void;
  getDisplayedPath: () => string; getDisplayedMode: () => Mode;
  showFiles: () => void;
  selectFileView: (mode: FileView) => void;
  navigate: (url: string) => void; openRight: (path: string) => void;
  openPDF: (path: string) => void; downloadFile: (path: string) => void;
  requestRefresh: () => void; getGit: <T>(url: string) => Promise<T>;
};

export function createChangesView(deps: ChangesViewOptions) {
  const { content, title, outline, main, changesTree, historyTree, changesTab, sidebar, sidebarToggle,
    view, tabTitle, contentWidth, preview, printView, selected, selectedMode, selectedBase,
    selectFileView, navigate, openRight, openPDF, downloadFile, requestRefresh, getGit } = deps;
  const { setInteractive } = preview;
  const comparisonControls = document.createElement('div'); comparisonControls.className = 'comparison-controls'; comparisonControls.hidden = true;
  const comparisonForm = document.createElement('form'); comparisonForm.className = 'comparison-form';
  const comparisonLabel = document.createElement('label'); comparisonLabel.htmlFor = 'comparison-base'; comparisonLabel.textContent = 'Compare with current from';
  const comparisonInput = document.createElement('input'); comparisonInput.id = 'comparison-base'; comparisonInput.type = 'text'; comparisonInput.placeholder = 'Commit ID or HEAD'; comparisonInput.autocomplete = 'off'; comparisonInput.spellcheck = false; comparisonInput.setAttribute('list', 'comparison-options');
  const comparisonList = document.createElement('datalist'); comparisonList.id = 'comparison-options';
  const comparisonError = document.createElement('span'); comparisonError.className = 'comparison-error'; comparisonError.setAttribute('role', 'alert'); comparisonError.hidden = true;
  const comparisonSubmit = document.createElement('button'); comparisonSubmit.type = 'submit'; comparisonSubmit.textContent = 'Compare';
  const comparisonReset = document.createElement('button'); comparisonReset.type = 'button'; comparisonReset.textContent = 'Use HEAD';
  const comparisonCurrent = document.createElement('span'); comparisonCurrent.className = 'comparison-current';
  comparisonForm.append(comparisonLabel, comparisonInput, comparisonList, comparisonSubmit); comparisonControls.append(comparisonForm, comparisonReset, comparisonError, comparisonCurrent); title.after(comparisonControls);
  let currentChanges: ChangesReply | undefined;
  let historyPage: HistoryPage | undefined;
  let displayedHistoryList = '';
  let cachedCommit: CommitDetail | undefined;
  let cachedHistoricalDiff: { id: string; path: string; value: DiffReply } | undefined;
  let displayedChanges = '';
  const review = new ReviewState();
  let reviewVersion = 0;
  let onlyUnreviewed = false;
  let treeChanges = true;
  const collapsedChangeFolders = new Set<string>();
  let changeRootId = '';
  let shownBase: string | undefined;
  let lastRevealedDiff = '';
  function syncComparisonControls(): void {
    const mode = selectedMode(); const active = mode === 'changes' || mode === 'diff';
    comparisonControls.hidden = !active;
    if (!active) return;
    const base = selectedBase();
    if (shownBase !== base) { comparisonInput.value = base; shownBase = base; }
    comparisonCurrent.textContent = `Base: ${base ? base.slice(0, 12) : 'HEAD'} → current working files`;
    comparisonReset.hidden = !base;
  }
  let comparisonCommits: Commit[] = []; let comparisonLoadedAt = 0;
  function fillComparisonOptions(): void {
    comparisonList.replaceChildren(...comparisonOptions(comparisonCommits).map((choice) => {
      const option = document.createElement('option'); option.value = choice.value; option.label = choice.label; option.textContent = choice.label; return option;
    }));
  }
  async function loadComparisonOptions(): Promise<void> {
    if (Date.now() - comparisonLoadedAt < 30000) return;
    comparisonLoadedAt = Date.now();
    try {
      const reply = await getGit<HistoryPage>('/api/git/history');
      if (reply.available) { comparisonCommits = reply.commits; fillComparisonOptions(); }
    } catch { comparisonLoadedAt = 0; }
  }
  fillComparisonOptions();
  comparisonInput.addEventListener('focus', () => { void loadComparisonOptions(); });
  function submitComparison(): void {
    const base = comparisonBase(comparisonInput.value, comparisonCommits);
    if (base === null) { comparisonError.textContent = 'Cannot load this comparison.'; comparisonError.hidden = false; return; }
    navigate(comparisonURL(base));
  }
  comparisonInput.addEventListener('input', (event) => {
    comparisonError.hidden = true;
    const chosen = event instanceof InputEvent ? event.inputType === 'insertReplacementText' : true;
    if (chosen && [...comparisonList.children].some((option) => (option as HTMLOptionElement).value === comparisonInput.value)) submitComparison();
  });
  comparisonForm.addEventListener('submit', (event) => { event.preventDefault(); submitComparison(); });
  comparisonReset.addEventListener('click', () => navigate(comparisonURL()));
  function applyDiffAvailability(button: HTMLButtonElement, path: string): void {
    button.querySelector('.change-dot')?.remove();
    if (!currentChanges?.available) { button.disabled = false; button.title = ''; return; }
    const changed = currentChanges.changes.some((change) => change.path === path);
    button.disabled = !changed;
    button.title = changed ? 'Changed since the comparison base' : `No changes against ${deps.getRememberedBase() ? deps.getRememberedBase().slice(0, 7) : 'HEAD'}`;
    if (changed) { const dot = document.createElement('span'); dot.className = 'change-dot'; dot.setAttribute('aria-hidden', 'true'); button.append(dot); }
  }
  function syncDiffButton(path: string): void {
    const button = ['file', 'file-history', 'blame'].includes(selectedMode()) ? title.querySelector<HTMLButtonElement>('.view-segment button[data-diff]') : null;
    if (button) applyDiffAvailability(button, path);
  }
  function showTitle(path: string, kind = '', missing = false, canDownload = true): void {
    title.replaceChildren();
    if (selectedMode() === 'history') {
      const heading = document.createElement('strong'); heading.textContent = `Git history${new URL(location.href).searchParams.get('commit') ? ` · ${new URL(location.href).searchParams.get('commit')!.slice(0, 7)}` : ''}`;
      title.append(heading); tabTitle.setFallback('Git history — markport'); return;
    }
    if (selectedMode() === 'changes') {
      const heading = document.createElement('strong'); heading.textContent = 'Git changes'; title.append(heading); tabTitle.setFallback('Git changes — markport'); return;
    }
    if (!path) { title.textContent = deps.getRootName() || 'markport'; tabTitle.setFallback('markport'); return; }
    const crumbs = document.createElement('div'); crumbs.className = 'breadcrumbs';
    const parts = path.split('/');
    parts.forEach((part, index) => {
      if (index) { const separator = document.createElement('span'); separator.className = 'crumb-separator'; separator.textContent = ' / '; crumbs.append(separator); }
      if (index < parts.length - 1) {
        const button = document.createElement('button'); button.type = 'button'; button.className = 'crumb'; button.textContent = part;
        button.addEventListener('click', () => {
          deps.showFiles();
          if (sidebar.classList.contains('collapsed')) sidebarToggle.click();
          if (window.innerWidth <= 700) sidebar.classList.add('open');
          view.revealDirectory(parts.slice(0, index + 1).join('/'));
        }); crumbs.append(button);
      } else { const label = document.createElement('strong'); label.textContent = part; if (missing) label.className = 'missing'; crumbs.append(label); }
    });
    title.append(crumbs);
    const actions = document.createElement('div'); actions.className = 'title-actions';
    const segment = (choices: { label: string; selected: boolean; disabled?: boolean; diff?: boolean; select: () => void }[]): void => {
      const group = document.createElement('div'); group.className = 'view-segment'; group.setAttribute('role', 'group'); group.setAttribute('aria-label', choices.map((choice) => choice.label).join(' or '));
      for (const choice of choices) {
        const button = document.createElement('button'); button.type = 'button'; button.textContent = choice.label;
        button.setAttribute('aria-pressed', String(choice.selected)); button.disabled = Boolean(choice.disabled);
        if (choice.diff) { button.dataset.diff = ''; if (!choice.selected) applyDiffAvailability(button, path); }
        button.addEventListener('click', choice.select); group.append(button);
      }
      actions.append(group);
    };
    if (kind) {
      const badge = document.createElement('span'); badge.className = 'kind-badge';
      const extension = path.split('.').at(-1)?.toLowerCase() ?? '';
      const languages: Record<string, string> = { py: 'Python', go: 'Go', js: 'JavaScript', ts: 'TypeScript', tsx: 'TypeScript', jsx: 'JavaScript', rs: 'Rust', java: 'Java', sh: 'Shell', html: 'HTML', css: 'CSS', json: 'JSON', yaml: 'YAML', yml: 'YAML' };
      badge.textContent = kind === 'History' || kind === 'Blame' ? kind : kind === 'diff' ? 'Git Diff' : kind === 'markdown' ? 'Markdown' : kind === 'html' ? 'HTML' : ((languages[extension] ?? extension.toUpperCase()) || 'Code'); actions.append(badge);
    }
    if (selectedMode() === 'diff') {
      const change = currentChanges?.changes.find((item) => item.path === path);
      if (change) {
        crumbs.prepend(gitStatusIndicator(change));
        const reviewed = review.has(change.path, change.revision);
        actions.append(reviewButton(change, reviewed, () => toggleReview(change)));
        const previous = diffNeighbor(path, -1, onlyUnreviewed);
        const next = diffNeighbor(path, 1, onlyUnreviewed);
        const navigation = document.createElement('div'); navigation.className = 'diff-navigation';
        const addNavigation = (label: string, target: Change | undefined): void => {
          const button = document.createElement('button'); button.type = 'button'; button.textContent = label;
          button.disabled = !target; button.title = target ? `${label}: ${target.path}` : `No ${label.toLowerCase()} file`;
          button.addEventListener('click', () => { if (target) navigate(diffURL(target.path, selectedBase())); }); navigation.append(button);
        };
        addNavigation(`Previous (${shortcutText('previousChange')})`, previous);
        addNavigation(`Next (${shortcutText('nextChange')})`, next);
        const reviewNext = document.createElement('button'); reviewNext.type = 'button'; reviewNext.textContent = `Review and next (${shortcutText('reviewNext')})`;
        reviewNext.addEventListener('click', markReviewedAndNext); navigation.append(reviewNext);
        actions.append(navigation);
      }
      const deleted = currentChanges?.changes.find((change) => change.path === path)?.status === 'deleted';
      segment([{ label: 'File', selected: false, disabled: deleted, select: () => selectFileView('file') }, { label: 'Diff', selected: true, select: () => {} },
        { label: 'History', selected: false, select: () => selectFileView('file-history') }, { label: 'Blame', selected: false, disabled: deleted, select: () => selectFileView('blame') }]);
    } else {
      segment([{ label: 'File', selected: selectedMode() === 'file', select: () => selectFileView('file') },
        { label: 'Diff', selected: false, diff: true, select: () => selectFileView('diff') },
        { label: 'History', selected: selectedMode() === 'file-history', select: () => selectFileView('file-history') },
        { label: 'Blame', selected: selectedMode() === 'blame', select: () => selectFileView('blame') }]);
    }
    if (selectedMode() === 'file' && (kind === 'markdown' || kind === 'html')) {
      segment([{ label: 'Preview', selected: !deps.getSourceMode(), select: () => { if (deps.getSourceMode()) { deps.setSourceMode(false); const url = new URL(location.href); url.searchParams.delete('source'); history.pushState({ ...history.state, scroll: main.scrollTop }, '', url); requestRefresh(); } } }, { label: 'Source', selected: deps.getSourceMode(), select: () => { if (!deps.getSourceMode()) { deps.setSourceMode(true); const url = new URL(location.href); url.searchParams.set('source', '1'); history.pushState({ ...history.state, scroll: main.scrollTop }, '', url); requestRefresh(); } } }]);
    }
    if (kind === 'html') {
      const interactive = document.createElement('button'); interactive.type = 'button'; interactive.className = 'interactive-toggle';
      const enabled = preview.hasInteractive(path);
      interactive.textContent = enabled ? 'Disable JavaScript' : 'Enable JavaScript';
      interactive.setAttribute('aria-pressed', String(enabled));
      interactive.title = 'Allow scripts in this HTML preview until this tab is closed';
      interactive.addEventListener('click', () => setInteractive(path, !enabled)); actions.append(interactive);
    }
    const auxiliary = document.createElement('div'); auxiliary.className = 'title-auxiliary';
    if (kind === 'markdown' && content.dataset.kind === 'markdown' && selectedMode() === 'file' && !missing) actions.append(contentWidth.createButton());
    const menuButton = document.createElement('button'); menuButton.type = 'button'; menuButton.className = 'title-more'; setIcon(menuButton, 'more'); menuButton.title = 'File actions'; menuButton.setAttribute('aria-label', 'File actions'); menuButton.setAttribute('aria-expanded', 'false'); menuButton.setAttribute('aria-haspopup', 'menu');
    const menu = document.createElement('div'); menu.className = 'title-menu'; menu.setAttribute('role', 'menu'); menu.hidden = true;
    const closeMenu = (): void => { menu.hidden = true; menuButton.setAttribute('aria-expanded', 'false'); menuButton.focus(); };
    menuButton.addEventListener('click', () => { menu.hidden = !menu.hidden; menuButton.setAttribute('aria-expanded', String(!menu.hidden)); if (!menu.hidden) menu.querySelector<HTMLButtonElement>('button')?.focus(); });
    menu.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') { event.preventDefault(); closeMenu(); return; }
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
      event.preventDefault(); const items = [...menu.querySelectorAll<HTMLButtonElement>('button')]; const index = items.indexOf(document.activeElement as HTMLButtonElement);
      items[(index + (event.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length]?.focus();
    });
    const addAux = (label: string, icon: IconName, action: (button: HTMLButtonElement) => void, visible = true): void => {
      if (!visible) return;
      const desktop = document.createElement('button'); desktop.type = 'button'; desktop.className = 'title-icon'; setIcon(desktop, icon); desktop.title = label; desktop.setAttribute('aria-label', label); desktop.addEventListener('click', () => action(desktop)); auxiliary.append(desktop);
      const mobile = document.createElement('button'); mobile.type = 'button'; mobile.setAttribute('role', 'menuitem'); mobile.textContent = label; mobile.addEventListener('click', () => { action(mobile); closeMenu(); }); menu.append(mobile);
    };
    addAux('Open on right', 'panelRight', () => openRight(path), selectedMode() === 'file');
    addAux('Open PDF in new tab', 'external', () => openPDF(path), kind === 'pdf');
    addAux('Print / Save as PDF', 'printer', (button) => printView.open(printFile(path), menu.contains(button) ? menuButton : button), kind === 'markdown' && selectedMode() === 'file' && !missing);
    addAux('Download', 'download', () => downloadFile(path), ['file', 'diff'].includes(selectedMode()) && canDownload && !missing && (selectedMode() !== 'diff' || currentChanges?.changes.find((change) => change.path === path)?.status !== 'deleted'));
    addAux('Copy path', 'copy', (button) => copyWithFeedback(button, path, 'Copy path'));
    addAux('Contents', 'list', () => outline.classList.toggle('open'), !outline.hidden);
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
    title.append(actions); tabTitle.setFallback(`${parts.at(-1)} — markport`);
  }
  function toggleReview(change: Change): void {
    review.set(change.path, change.revision, !review.has(change.path, change.revision));
    reviewVersion++;
    updateChangeViews();
    if (selectedMode() === 'diff' && selected() === change.path) showTitle(change.path, 'diff');
  }
  function diffNeighbor(path: string, direction: -1 | 1, unreviewedOnly: boolean): Change | undefined {
    const changes = orderedChanges(currentChanges?.changes ?? [], treeChanges);
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
    if (next) navigate(diffURL(next.path, selectedBase())); else showTitle(path, 'diff');
  }
  function setReviewFilter(value: boolean): void {
    onlyUnreviewed = value;
    reviewVersion++;
    updateChangeViews();
    if (selectedMode() === 'diff') showTitle(selected(), 'diff');
  }
  function setTreeChanges(value: boolean): void { treeChanges = value; reviewVersion++; updateChangeViews(); }
  function toggleChangeFolder(path: string, open: boolean): void {
    if (open) collapsedChangeFolders.delete(path); else collapsedChangeFolders.add(path);
    for (const details of document.querySelectorAll<HTMLDetailsElement>('#changes-tree details[data-path], #content[data-kind="changes"] details[data-path]')) {
      if (details.dataset.path === path && details.open !== open) details.open = open;
    }
  }
  function updateChangesBadge(): void {
    const unreviewed = currentChanges?.available ? currentChanges.changes.filter((change) => !review.has(change.path, change.revision)).length : 0;
    let badge = changesTab.querySelector<HTMLElement>('.tab-badge');
    if (!unreviewed) { badge?.remove(); changesTab.removeAttribute('aria-label'); return; }
    if (!badge) { badge = document.createElement('span'); badge.className = 'tab-badge'; badge.setAttribute('aria-hidden', 'true'); changesTab.append(badge); }
    badge.textContent = String(unreviewed);
    changesTab.setAttribute('aria-label', `Changes, ${unreviewed} unreviewed`);
  }
  function updateChangeViews(): void {
    updateChangesBadge();
    if (!currentChanges) return;
    const rootId = currentChanges.rootId ?? '';
    if (changeRootId !== rootId) {
      changeRootId = rootId;
      collapsedChangeFolders.clear();
      lastRevealedDiff = '';
    }
    const path = selected();
    if (selectedMode() !== 'diff') lastRevealedDiff = '';
    if (selectedMode() === 'diff' && path !== lastRevealedDiff) {
      let folder = path.slice(0, path.lastIndexOf('/'));
      while (folder) {
        collapsedChangeFolders.delete(folder);
        folder = folder.slice(0, folder.lastIndexOf('/'));
      }
      lastRevealedDiff = path;
      reviewVersion++;
    }
    const key = `${JSON.stringify(currentChanges)}:${reviewVersion}`;
    const isReviewed = (change: Change): boolean => review.has(change.path, change.revision);
    if (displayedChanges !== key) {
      renderChanges(changesTree, currentChanges, isReviewed, toggleReview, onlyUnreviewed, setReviewFilter, treeChanges, setTreeChanges, collapsedChangeFolders, toggleChangeFolder, true);
      displayedChanges = key;
    }
    changesTree.querySelector<HTMLAnchorElement>('a[aria-current="page"]')?.removeAttribute('aria-current');
    const active = [...changesTree.querySelectorAll<HTMLAnchorElement>('a[href]')].find((link) => selectedMode() === 'diff' && link.getAttribute('href') === diffURL(path, selectedBase()));
    active?.setAttribute('aria-current', 'page');
    if (selectedMode() === 'diff' && deps.getDisplayedMode() === 'diff' && deps.getDisplayedPath() === path) {
      const change = currentChanges.changes.find((item) => item.path === path);
      const button = title.querySelector<HTMLButtonElement>('.review-toggle');
      const statuses = title.querySelector<HTMLElement>('.git-status')?.dataset.statuses;
      if (change && (button?.getAttribute('aria-pressed') !== String(isReviewed(change)) || statuses !== JSON.stringify(change.gitStatuses ?? []))) showTitle(path, 'diff');
    }
    if (selectedMode() === 'changes' && deps.getDisplayedHTML() !== key) {
      content.dataset.kind = 'changes';
      renderChanges(content, currentChanges, isReviewed, toggleReview, onlyUnreviewed, setReviewFilter, treeChanges, setTreeChanges, collapsedChangeFolders, toggleChangeFolder);
      deps.setDisplayedHTML(key);
      outline.hidden = true; showTitle('');
    }
  }
  function updateHistoryViews(): void {
    if (!historyPage) return;
    const key = JSON.stringify([historyPage, new URL(location.href).searchParams.get('commit')]);
    if (key === displayedHistoryList) return;
    const scroll = historyTree.scrollTop;
    renderHistoryList(historyTree, historyPage, new URL(location.href).searchParams.get('commit') ?? '', () => { void loadOlderHistory(); });
    historyTree.scrollTop = scroll;
    displayedHistoryList = key;
  }
  async function loadOlderHistory(): Promise<void> {
    const current = historyPage;
    if (!current?.head || current.nextOffset === null) return;
    const button = historyTree.querySelector<HTMLButtonElement>('.history-more');
    if (button) button.disabled = true;
    try {
      const older = await getGit<HistoryPage>(`/api/git/history?head=${encodeURIComponent(current.head)}&offset=${current.nextOffset}`);
      if (historyPage !== current || selectedMode() !== 'history') return;
      historyPage = { ...current, commits: [...current.commits, ...older.commits], nextOffset: older.nextOffset };
      updateHistoryViews();
    } catch {
      if (button) { button.disabled = false; button.textContent = 'Try loading again'; }
    }
  }
  function acceptChanges(reply: ChangesReply): void {
    currentChanges = reply;
    if (selectedMode() === 'changes' || selectedMode() === 'diff') comparisonError.hidden = true;
    if (review.sync(reply)) reviewVersion++;
    updateChangeViews(); syncDiffButton(selected());
  }
  function mergeHistory(first: HistoryPage, knownHead?: string): boolean {
    if (knownHead && first.head !== knownHead) {
      historyPage = first; cachedCommit = undefined; cachedHistoricalDiff = undefined; displayedHistoryList = '';
      return true;
    }
    const previous = historyPage;
    historyPage = previous?.head && previous.head === first.head && first.available
      ? { ...first, commits: [...first.commits, ...previous.commits.slice(first.commits.length)], nextOffset: previous.nextOffset }
      : first;
    updateHistoryViews(); return false;
  }
  function renderHistory(commitID: string, path: string, commit: CommitDetail | undefined, diff: DiffReply | undefined, pathChanged: boolean): boolean {
    if (!commitID && historyPage?.commits.length) {
      history.replaceState(history.state, '', historyURL(historyPage.commits[0].id)); return true;
    }
    if (!historyPage?.available || !historyPage.commits.length && !commitID) {
      if (pathChanged || content.dataset.kind !== 'history-empty') {
        content.dataset.kind = 'history-empty'; content.replaceChildren();
        const hint = document.createElement('p'); hint.className = 'hint';
        hint.textContent = historyPage?.available ? 'No commits to display.' : historyPage?.reason === 'git_unavailable' ? 'Git was not found. Git is required to show history.' : 'This directory is not a Git repository.';
        content.append(hint); deps.setDisplayedHTML(hint.textContent); outline.hidden = true; showTitle('');
      }
    } else if (commit) {
      cachedCommit = commit;
      if (diff) cachedHistoricalDiff = { id: commitID, path, value: diff };
      const key = diff ? JSON.stringify([commit.id, path, diff]) : JSON.stringify(commit);
      if (pathChanged || deps.getDisplayedHTML() !== key) {
        content.dataset.kind = diff ? 'diff' : 'history';
        if (diff) renderCommitDiff(content, commit, diff); else renderCommit(content, commit);
        deps.setDisplayedHTML(key); outline.hidden = true; showTitle('');
      }
    }
    return false;
  }
  function failComparison(): void {
    currentChanges = undefined; displayedChanges = '';
    const hint = document.createElement('p'); hint.className = 'hint'; hint.textContent = 'Cannot load this comparison.';
    comparisonError.textContent = 'Cannot load this comparison.'; comparisonError.hidden = false;
    changesTree.replaceChildren(hint);
  }
  return {
    showTitle, syncComparisonControls, diffNeighbor, markReviewedAndNext, acceptChanges, mergeHistory, renderHistory, failComparison,
    get currentChanges() { return currentChanges; },
    get historyPage() { return historyPage; },
    get onlyUnreviewed() { return onlyUnreviewed; },
    getCommit: (id: string, knownHead?: string) => cachedCommit?.id === id && knownHead ? Promise.resolve(cachedCommit) : getGit<CommitDetail>(`/api/git/commit?id=${encodeURIComponent(id)}`),
    getHistoricalDiff: (id: string, path: string, knownHead?: string) => cachedHistoricalDiff?.id === id && cachedHistoricalDiff.path === path && knownHead ? Promise.resolve(cachedHistoricalDiff.value) : getGit<DiffReply>(`/api/git/commit-diff?id=${encodeURIComponent(id)}&path=${encodeURIComponent(path)}`),
  };
}
