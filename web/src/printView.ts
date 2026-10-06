import printCSS from './printDocument.css?inline';
import { drawMermaid } from './mermaid';
import { drawMath } from './math';

type PrintInput = { title: string; load: (signal: AbortSignal) => Promise<string> };

async function htmlReply(response: Response, file = false): Promise<string> {
  const body = await response.json() as { html?: string; type?: string; message?: string };
  if (!response.ok) throw new Error(body.message ?? `HTTP ${response.status}`);
  if (typeof body.html !== 'string' || (file && body.type !== 'markdown')) throw new Error('Cannot print this document.');
  return body.html;
}

export function printFile(path: string): PrintInput {
  return { title: path.split('/').at(-1) ?? path, load: async (signal) => htmlReply(await fetch(`/api/file?path=${encodeURIComponent(path)}`, { cache: 'no-store', signal }), true) };
}

export function printMarkdown(markdown: string): PrintInput {
  return { title: 'pasted-markdown', load: async (signal) => htmlReply(await fetch('/api/render', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ markdown }), signal,
  })) };
}

function deadline<T>(task: Promise<T>, signal: AbortSignal, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const finish = (): void => { window.clearTimeout(timer); signal.removeEventListener('abort', abort); };
    const abort = (): void => { finish(); reject(new Error('Print view closed.')); };
    const timer = window.setTimeout(() => { finish(); reject(new Error(message)); }, 15000);
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) { abort(); return; }
    task.then((result) => { finish(); resolve(result); }, (error: unknown) => { finish(); reject(error); });
  });
}

export function createPrintView(): { open: (input: PrintInput, opener: HTMLButtonElement) => void; close: () => void } {
  const dialog = document.createElement('dialog'); dialog.id = 'print-view'; dialog.setAttribute('aria-label', 'Print view');
  dialog.innerHTML = '<div class="overlay-toolbar"><strong class="print-title"></strong><button type="button" id="print-submit" disabled>Print / Save as PDF</button><button type="button" id="print-retry" hidden>Retry</button><button type="button" id="print-close">Close ×</button></div><p class="print-status" role="status"></p><p class="print-help">Choose Save as PDF in the print dialog. Adjust paper size, orientation, and headers or footers there.</p><div class="print-document"></div>';
  document.body.append(dialog);
  const submit = dialog.querySelector<HTMLButtonElement>('#print-submit')!;
  const retry = dialog.querySelector<HTMLButtonElement>('#print-retry')!;
  const close = dialog.querySelector<HTMLButtonElement>('#print-close')!;
  const status = dialog.querySelector<HTMLElement>('.print-status')!;
  const documentHost = dialog.querySelector<HTMLElement>('.print-document')!;
  let request: AbortController | undefined;
  let opener: HTMLButtonElement | undefined;
  let input: PrintInput | undefined;
  let frame: HTMLIFrameElement | undefined;
  let html: string | undefined;

  async function prepare(): Promise<void> {
    request?.abort();
    const controller = new AbortController(); request = controller;
    const { signal } = controller;
    const current = (): boolean => !signal.aborted && dialog.open;
    submit.disabled = true; retry.hidden = true; status.textContent = 'Preparing print view…';
    documentHost.replaceChildren(); frame = undefined;
    try {
      const snapshot = input!;
      const loaded = html ?? await deadline(snapshot.load(signal), signal, 'Document loading timed out. Please retry.');
      if (!current()) return;
      html = loaded;
      const preview = document.createElement('iframe'); preview.title = 'Printable Markdown';
      preview.setAttribute('sandbox', 'allow-same-origin allow-modals');
      documentHost.append(preview); frame = preview;
      const doc = preview.contentDocument;
      if (!doc) throw new Error('Cannot open print document.');
      doc.open(); doc.write('<!doctype html><html lang="en"><head></head><body><article></article></body></html>'); doc.close();
      doc.title = snapshot.title;
      const base = doc.createElement('base'); base.href = `${location.origin}/`; doc.head.append(base);
      const style = doc.createElement('style'); style.textContent = printCSS; doc.head.append(style);
      const article = doc.querySelector<HTMLElement>('article')!; article.innerHTML = html;
      // Keep the snapshot in place while preserving link targets in the printed PDF.
      doc.addEventListener('click', (event) => {
        const link = (event.target as Element).closest?.('a[href]');
        if (link && !link.getAttribute('href')?.startsWith('#')) event.preventDefault();
      });
      doc.addEventListener('keydown', (event) => { if (event.key === 'Escape') { event.preventDefault(); dialog.close(); } });
      const hasMath = Boolean(article.querySelector('[data-math]'));
      if (hasMath) {
        const { default: css } = await import('katex/dist/katex.min.css?inline');
        if (!current()) return;
        const mathStyle = doc.createElement('style'); mathStyle.textContent = css; doc.head.append(mathStyle);
      }
      await Promise.all([drawMermaid(article, current, undefined, true), drawMath(article, current)]);
      if (!current()) return;
      article.querySelectorAll('details').forEach((details) => { details.open = true; });
      article.querySelectorAll('.diagram-actions').forEach((actions) => actions.remove());
      for (const svg of article.querySelectorAll<SVGSVGElement>('.diagram-image svg')) {
        const { width, height } = svg.viewBox.baseVal;
        if (width > 0 && height > 0) {
          svg.setAttribute('width', String(width)); svg.setAttribute('height', String(height));
        }
      }
      let warnings = article.querySelectorAll('.diagram-error, .math-error').length;
      await Promise.all([...article.querySelectorAll('img')].map(async (image) => {
        try { await deadline(image.decode(), signal, 'Image loading timed out.'); }
        catch {
          if (!current()) return;
          const note = doc.createElement('span'); note.className = 'image-error'; note.textContent = `Cannot load image: ${image.alt || image.getAttribute('src') || 'image'}`;
          image.replaceWith(note); warnings++;
        }
      }));
      // Trigger layout so the font set includes the newly inserted formulas.
      article.getBoundingClientRect();
      if (doc.fonts) await deadline(doc.fonts.ready, signal, 'Fonts could not be loaded. Please retry.');
      if (!current()) return;
      if (doc.fonts && [...doc.fonts].some((font) => font.status === 'error')) throw new Error('Fonts could not be loaded. Please retry.');
      status.textContent = warnings ? 'Ready to print. Some diagrams, formulas, or images could not be displayed; their errors are included.' : 'Ready to print.';
      submit.disabled = false;
    } catch (error) {
      if (!current()) return;
      status.textContent = error instanceof Error ? error.message : 'Cannot prepare print view. Please retry.';
      retry.hidden = false;
    }
  }
  close.addEventListener('click', () => dialog.close());
  dialog.addEventListener('keydown', (event) => event.stopPropagation());
  retry.addEventListener('click', () => { void prepare(); });
  submit.addEventListener('click', () => {
    if (submit.disabled || !frame?.contentWindow) return;
    frame.contentWindow.focus(); frame.contentWindow.print();
  });
  dialog.addEventListener('close', () => {
    request?.abort(); documentHost.replaceChildren(); frame = undefined; input = undefined; html = undefined;
    if (opener?.isConnected) opener.focus(); opener = undefined;
  });
  return {
    open(value, button) {
      input = value; opener = button; html = undefined;
      dialog.querySelector<HTMLElement>('.print-title')!.textContent = value.title;
      if (!dialog.open) dialog.showModal();
      close.focus(); void prepare();
    },
    close() { if (dialog.open) dialog.close(); },
  };
}
