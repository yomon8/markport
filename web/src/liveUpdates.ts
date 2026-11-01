export type ChangeBatch = { paths: string[]; overflow: boolean; git: boolean; created: boolean };

type LiveUpdateOptions = {
  onChange: (batch: ChangeBatch) => void;
  onModeChange: (mode: 'watch' | 'poll') => void;
};

function parse(data: unknown): unknown {
  if (typeof data !== 'string') return undefined;
  try { return JSON.parse(data) as unknown; } catch { return undefined; }
}

export function createLiveUpdates(options: LiveUpdateOptions): { dispose(): void } {
  if (typeof EventSource === 'undefined') return { dispose: () => {} };
  let source: EventSource | undefined;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let failures = 0;
  let disposed = false;

  function closeSource(): void {
    const previous = source; source = undefined;
    previous?.close();
  }
  function retryLater(): void {
    if (disposed || retryTimer !== undefined) return;
    retryTimer = setTimeout(() => { retryTimer = undefined; connect(); }, 60000);
  }
  function connect(): void {
    if (disposed) return;
    let connection: EventSource;
    try { connection = new EventSource('/api/events'); }
    catch {
      failures = Math.max(failures, 3);
      options.onModeChange('poll'); retryLater(); return;
    }
    source = connection;
    const current = (): boolean => !disposed && source === connection;
    connection.addEventListener('mode', (event: MessageEvent) => {
      if (!current()) return;
      const value = parse(event.data) as { mode?: unknown } | undefined;
      if (value?.mode === 'watch') { failures = 0; options.onModeChange('watch'); }
      else if (value?.mode === 'poll') options.onModeChange('poll');
    });
    connection.addEventListener('change', (event: MessageEvent) => {
      if (!current()) return;
      const value = parse(event.data) as Partial<ChangeBatch> | undefined;
      if (!value || !Array.isArray(value.paths) || !value.paths.every((path) => typeof path === 'string')
        || typeof value.overflow !== 'boolean' || typeof value.git !== 'boolean' || typeof value.created !== 'boolean') return;
      options.onChange(value as ChangeBatch);
    });
    connection.onerror = () => {
      if (!current()) return;
      options.onModeChange('poll'); failures++;
      if (failures >= 3) { closeSource(); retryLater(); }
    };
  }
  connect();
  return {
    dispose: () => { disposed = true; clearTimeout(retryTimer); retryTimer = undefined; closeSource(); },
  };
}
