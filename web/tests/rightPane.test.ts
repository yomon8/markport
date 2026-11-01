// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createRightPane } from '../src/rightPane';
import { createPreview } from '../src/preview';
import { drawMermaid } from '../src/mermaid';

vi.mock('../src/mermaid', () => ({ drawMermaid: vi.fn(async () => {}) }));

beforeEach(() => {
  vi.mocked(drawMermaid).mockClear();
  history.replaceState(null, '', '/?path=left.md&right=right.md');
  document.body.innerHTML = '<div class="layout"><main></main><aside id="sidebar"></aside><section id="right-pane"><div id="right-title"><div id="right-path"></div><div class="right-actions"><span id="right-kind"></span><div id="right-views"><button id="right-rendered"></button><button id="right-source"></button></div><button id="right-interactive"></button><button id="right-copy"></button><button id="right-contents"></button><button id="right-swap"></button><button id="right-only"></button><button id="right-close"></button></div></div><article id="right-content"></article><nav id="right-outline"></nav></section></div>';
});
afterEach(() => { vi.unstubAllGlobals(); document.body.replaceChildren(); });

function setup() {
  const rightContent = document.querySelector<HTMLElement>('#right-content')!;
  const rightPane = document.querySelector<HTMLElement>('#right-pane')!;
  const selected = () => new URL(location.href).searchParams.get('path') ?? '';
  const preview = createPreview({ content: document.createElement('article'), rightContent, selected,
    navigate: vi.fn(), openRight: vi.fn(), invalidate: vi.fn(), requestRefresh: vi.fn(), refreshRight: vi.fn(), onInstance: vi.fn() });
  const setSplit = vi.fn(); const decorateContent = vi.fn();
  const controller = createRightPane({
    main: document.querySelector('main')!, layout: document.querySelector<HTMLElement>('.layout')!,
    rightPane, rightContent, sidebar: document.querySelector<HTMLElement>('#sidebar')!,
    contentWidth: { createButton: () => document.createElement('button') },
    activePane: { setSplit, select: vi.fn() }, splitResize: { setActive: vi.fn() },
    selected, selectedMode: () => 'file', getSourceMode: () => false, setSourceMode: vi.fn(),
    setSidebarPanel: vi.fn(), getRememberedBase: () => '', getGit: async <T>() => ({ available: false }) as T,
    saveScroll: vi.fn(), requestRefresh: vi.fn(), syncSelectedFile: async () => {}, preview,
    decorateContent, highlightCodeLines: vi.fn(), updateRightOutline: vi.fn(),
    downloadFile: vi.fn(), openPDF: vi.fn(), printFile: vi.fn(),
  });
  return { controller, preview, rightPane, rightContent, setSplit, decorateContent };
}

const reply = (status = 200) => ({ status, ok: true, headers: new Headers({ ETag: 'v1' }),
  json: async () => ({ path: 'right.md', type: 'markdown', html: '<h1>Right file</h1>' }),
}) as Response;

it('keeps the right document and scroll on conditional refresh', async () => {
  const fetch = vi.fn().mockResolvedValueOnce(reply()).mockResolvedValue(reply(304));
  vi.stubGlobal('fetch', fetch);
  const { controller, preview, rightContent, rightPane, decorateContent } = setup();
  await controller.refreshRight(); const heading = rightContent.querySelector('h1');
  const currentDiagram = vi.mocked(drawMermaid).mock.calls.at(-1)![1]!;
  rightPane.scrollTop = 120;
  await controller.refreshRight();
  expect(fetch.mock.calls[1][1].headers['If-None-Match']).toBe('v1');
  expect(rightContent.querySelector('h1')).toBe(heading); expect(rightPane.scrollTop).toBe(120);
  expect(decorateContent).toHaveBeenCalledOnce();
  expect(currentDiagram()).toBe(true);
  expect(document.querySelector('#right-rendered')?.getAttribute('aria-pressed')).toBe('true');
  preview.dispose();
});

it('discards a pending response when the pane closes', async () => {
  let finish: ((response: Response) => void) | undefined;
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((resolve) => { finish = resolve; })));
  const { controller, preview, rightContent, rightPane, setSplit } = setup();
  const loading = controller.refreshRight(); controller.closeRight(); finish?.(reply()); await loading;
  expect(rightPane.hidden).toBe(true); expect(rightContent.querySelector('h1')).toBeNull();
  expect(new URL(location.href).searchParams.has('right')).toBe(false);
  expect(setSplit).toHaveBeenLastCalledWith(false); preview.dispose();
});
