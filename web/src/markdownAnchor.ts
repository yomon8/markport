export function findMarkdownAnchor(root: HTMLElement, hash: string): HTMLElement | null {
  if (!hash.startsWith('#') || hash.length === 1) return null;
  let id: string;
  try { id = CSS.escape(decodeURIComponent(hash.slice(1))); } catch { return null; }
  const marker = root.querySelector<HTMLElement>(`[data-markdown-anchor="${id}"]`);
  if (!marker) return null;
  return root.querySelector<HTMLElement>(`:is(h1, h2, h3, h4, h5, h6)[id="${id}"]`) ?? marker;
}
