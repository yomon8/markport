import type { ChangesReply } from './diff';

export class ReviewState {
  private rootId = '';
  private reviewed: Record<string, string> = Object.create(null) as Record<string, string>;

  sync(reply: ChangesReply): boolean {
    if (!reply.available || !reply.rootId) return false;
    let changed = false;
    if (this.rootId !== reply.rootId) {
      this.rootId = reply.rootId;
      this.reviewed = Object.create(null) as Record<string, string>;
      try {
        const stored: unknown = JSON.parse(localStorage.getItem(this.key()) ?? '{}');
        if (stored && typeof stored === 'object' && !Array.isArray(stored)) {
          for (const [path, revision] of Object.entries(stored)) if (typeof revision === 'string') this.reviewed[path] = revision;
        }
      } catch { /* Ignore invalid saved state. */ }
      changed = true;
    }
    const current = new Map(reply.changes.map((change) => [change.path, change.revision]));
    for (const [path, revision] of Object.entries(this.reviewed)) {
      if (!revision || current.get(path) !== revision) { delete this.reviewed[path]; changed = true; }
    }
    if (changed) this.save();
    return changed;
  }

  has(path: string, revision: string): boolean { return !!revision && this.reviewed[path] === revision; }

  set(path: string, revision: string, reviewed: boolean): void {
    if (!this.rootId || !revision) return;
    if (reviewed) this.reviewed[path] = revision;
    else delete this.reviewed[path];
    this.save();
  }

  private key(): string { return `markport-reviewed:${this.rootId}`; }
  private save(): void { try { localStorage.setItem(this.key(), JSON.stringify(this.reviewed)); } catch { /* Browsing still works without storage. */ } }
}
