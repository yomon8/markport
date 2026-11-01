type PreviewableFile = { assetUrl: string } | { previewUrl: string; type: string } | { html: string };
type PreviewOptions = {
  content: HTMLElement;
  rightContent: HTMLElement;
  selected: (pane: 'left' | 'right') => string;
  navigate: (url: string) => void;
  openRight: (path: string) => void;
  invalidate: () => void;
  requestRefresh: () => void;
  refreshRight: () => void;
  onInstance: () => void;
};

export function createPreview(deps: PreviewOptions) {
  const { content, rightContent } = deps;
  let previewReload = 0;
  let previewInstance = '';
  const interactivePaths = new Set<string>();
  function previewStorageKey(): string { return `markport-interactive-preview:${previewInstance}`; }
  function syncPreviewInstance(instance: string): void {
    if (!instance || instance === previewInstance) return;
    previewInstance = instance; interactivePaths.clear();
    deps.onInstance();
    try {
      const saved = JSON.parse(sessionStorage.getItem(previewStorageKey()) ?? '[]') as unknown;
      if (Array.isArray(saved)) for (const path of saved) if (typeof path === 'string') interactivePaths.add(path);
    } catch { /* Storage may be unavailable. */ }
    deps.invalidate();
    if (deps.selected('right')) deps.refreshRight();
  }
  function setInteractive(path: string, enabled: boolean): void {
    if (enabled) interactivePaths.add(path); else interactivePaths.delete(path);
    try { if (previewInstance) sessionStorage.setItem(previewStorageKey(), JSON.stringify([...interactivePaths])); } catch { /* Storage may be unavailable. */ }
    deps.invalidate();
    deps.requestRefresh();
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
  function createPDFFrame(url: string, path: string): HTMLIFrameElement {
    const frame = document.createElement('iframe'); frame.className = 'pdf-preview'; frame.title = `PDF preview of ${path}`;
    frame.referrerPolicy = 'no-referrer'; frame.src = `${url}&reload=${previewReload}`;
    return frame;
  }
  function filePreviewKey(file: PreviewableFile, path: string): string {
    if ('assetUrl' in file) return file.assetUrl;
    if ('previewUrl' in file) return file.type === 'pdf' ? `${file.previewUrl}&reload=${previewReload}` : previewURL(file.previewUrl, path);
    return file.html;
  }
  function attachPreviewNavigation(frame: HTMLIFrameElement, path: string, pane: 'left' | 'right' = 'left'): void {
    if (isInteractive(path)) return;
    frame.addEventListener('load', () => {
      if (!frame.isConnected || deps.selected(pane) !== path) return;
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
            if (pane === 'right') deps.openRight(next); else deps.navigate(`/?path=${encodeURIComponent(next)}${url.hash}`);
          } catch { /* Invalid URL encoding. */ }
        } else if (url.protocol === 'http:' || url.protocol === 'https:') {
          event.preventDefault(); window.open(url.href, '_blank', 'noopener,noreferrer');
        }
      });
    });
  }
  function onMessage(event: MessageEvent): void {
    if (event.origin !== 'null' || !event.data || typeof event.data.markportPreviewLink !== 'string') return;
    const leftFrame = content.querySelector<HTMLIFrameElement>('.html-preview');
    const rightFrame = rightContent.querySelector<HTMLIFrameElement>('.html-preview');
    const pane = event.source === leftFrame?.contentWindow ? 'left' : event.source === rightFrame?.contentWindow ? 'right' : null;
    if (!pane || !isInteractive(deps.selected(pane))) return;
    let url: URL;
    try { url = new URL(event.data.markportPreviewLink); } catch { return; }
    const interactivePrefix = `/api/interactive/${previewInstance}/`;
    if (url.origin === location.origin && url.pathname.startsWith(interactivePrefix)) {
      let next: string;
      try { next = decodeURIComponent(url.pathname.slice(interactivePrefix.length)); } catch { return; }
      if (!next || next.split('/').some((part) => !part || part === '.' || part === '..')) return;
      if (pane === 'right') deps.openRight(next); else deps.navigate(`/?path=${encodeURIComponent(next)}${url.hash}`);
    } else if (url.protocol === 'http:' || url.protocol === 'https:') {
      window.open(url.href, '_blank', 'noopener,noreferrer');
    }
  }
  window.addEventListener('message', onMessage);
  return {
    syncPreviewInstance, setInteractive, isInteractive, createPreviewFrame, createPDFFrame, filePreviewKey,
    hasInteractive: (path: string) => interactivePaths.has(path),
    reload: () => { previewReload++; },
    dispose: () => window.removeEventListener('message', onMessage),
  };
}
