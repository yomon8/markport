type Config = { title: string; rootId: string };

export class TabTitle {
  private config: Config | undefined;
  private override = '';
  private fallback = 'markport';
  private request = 0;
  private disposed = false;
  private readonly dialog = document.createElement('dialog');
  private readonly input = document.createElement('input');
  private readonly save = document.createElement('button');
  private readonly reset = document.createElement('button');
  private readonly message = document.createElement('p');
  private readonly hint = document.createElement('p');
  private readonly storageChanged = (event: StorageEvent): void => {
    if (!this.config || (event.key !== null && event.key !== this.key())) return;
    this.readOverride(); this.apply();
  };

  constructor(private readonly button: HTMLButtonElement) {
    this.dialog.id = 'tab-title-dialog'; this.dialog.setAttribute('aria-labelledby', 'tab-title-heading');
    const heading = document.createElement('h2'); heading.id = 'tab-title-heading'; heading.textContent = 'Tab title';
    const form = document.createElement('form');
    const label = document.createElement('label'); label.htmlFor = 'tab-title-input'; label.textContent = 'Browser tab title';
    this.input.id = 'tab-title-input'; this.input.type = 'text'; this.input.autocomplete = 'off';
    this.input.setAttribute('aria-describedby', 'tab-title-hint');
    this.hint.id = 'tab-title-hint';
    this.message.setAttribute('role', 'status');
    this.save.type = 'submit'; this.save.textContent = 'Save';
    this.reset.type = 'button'; this.reset.textContent = 'Reset';
    const cancel = document.createElement('button'); cancel.type = 'button'; cancel.textContent = 'Cancel';
    const actions = document.createElement('div'); actions.className = 'tab-title-actions'; actions.append(this.save, cancel, this.reset);
    form.append(label, this.input, this.hint, this.message, actions); this.dialog.append(heading, form); document.body.append(this.dialog);
    form.addEventListener('submit', (event) => { event.preventDefault(); this.store(this.input.value.trim()); });
    this.reset.addEventListener('click', () => this.store(''));
    cancel.addEventListener('click', () => this.dialog.close());
    this.dialog.addEventListener('keydown', (event) => event.stopPropagation());
    this.dialog.addEventListener('close', () => button.focus());
    button.addEventListener('click', () => {
      if (this.dialog.open) return;
      this.message.textContent = ''; this.updateControls(); this.dialog.showModal();
      if (this.config) this.input.focus(); else { cancel.focus(); void this.reload(); }
    });
    window.addEventListener('storage', this.storageChanged);
    this.apply();
  }

  setFallback(title: string): void { this.fallback = title; this.apply(); }

  async reload(invalidate = false): Promise<void> {
    const request = ++this.request;
    if (invalidate) { this.config = undefined; this.override = ''; this.apply(); }
    this.updateControls();
    try {
      const response = await fetch('/api/config', { cache: 'no-store' });
      if (!response.ok) throw new Error('Cannot load settings');
      const config = await response.json() as Config;
      if (typeof config.title !== 'string' || typeof config.rootId !== 'string' || !/^[a-f0-9]{64}$/.test(config.rootId)) throw new Error('Invalid settings');
      if (this.disposed || request !== this.request) return;
      const changed = config.rootId !== this.config?.rootId;
      this.config = config;
      if (changed) this.readOverride();
      this.message.textContent = ''; this.apply(); this.updateControls();
      if (this.dialog.open) this.input.focus();
    } catch {
      if (this.disposed || request !== this.request) return;
      this.message.textContent = 'Cannot load title settings. Close and reopen to retry.';
      this.updateControls();
    }
  }

  dispose(): void { this.disposed = true; this.request++; window.removeEventListener('storage', this.storageChanged); }

  private key(): string { return `markport-tab-title:${this.config!.rootId}`; }
  private readOverride(): void {
    try { this.override = localStorage.getItem(this.key())?.trim() ?? ''; }
    catch { this.override = ''; }
  }
  private apply(): void { document.title = this.override || this.config?.title || this.fallback; }
  private updateControls(): void {
    this.input.disabled = this.save.disabled = this.reset.disabled = !this.config;
    this.input.value = this.override;
    this.input.placeholder = this.config?.title || 'Use the current file or screen name';
    this.hint.textContent = 'Saved in this browser for this folder and connection. Leave blank or reset to use the startup title, or the current file or screen name when no startup title is set.';
  }
  private store(value: string): void {
    if (!this.config) return;
    this.override = value; this.apply();
    try {
      if (value) localStorage.setItem(this.key(), value); else localStorage.removeItem(this.key());
      this.dialog.close();
    } catch {
      this.message.textContent = 'Applied to this tab, but could not save in this browser.';
    }
  }
}
