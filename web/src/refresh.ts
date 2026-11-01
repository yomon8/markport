import { createLiveUpdates } from './liveUpdates';

type RefreshOptions = {
  run: (request: { revision: number; foreground: boolean }) => Promise<void>;
  interval: number;
  onVisible?: () => void;
  onIndexChange?: () => void;
  onModeChange?: (mode: 'watch' | 'poll') => void;
};

export function createRefreshScheduler(options: RefreshOptions) {
  let revision = 0;
  let pending = false;
  let pendingForeground = false;
  let activeForeground = false;
  let afterForeground = false;
  let running = false;
  let disposed = false;
  let timer: ReturnType<typeof setInterval>;
  let interval = options.interval;
  let liveMode: 'watch' | 'poll' = 'poll';

  async function drain(): Promise<void> {
    running = true;
    try {
      while (pending && !disposed) {
        pending = false;
        const foreground = pendingForeground;
        pendingForeground = false;
        activeForeground = foreground;
        try { await options.run({ revision, foreground }); }
        finally {
          activeForeground = false;
          if (foreground && afterForeground) {
            afterForeground = false;
            if (!pendingForeground && !disposed) { revision++; pending = true; }
          }
        }
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
    interval = ms;
    if (!disposed) timer = setInterval(() => { if (!document.hidden) request(false); }, ms);
  }
  function setMode(mode: 'watch' | 'poll'): void {
    const ms = mode === 'watch' ? 30000 : 3000;
    if (interval !== ms) setIntervalMs(ms);
    options.onModeChange?.(mode);
  }
  function onVisibilityChange(): void {
    if (!document.hidden && !disposed) { request(false); options.onVisible?.(); }
  }
  function requestPushed(): void {
    if (activeForeground && !pendingForeground) afterForeground = true;
    request(false);
  }
  setIntervalMs(options.interval);
  document.addEventListener('visibilitychange', onVisibilityChange);
  const liveUpdates = createLiveUpdates({
    onModeChange: (mode) => {
      const recovered = mode === 'watch' && liveMode !== 'watch';
      liveMode = mode; setMode(mode);
      if (recovered) { requestPushed(); options.onIndexChange?.(); }
    },
    onChange: (batch) => {
      requestPushed();
      if (batch.created || batch.overflow) options.onIndexChange?.();
    },
  });
  return {
    get revision() { return revision; },
    request, retry,
    setInterval: setIntervalMs,
    setMode,
    dispose: () => {
      disposed = true; pending = false; afterForeground = false;
      liveUpdates.dispose();
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    },
  };
}
