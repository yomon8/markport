import { copyText } from './clipboard';
import { applyTextEdit, continueList, indentLines } from './pasteEditing';
import { highlightMarkdown, maxHighlightBytes, maxPasteBytes, pasteBytes } from './pasteHighlight';
import { matchesShortcut } from './shortcuts';
import { printMarkdown } from './printView';

let sessionDraft: string | undefined;
const draftKey = 'markport-pasted-markdown';
const caretKey = `${draftKey}-caret`;
const persistentKey = `${draftKey}-persistent`;
type View = 'text' | 'split' | 'rendered';
type Options = {
  content: HTMLElement; title: HTMLElement; main: HTMLElement;
  isActive: () => boolean; nextVersion: () => number; version: () => number;
  onPreview: (preview: HTMLElement, current: () => boolean) => void;
  onText: () => void;
  onPrint: (input: ReturnType<typeof printMarkdown>, button: HTMLButtonElement) => void;
};
export function createPasteEditor(options: Options): { refresh: () => void; dispose: () => void } {
  const { content, title, main } = options;
  const lifetime = new window.AbortController(); const { signal } = lifetime;
  let disposed = false; let composing = false; let frame = 0; let debounce = 0;
  let syncedInputTop = -1; let syncedPreviewTop = -1;
  let request: AbortController | undefined; let view: View = 'text'; let renderedMarkdown: string | undefined;
  let storageError = ''; let renderError = ''; let actionError = ''; let saveState = 'Saved in this tab';
  content.dataset.kind = 'paste'; content.dataset.pasteView = view;
  const heading = document.createElement('strong'); heading.textContent = 'Pasted Markdown';
  const status = document.createElement('span'); status.className = 'paste-status'; status.setAttribute('role', 'status');
  const actions = document.createElement('div'); actions.className = 'paste-title-actions';
  const segment = document.createElement('div'); segment.className = 'view-segment'; segment.setAttribute('role', 'group'); segment.setAttribute('aria-label', 'Paste view');
  const buttons = new Map<View, HTMLButtonElement>();
  for (const mode of ['text', 'split', 'rendered'] as const) {
    const button = document.createElement('button'); button.type = 'button'; button.textContent = mode[0].toUpperCase() + mode.slice(1);
    button.id = mode === 'rendered' ? 'paste-view-toggle' : `paste-${mode}-view`;
    button.dataset.view = mode; button.setAttribute('aria-pressed', String(mode === view));
    button.addEventListener('click', () => setView(mode)); buttons.set(mode, button); segment.append(button);
  }
  const menu = document.createElement('div'); menu.className = 'paste-menu'; menu.id = 'paste-menu'; menu.hidden = true;
  const more = document.createElement('button'); more.type = 'button'; more.textContent = '⋯'; more.setAttribute('aria-label', 'Paste options'); more.setAttribute('aria-controls', menu.id); more.setAttribute('aria-expanded', 'false');
  const menuButton = (label: string, action: () => void): HTMLButtonElement => {
    const button = document.createElement('button'); button.type = 'button'; button.textContent = label;
    button.addEventListener('click', () => { closeMenu(); action(); }); menu.append(button); return button;
  };
  menuButton('Clear', () => {
    if (input.value && !window.confirm('Clear all pasted Markdown?')) return;
    applyTextEdit(input, { start: 0, end: input.value.length, text: '', selectionStart: 0, selectionEnd: 0 });
    setView('text');
  });
  const copy = menuButton('Copy all', () => { void copyText(input.value).then((ok) => { actionError = ok ? '' : 'Could not copy text.'; updateNotice(); copy.textContent = ok ? 'Copied' : 'Copy all'; }); });
  menuButton('Save as .md', () => {
    const url = URL.createObjectURL(new Blob([input.value], { type: 'text/markdown;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = 'pasted-markdown.md'; document.body.append(link); link.click(); link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  menuButton('Print / Save as PDF', () => {
    if (!input.value.trim()) { actionError = 'Paste Markdown text to print.'; updateNotice(); return; }
    if (pasteBytes(input.value) > maxPasteBytes) { actionError = 'Markdown exceeds the 1 MiB limit.'; updateNotice(); return; }
    options.onPrint(printMarkdown(input.value), more);
  });
  const setting = (label: string, checked: boolean, change: (checked: boolean) => void): HTMLInputElement => {
    const row = document.createElement('label'); const box = document.createElement('input'); box.type = 'checkbox'; box.checked = checked;
    box.addEventListener('change', () => change(box.checked)); row.append(box, label); menu.append(row); return box;
  };
  setting('Monospace font', true, (checked) => { content.classList.toggle('paste-proportional', !checked); syncScroll(); });
  setting('Readable width', false, (checked) => { content.classList.toggle('paste-readable', checked); syncScroll(); });
  const persistent = setting('Save in this browser', false, (checked) => {
    try {
      if (checked) localStorage.setItem(persistentKey, 'true');
      else { localStorage.removeItem(persistentKey); localStorage.removeItem(draftKey); }
      persist();
    } catch { storageError = 'This browser could not change saved text settings.'; saveState = 'Save failed'; updateStatus(); }
  });
  const privacy = document.createElement('p'); privacy.textContent = 'Browser saving keeps text after closing this tab. Avoid it on shared devices.'; menu.append(privacy);
  actions.append(segment, more, menu); title.replaceChildren(heading, status, actions);
  const editor = document.createElement('div'); editor.className = 'paste-editor';
  const label = document.createElement('label'); label.htmlFor = 'paste-input'; label.textContent = 'Markdown Text'; label.className = 'visually-hidden';
  const surface = document.createElement('div'); surface.className = 'paste-editor-surface';
  const highlight = document.createElement('pre'); highlight.className = 'paste-highlight'; highlight.setAttribute('aria-hidden', 'true');
  const input = document.createElement('textarea'); input.id = 'paste-input'; input.placeholder = 'Paste Markdown here'; input.spellcheck = false;
  const preview = document.createElement('div'); preview.className = 'paste-preview'; preview.hidden = true;
  const notice = document.createElement('p'); notice.className = 'paste-notice'; notice.setAttribute('role', 'status'); notice.hidden = true;
  surface.append(highlight, input); editor.append(label, surface); content.replaceChildren(editor, preview, notice);
  try {
    persistent.checked = localStorage.getItem(persistentKey) === 'true';
  } catch { /* Session saving still works when browser saving is unavailable. */ }
  try {
    input.value = sessionDraft ?? sessionStorage.getItem(draftKey) ?? (persistent.checked ? localStorage.getItem(draftKey) : '') ?? '';
  } catch { storageError = 'Saved text could not be restored.'; saveState = 'Save unavailable'; }
  const active = (): boolean => !disposed && content.isConnected && options.isActive();
  const valid = (version: number): boolean => active() && options.version() === version && view !== 'text';
  function closeMenu(): void {
    if (menu.contains(document.activeElement)) more.focus({ preventScroll: true });
    menu.hidden = true; more.setAttribute('aria-expanded', 'false');
  }
  more.addEventListener('click', () => { menu.hidden = !menu.hidden; more.setAttribute('aria-expanded', String(!menu.hidden)); if (!menu.hidden) menu.querySelector('button')?.focus(); });
  document.addEventListener('pointerdown', (event) => { if (!actions.contains(event.target as Node)) closeMenu(); }, { signal });
  function updateNotice(): void {
    const fallback = pasteBytes(input.value) > maxHighlightBytes ? 'Highlighting paused above 200 KiB; plain text editing is available.' : '';
    notice.textContent = renderError || storageError || actionError || fallback; notice.hidden = !notice.textContent;
    notice.classList.toggle('error', Boolean(renderError || storageError || actionError));
  }
  function updateStatus(): void {
    const bytes = pasteBytes(input.value);
    // Count a surrogate pair (for example an emoji) as one character.
    const characters = input.value.replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, '_').length;
    status.textContent = `${characters.toLocaleString()} characters · ${input.value.split('\n').length.toLocaleString()} lines · ${saveState}`;
    status.classList.toggle('warning', bytes > maxPasteBytes * 0.8); updateNotice();
  }
  function persist(): void {
    sessionDraft = input.value;
    storageError = ''; const tooLarge = pasteBytes(input.value) > maxPasteBytes;
    try {
      if (tooLarge || !input.value) sessionStorage.removeItem(draftKey); else sessionStorage.setItem(draftKey, input.value);
      if (persistent.checked) {
        if (tooLarge || !input.value) localStorage.removeItem(draftKey); else localStorage.setItem(draftKey, input.value);
      }
      saveState = tooLarge ? 'Over 1 MiB · not saved' : persistent.checked ? 'Saved in this browser' : 'Saved in this tab';
      if (tooLarge) storageError = 'Markdown exceeds the 1 MiB limit.';
    } catch { saveState = 'Save failed'; storageError = 'This tab could not save the text for reloading.'; }
    updateStatus();
  }
  function saveCaret(): void {
    try { sessionStorage.setItem(caretKey, JSON.stringify([input.selectionStart, input.selectionEnd, input.scrollTop])); } catch { /* Draft saving reports storage failures separately. */ }
  }
  function syncScroll(): void { highlight.scrollTop = input.scrollTop; highlight.scrollLeft = input.scrollLeft; }
  function paint(): void {
    frame = 0; if (!active() || composing) return;
    const fallback = pasteBytes(input.value) > maxHighlightBytes;
    surface.classList.toggle('paste-plain', fallback);
    // The sentinel preserves the last empty line without changing token output.
    highlight.innerHTML = (fallback ? '' : highlightMarkdown(input.value)) + '<span class="paste-sentinel">\u200b</span>';
    syncScroll();
  }
  function schedulePaint(): void { if (!composing && !frame) frame = requestAnimationFrame(paint); }
  function changed(): void {
    options.nextVersion(); request?.abort(); renderedMarkdown = undefined; renderError = ''; actionError = ''; preview.replaceChildren();
    persist(); saveCaret(); schedulePaint(); window.clearTimeout(debounce);
    if (view === 'split' && !composing) debounce = window.setTimeout(() => { void render(); }, 500);
  }
  function updateView(): void {
    content.dataset.pasteView = view; editor.hidden = view === 'rendered'; preview.hidden = view === 'text';
    for (const [mode, button] of buttons) button.setAttribute('aria-pressed', String(mode === view));
  }
  function setView(next: View): void {
    if (next === 'split' && window.innerWidth < 1200) return;
    if (next === 'text') {
      options.nextVersion(); request?.abort(); window.clearTimeout(debounce); view = next; updateView(); options.onText(); input.focus({ preventScroll: true }); syncScroll();
    } else {
      if (!input.value.trim()) { renderError = 'Paste Markdown text to render.'; updateNotice(); return; }
      if (pasteBytes(input.value) > maxPasteBytes) { renderError = 'Markdown exceeds the 1 MiB limit.'; updateNotice(); return; }
      saveCaret(); view = next; updateView(); closeMenu();
      if (next === 'rendered') buttons.get('rendered')!.focus(); else input.focus({ preventScroll: true });
      void render();
    }
  }
  async function render(force = false): Promise<void> {
    if (!active() || view === 'text' || composing) return;
    if (pasteBytes(input.value) > maxPasteBytes) { renderError = 'Markdown exceeds the 1 MiB limit.'; updateNotice(); return; }
    request?.abort(); const version = options.nextVersion(); const markdown = input.value;
    if (!force && renderedMarkdown === markdown) { options.onPreview(preview, () => valid(version)); return; }
    request = new window.AbortController(); preview.textContent = 'Rendering…'; renderError = ''; updateNotice();
    try {
      const response = await fetch('/api/render', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ markdown }), signal: request.signal });
      const body = await response.json() as { html?: string; message?: string };
      if (!response.ok) throw new Error(body.message ?? `HTTP ${response.status}`);
      if (typeof body.html !== 'string') throw new Error('Invalid render response');
      if (!valid(version)) return;
      preview.innerHTML = body.html; renderedMarkdown = markdown; options.onPreview(preview, () => valid(version)); updateNotice();
    } catch (error) {
      if (!valid(version)) return;
      if (view === 'rendered') setView('text');
      renderError = error instanceof Error ? error.message : 'Cannot render Markdown.'; updateNotice();
    }
  }
  input.addEventListener('input', changed);
  input.addEventListener('compositionstart', () => { composing = true; surface.classList.add('paste-composing'); window.clearTimeout(debounce); });
  input.addEventListener('compositionend', () => { composing = false; surface.classList.remove('paste-composing'); changed(); });
  input.addEventListener('select', saveCaret); input.addEventListener('keyup', saveCaret); input.addEventListener('click', saveCaret); input.addEventListener('blur', saveCaret);
  input.addEventListener('scroll', () => {
    syncScroll(); saveCaret();
    if (input.scrollTop === syncedInputTop) { syncedInputTop = -1; return; }
    if (view !== 'split' || renderedMarkdown !== input.value) return;
    const sources = [...highlight.querySelectorAll<HTMLElement>('.paste-heading')];
    const targets = [...preview.querySelectorAll<HTMLElement>('h1,h2,h3,h4,h5,h6')];
    let index = -1;
    sources.forEach((source, i) => { if (source.getBoundingClientRect().top <= highlight.getBoundingClientRect().top + 32) index = i; });
    if (index >= 0 && targets[index]) {
      preview.scrollTop = targets[index].offsetTop - preview.offsetTop; syncedPreviewTop = preview.scrollTop;
    }
  });
  preview.addEventListener('scroll', () => {
    if (preview.scrollTop === syncedPreviewTop) { syncedPreviewTop = -1; return; }
    if (view !== 'split' || renderedMarkdown !== input.value) return;
    const sources = [...highlight.querySelectorAll<HTMLElement>('.paste-heading')];
    const targets = [...preview.querySelectorAll<HTMLElement>('h1,h2,h3,h4,h5,h6')];
    let index = 0;
    targets.forEach((target, i) => { if (target.getBoundingClientRect().top <= preview.getBoundingClientRect().top + 32) index = i; });
    if (sources[index]) {
      const sourceTop = sources[index].getBoundingClientRect().top - highlight.getBoundingClientRect().top + highlight.scrollTop;
      const style = getComputedStyle(input); const lineHeight = Number.parseFloat(style.lineHeight);
      const sourceOffset = sourceTop - Number.parseFloat(style.paddingTop) - Number.parseFloat(style.borderTopWidth);
      input.scrollTop = Math.max(0, Math.floor(sourceOffset / lineHeight) * lineHeight);
      syncedInputTop = input.scrollTop; syncScroll(); saveCaret();
    }
  });
  main.addEventListener('keydown', (event) => {
    if (!active() || composing || event.isComposing || event.keyCode === 229) return;
    if (matchesShortcut(event, 'pasteView')) { event.preventDefault(); setView(view === 'text' ? 'rendered' : 'text'); return; }
    if (event.key === 'Escape' && !event.ctrlKey && !event.metaKey && !event.altKey) {
      if (!menu.hidden) { event.preventDefault(); event.stopPropagation(); closeMenu(); more.focus(); return; }
      if (event.target === input) { event.preventDefault(); event.stopPropagation(); input.blur(); buttons.get('text')!.focus(); return; }
    }
    if (event.target !== input || event.ctrlKey || event.metaKey || event.altKey) return;
    const edit = event.key === 'Enter' && !event.shiftKey ? continueList(input.value, input.selectionStart, input.selectionEnd)
      : event.key === 'Tab' ? indentLines(input.value, input.selectionStart, input.selectionEnd, event.shiftKey) : undefined;
    if (edit) { event.preventDefault(); applyTextEdit(input, edit); }
  }, { signal });
  const layout = main.closest<HTMLElement>('.layout')!;
  function resize(): void {
    if (view === 'split' && window.innerWidth < 1200) setView('text');
    buttons.get('split')!.hidden = window.innerWidth < 1200;
    if (window.innerWidth <= 700 && window.visualViewport) layout.style.setProperty('--paste-viewport-height', `${window.visualViewport.height}px`);
    else layout.style.removeProperty('--paste-viewport-height');
    syncScroll();
  }
  window.addEventListener('resize', resize, { signal }); window.visualViewport?.addEventListener('resize', resize, { signal });
  resize(); paint(); updateStatus();
  if (persistent.checked && !storageError) { saveState = 'Saved in this browser'; updateStatus(); }
  if (pasteBytes(input.value) > maxPasteBytes) { saveState = 'Over 1 MiB · not saved'; storageError = 'Markdown exceeds the 1 MiB limit.'; updateStatus(); }
  input.focus({ preventScroll: true });
  try {
    const caret: unknown = JSON.parse(sessionStorage.getItem(caretKey) ?? 'null');
    if (Array.isArray(caret) && caret.every((item) => typeof item === 'number' && Number.isFinite(item))) {
      input.setSelectionRange(caret[0], caret[1]); input.scrollTop = caret[2] ?? 0; syncScroll();
    }
  } catch { /* An invalid caret does not prevent draft restoration. */ }
  return {
    refresh: () => { if (view !== 'text') void render(true); },
    dispose: () => { saveCaret(); disposed = true; lifetime.abort(); request?.abort(); cancelAnimationFrame(frame); window.clearTimeout(debounce); layout.style.removeProperty('--paste-viewport-height'); },
  };
}
