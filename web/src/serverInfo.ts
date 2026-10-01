type ServerInfoReply = { rootPath: string; workingDirectory: string; version: string };

export class ServerInfo {
  private readonly dialog = document.createElement('dialog');
  private readonly details = document.createElement('dl');
  private readonly message = document.createElement('p');
  private readonly retry = document.createElement('button');
  private request = 0;
  private disposed = false;
  private controller: AbortController | undefined;

  constructor(private readonly button: HTMLButtonElement) {
    this.dialog.id = 'server-info-dialog'; this.dialog.setAttribute('aria-labelledby', 'server-info-heading');
    const heading = document.createElement('h2'); heading.id = 'server-info-heading'; heading.textContent = 'Server info';
    this.message.setAttribute('role', 'status');
    this.retry.type = 'button'; this.retry.textContent = 'Retry'; this.retry.hidden = true;
    this.retry.addEventListener('click', () => { void this.reloadIfOpen(); });
    const close = document.createElement('button'); close.type = 'button'; close.textContent = 'Close';
    close.addEventListener('click', () => this.dialog.close());
    const actions = document.createElement('div'); actions.className = 'server-info-actions'; actions.append(this.retry, close);
    this.dialog.append(heading, this.message, this.details, actions); document.body.append(this.dialog);
    this.dialog.addEventListener('keydown', (event) => event.stopPropagation());
    this.dialog.addEventListener('close', () => { this.cancel(); button.focus(); });
    button.addEventListener('click', () => {
      if (this.disposed || this.dialog.open) return;
      this.dialog.showModal(); close.focus(); void this.reloadIfOpen();
    });
  }

  async reloadIfOpen(): Promise<void> {
    if (this.disposed || !this.dialog.open) return;
    this.cancel();
    const request = this.request;
    const controller = new AbortController(); this.controller = controller;
    this.details.replaceChildren(); this.retry.hidden = true; this.message.textContent = 'Loading server info…';
    try {
      const response = await fetch('/api/info', { cache: 'no-store', signal: controller.signal });
      if (!response.ok) throw new Error('Cannot load server info');
      const info: unknown = await response.json();
      if (!info || typeof info !== 'object' || !('rootPath' in info) || !('workingDirectory' in info) || !('version' in info)
        || typeof info.rootPath !== 'string' || typeof info.workingDirectory !== 'string' || typeof info.version !== 'string') {
        throw new Error('Invalid server info');
      }
      if (this.disposed || !this.dialog.open || request !== this.request) return;
      this.render({ rootPath: info.rootPath, workingDirectory: info.workingDirectory, version: info.version });
      this.message.textContent = '';
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
  }
}
