type Match = { path: string; line: number; before: string; text: string; after: string };
type SearchReply = { matches: Match[]; filesScanned: number; bytesRead: number; ignoredSkipped: number; limit?: 'files' | 'entries' | 'bytes' | 'matches' | 'timeout' };

type SearchOptions = { caseSensitive: boolean; wholeWord: boolean; regex: boolean; include: string; exclude: string; ignored: boolean };
const storageKey = 'markport-content-search-options';
const defaultOptions: SearchOptions = { caseSensitive: false, wholeWord: false, regex: false, include: '', exclude: '', ignored: false };
let memoryOptions = { ...defaultOptions };

function loadOptions(): SearchOptions {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) ?? '{}') as Partial<SearchOptions> | null;
    const options = { ...defaultOptions };
    if (saved && typeof saved === 'object') {
      for (const key of ['caseSensitive', 'wholeWord', 'regex', 'ignored'] as const) if (typeof saved[key] === 'boolean') options[key] = saved[key];
      for (const key of ['include', 'exclude'] as const) if (typeof saved[key] === 'string') options[key] = saved[key];
    }
    return options;
  } catch { return { ...memoryOptions }; }
}

export function initContentSearch(container: HTMLElement, navigate: (url: string) => void): void {
  const summary = document.createElement('summary');
  summary.textContent = 'Search contents';
  const form = document.createElement('form');
  form.className = 'content-search-form';
  form.innerHTML = '<label for="content-query">Text to find</label><div class="content-query-row"><input id="content-query" type="search" required maxlength="200" placeholder="Text to find"><div class="content-search-toggles" role="group" aria-label="Search options"><button type="button" class="tool-icon" id="content-case" aria-label="Match case" title="Match case">Aa</button><button type="button" class="tool-icon" id="content-word" aria-label="Match whole word" title="Match whole word">ab</button><button type="button" class="tool-icon" id="content-regex" aria-label="Use regular expression" title="Use regular expression">.*</button></div></div><label for="content-folder">Folder</label><input id="content-folder" type="text" placeholder="Root (or path/to/folder)"><label for="content-include">Files to include</label><input id="content-include" type="text" placeholder="*.md, docs/**"><label for="content-exclude">Files to exclude</label><input id="content-exclude" type="text" placeholder="*.md, docs/**"><label class="content-search-ignored"><input id="content-ignored" type="checkbox">Include ignored files</label><div class="content-search-actions"><button type="submit">Search</button><button type="button" id="content-cancel" hidden>Cancel</button></div>';
  const query = form.querySelector<HTMLInputElement>('#content-query')!;
  const folder = form.querySelector<HTMLInputElement>('#content-folder')!;
  const cancel = form.querySelector<HTMLButtonElement>('#content-cancel')!;
  const options = loadOptions();
  const include = form.querySelector<HTMLInputElement>('#content-include')!;
  const exclude = form.querySelector<HTMLInputElement>('#content-exclude')!;
  const ignored = form.querySelector<HTMLInputElement>('#content-ignored')!;
  include.value = options.include; exclude.value = options.exclude; ignored.checked = options.ignored;
  function saveOptions(): void {
    options.include = include.value; options.exclude = exclude.value; options.ignored = ignored.checked;
    memoryOptions = { ...options };
    try { localStorage.setItem(storageKey, JSON.stringify(options)); } catch { /* Keep this tab's options in memory. */ }
  }
  for (const [key, id] of [['caseSensitive', 'content-case'], ['wholeWord', 'content-word'], ['regex', 'content-regex']] as const) {
    const button = form.querySelector<HTMLButtonElement>(`#${id}`)!;
    button.setAttribute('aria-pressed', String(options[key]));
    button.addEventListener('click', () => { options[key] = !options[key]; button.setAttribute('aria-pressed', String(options[key])); saveOptions(); });
  }
  include.addEventListener('input', saveOptions); exclude.addEventListener('input', saveOptions); ignored.addEventListener('change', saveOptions);
  const status = document.createElement('p'); status.className = 'content-search-status'; status.setAttribute('role', 'status');
  const results = document.createElement('nav'); results.className = 'content-search-results'; results.setAttribute('aria-label', 'Content search results');
  container.append(summary, form, status, results);
  let request: AbortController | undefined;
  let version = 0;

  function finish(current: number): void {
    if (current !== version) return;
    request = undefined;
    cancel.hidden = true;
    form.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled = false;
  }
  cancel.addEventListener('click', () => {
    version++;
    request?.abort(); request = undefined;
    cancel.hidden = true;
    form.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled = false;
    status.textContent = 'Search canceled.';
  });
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const term = query.value.trim();
    if (!term) return;
    request?.abort();
    const controller = new AbortController(); request = controller;
    const current = ++version;
    results.replaceChildren();
    status.textContent = 'Searching…';
    cancel.hidden = false;
    form.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled = true;
    const params = new URLSearchParams({ q: term, folder: folder.value.trim() });
    saveOptions();
    if (options.caseSensitive) params.set('case', '1');
    if (options.wholeWord) params.set('word', '1');
    if (options.regex) params.set('regex', '1');
    if (options.ignored) params.set('ignored', '1');
    if (options.include.trim()) params.set('include', options.include.trim());
    if (options.exclude.trim()) params.set('exclude', options.exclude.trim());
    void fetch(`/api/content-search?${params}`, { cache: 'no-store', signal: controller.signal })
      .then(async (response) => {
        const body = await response.json() as SearchReply & { error?: string; message?: string };
        if (!response.ok) throw new Error(body.error === 'invalid_query' ? body.message ?? 'Invalid search query.' : body.error === 'invalid_path' ? 'Enter a valid folder path inside the browsing root.' : body.error === 'not_found' ? 'Folder not found.' : 'Search failed. Please try again.');
        return body;
      })
      .then((body) => {
        if (current !== version) return;
        const count = body.matches.length;
        const limit = body.limit === 'timeout' ? ' Search timed out; results are partial.' : body.limit ? ` Partial results: ${body.limit === 'matches' ? 'match' : body.limit === 'files' ? 'file' : body.limit === 'entries' ? 'directory entry' : 'read size'} limit reached.` : '';
        status.textContent = count ? `${count} ${count === 1 ? 'match' : 'matches'} in ${body.filesScanned} files.${limit}` : `No results in ${body.filesScanned} files.${limit}`;
        if (body.ignoredSkipped > 0) status.textContent += ` ${body.ignoredSkipped} ignored files skipped.`;
        const list = document.createElement('ul');
        for (const match of body.matches) {
          const item = document.createElement('li');
          const link = document.createElement('a');
          const params = new URLSearchParams({ path: match.path });
          if (/\.(md|markdown|html|htm)$/i.test(match.path)) params.set('source', '1');
          link.href = `/?${params}#L${match.line}`;
          link.addEventListener('click', (event) => {
            if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
            event.preventDefault(); navigate(link.href);
          });
          const heading = document.createElement('strong'); heading.textContent = `${match.path}:${match.line}`;
          const before = document.createElement('span'); before.textContent = match.before;
          const text = document.createElement('span'); text.className = 'match-line'; text.textContent = match.text;
          const after = document.createElement('span'); after.textContent = match.after;
          link.append(heading, before, text, after); item.append(link); list.append(item);
        }
        results.append(list);
      })
      .catch((error: unknown) => {
        if (current !== version) return;
        status.textContent = error instanceof Error ? error.message : 'Search failed. Please try again.';
      })
      .finally(() => finish(current));
  });
}
