type Binding = { key: string; mod?: boolean };
export type ShortcutId = 'search' | 'sidebar' | 'help' | 'close' | 'nextChange' | 'previousChange' | 'reviewNext' | 'treeNext' | 'treePrevious' | 'treeFirst' | 'treeLast' | 'treeOpen' | 'treeClear' | 'tabSwitch' | 'tabFirst' | 'tabLast';
type Shortcut = { id: ShortcutId; description: string; group: string; bindings: Binding[] };

export const shortcuts: Shortcut[] = [
  { id: 'search', description: 'Search files', group: 'General', bindings: [{ key: '/' }, { key: 'k', mod: true }] },
  { id: 'sidebar', description: 'Toggle file list', group: 'General', bindings: [{ key: 'b', mod: true }] },
  { id: 'help', description: 'Show keyboard shortcuts', group: 'General', bindings: [{ key: '?' }] },
  { id: 'close', description: 'Close a dialog or menu', group: 'General', bindings: [{ key: 'Escape' }] },
  { id: 'nextChange', description: 'Next changed file', group: 'Git review', bindings: [{ key: 'n' }] },
  { id: 'previousChange', description: 'Previous changed file', group: 'Git review', bindings: [{ key: 'p' }] },
  { id: 'reviewNext', description: 'Mark reviewed and open next unreviewed', group: 'Git review', bindings: [{ key: 'r' }] },
  { id: 'treeNext', description: 'Next file or folder', group: 'File tree', bindings: [{ key: 'ArrowDown' }] },
  { id: 'treePrevious', description: 'Previous file or folder', group: 'File tree', bindings: [{ key: 'ArrowUp' }] },
  { id: 'treeFirst', description: 'First file or folder', group: 'File tree', bindings: [{ key: 'Home' }] },
  { id: 'treeLast', description: 'Last file or folder', group: 'File tree', bindings: [{ key: 'End' }] },
  { id: 'treeOpen', description: 'Open selected file or folder', group: 'File tree', bindings: [{ key: 'Enter' }] },
  { id: 'treeClear', description: 'Clear file search', group: 'File tree', bindings: [{ key: 'Escape' }] },
  { id: 'tabSwitch', description: 'Switch Files and Changes tabs', group: 'Sidebar tabs', bindings: [{ key: 'ArrowLeft' }, { key: 'ArrowRight' }] },
  { id: 'tabFirst', description: 'Select Files tab', group: 'Sidebar tabs', bindings: [{ key: 'Home' }] },
  { id: 'tabLast', description: 'Select Changes tab', group: 'Sidebar tabs', bindings: [{ key: 'End' }] },
];

export function onMac(): boolean { return /Mac|iPhone|iPad/.test(navigator.platform); }

export function shortcutText(id: ShortcutId): string {
  const shortcut = shortcuts.find((entry) => entry.id === id)!;
  const names: Record<string, string> = { ArrowDown: '↓', ArrowUp: '↑', ArrowLeft: '←', ArrowRight: '→', Escape: 'Esc' };
  return shortcut.bindings.map((binding) => {
    const key = names[binding.key] ?? (binding.mod ? binding.key.toUpperCase() : binding.key);
    return binding.mod ? `${onMac() ? '⌘' : 'Ctrl+'}${key}` : key;
  }).join(' or ');
}

export function matchesShortcut(event: KeyboardEvent, id: ShortcutId): boolean {
  if (event.isComposing || event.keyCode === 229 || event.altKey) return false;
  const shortcut = shortcuts.find((entry) => entry.id === id)!;
  return shortcut.bindings.some((binding) => {
    if (binding.mod ? !(event.ctrlKey || event.metaKey) : event.ctrlKey || event.metaKey) return false;
    if (event.shiftKey && binding.key !== '?') return false;
    return event.key.toLowerCase() === binding.key.toLowerCase();
  });
}

export function editingShortcutTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || target.closest('input, textarea, [contenteditable]') !== null);
}
