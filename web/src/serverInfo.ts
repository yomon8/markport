import { editingShortcutTarget, matchesShortcut } from './shortcuts';

type InstanceInfo = { rootPath: string; version: string; url: string; current: boolean; unavailableReason?: string };
type ServerInfoReply = { rootPath: string; workingDirectory: string; version: string; instances?: InstanceInfo[]; instancesError?: string };

function isInstance(value: unknown): value is InstanceInfo {
  if (!value || typeof value !== 'object' || !('rootPath' in value) || typeof value.rootPath !== 'string'
    || !('version' in value) || typeof value.version !== 'string' || !('current' in value) || typeof value.current !== 'boolean'
    || !('url' in value) || typeof value.url !== 'string'
    || ('unavailableReason' in value && typeof value.unavailableReason !== 'string')) return false;
  if (value.url === '') return 'unavailableReason' in value && typeof value.unavailableReason === 'string';
  try {
    const url = new URL(value.url);
    return url.protocol === 'http:' && !url.username && !url.password && url.pathname === '/' && !url.search && !url.hash
      && (url.hostname === 'localhost' || /^(?:\d{1,3}\.){3}\d{1,3}$/.test(url.hostname));
  } catch { return false; }
}

export class ServerInfo {
  private readonly dialog = document.createElement('dialog');
  private readonly details = document.createElement('dl');
  private readonly message = document.createElement('p');
  private readonly retry = document.createElement('button');
  private readonly close = document.createElement('button');
  private readonly refresh = document.createElement('button');
  private readonly servers = document.createElement('section');
  private readonly list = document.createElement('ul');
  private readonly listMessage = document.createElement('p');
  private focusVersion = 0;
  private request = 0;
  private disposed = false;
  private controller: AbortController | undefined;

  constructor(private readonly button: HTMLButtonElement) {
    this.dialog.id = 'server-info-dialog'; this.dialog.setAttribute('aria-labelledby', 'server-info-heading');
    const heading = document.createElement('h2'); heading.id = 'server-info-heading'; heading.textContent = 'Server info';
    this.message.setAttribute('role', 'status');
    this.retry.type = 'button'; this.retry.textContent = 'Retry'; this.retry.hidden = true;
    this.retry.addEventListener('click', () => { void this.reloadIfOpen(); });
    const close = this.close; close.type = 'button'; close.textContent = 'Close';
    close.addEventListener('click', () => this.dialog.close());
    this.refresh.type = 'button'; this.refresh.textContent = 'Refresh'; this.refresh.hidden = true;
    this.refresh.addEventListener('click', () => { void this.reloadIfOpen(); });
    const serversHeading = document.createElement('h3'); serversHeading.textContent = 'Running Markport servers';
    this.servers.className = 'server-info-servers'; this.servers.setAttribute('aria-label', 'Running Markport servers');
    this.listMessage.setAttribute('role', 'status');
    this.servers.append(serversHeading, this.listMessage, this.list); this.servers.hidden = true;
    const actions = document.createElement('div'); actions.className = 'server-info-actions'; actions.append(this.refresh, this.retry, close);
    this.dialog.append(heading, this.message, this.details, this.servers, actions); document.body.append(this.dialog);
    this.dialog.addEventListener('focusin', () => { this.focusVersion++; });
    this.dialog.addEventListener('keydown', (event) => {
      event.stopPropagation();
      if (editingShortcutTarget(event.target)) return;
      const down = matchesShortcut(event, 'serverNext');
      if (!down && !matchesShortcut(event, 'serverPrevious')) return;
      const links = [...this.list.querySelectorAll('a')];
      if (!links.length) return;
      event.preventDefault();
      const index = links.findIndex((link) => link === document.activeElement);
      const next = index < 0 ? (down ? 0 : links.length - 1) : Math.max(0, Math.min(links.length - 1, index + (down ? 1 : -1)));
      links[next].focus();
    });
    this.dialog.addEventListener('close', () => { this.cancel(); button.focus(); });
    button.addEventListener('click', () => this.open());
  }

  open(): void {
    if (this.disposed || this.dialog.open) return;
    this.dialog.showModal(); this.close.focus(); void this.reloadIfOpen(true);
  }

  async reloadIfOpen(focusFirst = false): Promise<void> {
    if (this.disposed || !this.dialog.open) return;
    const active = document.activeElement;
    const selectedURL = active instanceof HTMLAnchorElement && this.list.contains(active) ? active.href : undefined;
    const action = active === this.refresh ? this.refresh : active === this.retry ? this.retry : undefined;
    if (selectedURL || action) this.close.focus();
    const focusVersion = this.focusVersion;
    this.cancel();
    const request = this.request;
    const controller = new AbortController(); this.controller = controller;
    this.details.replaceChildren(); this.list.replaceChildren(); this.servers.hidden = true; this.refresh.hidden = true; this.retry.hidden = true; this.message.textContent = 'Loading server info…';
    try {
      const response = await fetch('/api/info', { cache: 'no-store', signal: controller.signal });
      if (!response.ok) throw new Error('Cannot load server info');
      const info: unknown = await response.json();
      if (!info || typeof info !== 'object' || !('rootPath' in info) || !('workingDirectory' in info) || !('version' in info)
        || typeof info.rootPath !== 'string' || typeof info.workingDirectory !== 'string' || typeof info.version !== 'string') {
        throw new Error('Invalid server info');
      }
      if (this.disposed || !this.dialog.open || request !== this.request) return;
      const instances = 'instances' in info && Array.isArray(info.instances) && info.instances.every(isInstance) ? info.instances : undefined;
      const instancesError = 'instancesError' in info && typeof info.instancesError === 'string' ? info.instancesError : undefined;
      this.render({ rootPath: info.rootPath, workingDirectory: info.workingDirectory, version: info.version, instances, instancesError });
      this.refresh.hidden = false;
      this.message.textContent = '';
      if (focusVersion === this.focusVersion && document.activeElement === this.close) {
        const links = [...this.list.querySelectorAll('a')];
        if (focusFirst || selectedURL) (links.find((link) => link.href === selectedURL) ?? links[0] ?? this.close).focus();
        else if (action && !action.hidden) action.focus();
      }
    } catch {
      if (this.disposed || !this.dialog.open || request !== this.request) return;
      this.message.textContent = 'Cannot load server info. Please try again.'; this.retry.hidden = false;
    }
  }

  dispose(): void { this.disposed = true; this.cancel(); }

  private cancel(): void { this.request++; this.controller?.abort(); this.controller = undefined; }

  private render(info: ServerInfoReply): void {
    for (const [label, value] of [
      ['Browsing directory', info.rootPath],
      ['Working directory at startup', info.workingDirectory],
      ['Markport version', info.version],
      ['Connection URL', location.origin],
    ]) {
      const term = document.createElement('dt'); term.textContent = label;
      const description = document.createElement('dd'); description.textContent = value;
      this.details.append(term, description);
    }
    this.servers.hidden = false;
    this.listMessage.textContent = info.instancesError ?? (info.instances ? '' : 'Server discovery is unavailable.');
    this.retry.hidden = !info.instancesError;
    for (const instance of info.instances ?? []) {
      const row = document.createElement('li');
      const name = document.createElement(instance.url ? 'a' : 'span'); name.textContent = instance.rootPath;
      if (name instanceof HTMLAnchorElement) name.href = instance.url;
      const details = document.createElement('span'); details.className = 'server-info-instance-details';
      details.textContent = [instance.url || instance.unavailableReason, instance.version, instance.current ? 'Current' : ''].filter(Boolean).join(' · ');
      row.append(name, details); this.list.append(row);
    }
  }
}
