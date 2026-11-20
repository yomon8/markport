import { fileView, type FileView } from './fileGit';
import type { SidebarTab } from './shortcuts';

export type AppMode = FileView | 'changes' | 'paste' | 'history';

export function selectedPath(href = location.href): string {
  return new URL(href).searchParams.get('path') ?? '';
}

export function selectedBase(href = location.href): string {
  return new URL(href).searchParams.get('base') ?? '';
}

export function selectedMode(href = location.href): AppMode {
  const url = new URL(href);
  const view = url.searchParams.get('view');
  if (view === 'history' || view === 'paste' || view === 'changes') return view;
  return url.searchParams.get('path') ? fileView(url, 'left') : 'file';
}

export function sidebarPanelForMode(mode: AppMode): SidebarTab {
  return mode === 'history' ? 'history' : mode === 'changes' || mode === 'diff' ? 'changes' : 'file';
}

export function fileURL(path: string): string {
  return `/?path=${encodeURIComponent(path)}`;
}

export function pdfFileURL(path: string): string {
  return `/api/pdf?path=${encodeURIComponent(path)}`;
}

export function isLineHash(hash: string): boolean {
  return /^#L\d+(?:-L\d+)?$/.test(hash);
}

export function buildNavigationTarget(url: string, currentHref = location.href): URL {
  const previous = new URL(currentHref);
  const target = new URL(url, previous);
  const right = previous.searchParams.get('right');
  if (right && target.searchParams.has('path') && !['history', 'changes', 'paste'].includes(target.searchParams.get('view') ?? '')) {
    target.searchParams.set('right', right);
    for (const [key, value] of previous.searchParams) {
      if (key.startsWith('right-') && !target.searchParams.has(key)) target.searchParams.set(key, value);
    }
  }
  return target;
}

export function classifyInAppLink(
  link: HTMLAnchorElement,
  currentLocation: Pick<Location, 'origin' | 'pathname' | 'search'> = location,
): 'navigate' | 'hash' | 'ignore' {
  if (link.origin !== currentLocation.origin || link.pathname !== '/') return 'ignore';
  const parsed = new URL(link.href);
  if (!(parsed.searchParams.has('path') || ['history', 'changes'].includes(parsed.searchParams.get('view') ?? ''))) return 'ignore';
  if (link.pathname === currentLocation.pathname && link.search === currentLocation.search && link.hash) return 'hash';
  return 'navigate';
}
