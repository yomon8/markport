type RefreshOptions = {
  run: (request: { revision: number; foreground: boolean }) => Promise<void>;
  interval: number;
  onVisible?: () => void;
};

export function createRefreshScheduler(options: RefreshOptions) {
  let revision = 0;
  let pending = false;
  let pendingForeground = false;
  let activeForeground = false;
  let running = false;
  let disposed = false;
  let timer: ReturnType<typeof setInterval>;

  async function drain(): Promise<void> {
    running = true;
    try {
      while (pending && !disposed) {
        pending = false;
        const foreground = pendingForeground;
        pendingForeground = false;
        activeForeground = foreground;
        try { await options.run({ revision, foreground }); }
        finally { activeForeground = false; }
      }
    } finally { running = false; }
  }
  function request(foreground = true): void {
    if (disposed || (!foreground && (activeForeground || pendingForeground))) return;
    revision++;
    retry(foreground);
  }
  function retry(foreground = false, invalidate = false): void {
    if (disposed) return;
    if (invalidate) revision++;
    pending = true;
    pendingForeground ||= foreground;
    if (!running) void drain();
  }
  function setIntervalMs(ms: number): void {
    clearInterval(timer);
    if (!disposed) timer = setInterval(() => { if (!document.hidden) request(false); }, ms);
  }
  function onVisibilityChange(): void {
    if (!document.hidden && !disposed) { request(false); options.onVisible?.(); }
  }
  setIntervalMs(options.interval);
  document.addEventListener('visibilitychange', onVisibilityChange);
  return {
    get revision() { return revision; },
    request, retry,
    setInterval: setIntervalMs,
    setMode: (mode: 'watch' | 'poll') => setIntervalMs(mode === 'watch' ? 30000 : 3000),
    dispose: () => {
      disposed = true; pending = false;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    },
  };
}
