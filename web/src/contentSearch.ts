type Match = { path: string; line: number; before: string; text: string; after: string };
type SearchReply = { matches: Match[]; filesScanned: number; bytesRead: number; limit?: 'files' | 'entries' | 'bytes' | 'matches' };

export function initContentSearch(container: HTMLElement, navigate: (url: string) => void): void {
  const form = document.createElement('form');
  form.className = 'content-search-form';
  form.innerHTML = '<label for="content-query">Search contents</label><input id="content-query" type="search" required maxlength="200" placeholder="Text to find"><label for="content-folder">Folder</label><input id="content-folder" type="text" placeholder="Root (or path/to/folder)"><div class="content-search-actions"><button type="submit">Search</button><button type="button" id="content-cancel" hidden>Cancel</button></div>';
  const query = form.querySelector<HTMLInputElement>('#content-query')!;
  const folder = form.querySelector<HTMLInputElement>('#content-folder')!;
  const cancel = form.querySelector<HTMLButtonElement>('#content-cancel')!;
  const status = document.createElement('p'); status.className = 'content-search-status'; status.setAttribute('role', 'status');
  const results = document.createElement('nav'); results.className = 'content-search-results'; results.setAttribute('aria-label', 'Content search results');
  container.append(form, status, results);
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
    void fetch(`/api/content-search?${params}`, { cache: 'no-store', signal: controller.signal })
      .then(async (response) => {
        const body = await response.json() as SearchReply & { error?: string };
        if (!response.ok) throw new Error(body.error === 'invalid_path' ? 'Enter a valid folder path inside the browsing root.' : body.error === 'not_found' ? 'Folder not found.' : 'Search failed. Please try again.');
        return body;
      })
      .then((body) => {
        if (current !== version) return;
        const count = body.matches.length;
        const limit = body.limit ? ` Partial results: ${body.limit === 'matches' ? 'match' : body.limit === 'files' ? 'file' : body.limit === 'entries' ? 'directory entry' : 'read size'} limit reached.` : '';
        status.textContent = count ? `${count} ${count === 1 ? 'match' : 'matches'} in ${body.filesScanned} files.${limit}` : `No results in ${body.filesScanned} files.${limit}`;
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
