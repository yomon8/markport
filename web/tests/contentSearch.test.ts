// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

beforeEach(() => { vi.resetModules(); localStorage.clear(); document.body.replaceChildren(); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

async function mount() {
  const container = document.createElement('details'); document.body.append(container);
  const navigate = vi.fn();
  const { initContentSearch } = await import('../src/contentSearch');
  initContentSearch(container, navigate);
  return { container, navigate };
}
function input(container: HTMLElement, id: string, value: string): void {
  const field = container.querySelector<HTMLInputElement>(`#content-${id}`)!;
  field.value = value; field.dispatchEvent(new Event('input'));
}
const response = (body: unknown, ok = true) => ({ ok, json: async () => body }) as Response;

it('sends all options and navigates to a matching source line', async () => {
  const fetch = vi.fn().mockResolvedValue(response({
    matches: [{ path: 'docs/a.md', line: 3, before: 'before', text: 'match', after: 'after' }],
    filesScanned: 2, ignoredSkipped: 4,
  }));
  vi.stubGlobal('fetch', fetch);
  const { container, navigate } = await mount();
  input(container, 'query', 'bug-\\d+'); input(container, 'folder', 'docs');
  input(container, 'include', '*.md, docs/**'); input(container, 'exclude', '*.lock');
  for (const id of ['case', 'word', 'regex']) container.querySelector<HTMLButtonElement>(`#content-${id}`)!.click();
  container.querySelector<HTMLInputElement>('#content-ignored')!.click();
  container.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
  await vi.waitFor(() => expect(container.querySelector('.content-search-results a')).not.toBeNull());
  const params = new URL(fetch.mock.calls[0][0], location.href).searchParams;
  expect(Object.fromEntries(params)).toEqual({ q: 'bug-\\d+', folder: 'docs', case: '1', word: '1', regex: '1', ignored: '1', include: '*.md, docs/**', exclude: '*.lock' });
  expect(container.querySelector('[role=status]')?.textContent).toContain('4 ignored files skipped');
  container.querySelector<HTMLAnchorElement>('.content-search-results a')!.click();
  expect(navigate).toHaveBeenCalledOnce();
  const target = new URL(navigate.mock.calls[0][0]);
  expect(target.searchParams.get('source')).toBe('1'); expect(target.hash).toBe('#L3');
});

it('persists and restores options with accessible toggle state', async () => {
  const { container } = await mount();
  container.querySelector<HTMLButtonElement>('#content-case')!.click();
  input(container, 'include', '*.go');
  const { container: restored } = await mount();
  expect(restored.querySelector('#content-case')?.getAttribute('aria-pressed')).toBe('true');
  expect(restored.querySelector('#content-word')?.getAttribute('aria-pressed')).toBe('false');
  expect(restored.querySelector<HTMLInputElement>('#content-include')?.value).toBe('*.go');
  expect(JSON.parse(localStorage.getItem('markport-content-search-options')!)).toMatchObject({ caseSensitive: true, include: '*.go' });
});

it('retains options in the tab when storage is unavailable', async () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('unavailable'); });
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('unavailable'); });
  const { container } = await mount();
  container.querySelector<HTMLButtonElement>('#content-regex')!.click(); input(container, 'exclude', '*.log');
  const { container: restored } = await mount();
  expect(restored.querySelector('#content-regex')?.getAttribute('aria-pressed')).toBe('true');
  expect(restored.querySelector<HTMLInputElement>('#content-exclude')?.value).toBe('*.log');
});

it('displays invalid-query messages and restores the submit button', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({ error: 'invalid_query', message: 'error parsing regexp: missing closing ]' }, false)));
  const { container } = await mount(); input(container, 'query', '[');
  container.querySelector<HTMLButtonElement>('#content-regex')!.click();
  container.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
  await vi.waitFor(() => expect(container.querySelector('[role=status]')?.textContent).toContain('missing closing ]'));
  expect(container.querySelector<HTMLButtonElement>('button[type=submit]')?.disabled).toBe(false);
});
