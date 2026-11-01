// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createRefreshScheduler } from '../src/refresh';

beforeEach(() => { vi.useFakeTimers(); vi.spyOn(document, 'hidden', 'get').mockReturnValue(false); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

it('prioritizes foreground work and serializes superseding requests', async () => {
  let finish: (() => void) | undefined;
  const run = vi.fn().mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }))
    .mockResolvedValue(undefined);
  const refresh = createRefreshScheduler({ run, interval: 3000 });
  refresh.request(); refresh.request(false);
  expect(refresh.revision).toBe(1);
  refresh.request(); refresh.request(false);
  expect(refresh.revision).toBe(2); expect(run).toHaveBeenCalledTimes(1);
  finish?.(); await vi.advanceTimersByTimeAsync(0);
  expect(run).toHaveBeenCalledTimes(2);
  expect(run).toHaveBeenLastCalledWith({ revision: 2, foreground: true });
  refresh.dispose();
});

it('switches poll intervals, skips hidden tabs, and refreshes on visibility', async () => {
  const run = vi.fn().mockResolvedValue(undefined); const onVisible = vi.fn();
  const refresh = createRefreshScheduler({ run, interval: 3000, onVisible });
  await vi.advanceTimersByTimeAsync(3000); expect(run).toHaveBeenCalledTimes(1);
  refresh.setMode('watch');
  await vi.advanceTimersByTimeAsync(29999); expect(run).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1); expect(run).toHaveBeenCalledTimes(2);
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
  await vi.advanceTimersByTimeAsync(30000); expect(run).toHaveBeenCalledTimes(2);
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
  document.dispatchEvent(new Event('visibilitychange')); await vi.advanceTimersByTimeAsync(0);
  expect(run).toHaveBeenCalledTimes(3); expect(onVisible).toHaveBeenCalledOnce();
  refresh.setMode('poll'); await vi.advanceTimersByTimeAsync(3000);
  expect(run).toHaveBeenCalledTimes(4);
  refresh.dispose(); refresh.request(); refresh.retry(); refresh.setInterval(1);
  document.dispatchEvent(new Event('visibilitychange'));
  await vi.advanceTimersByTimeAsync(60000); expect(run).toHaveBeenCalledTimes(4);
});

it('does not start queued work after disposal during an active refresh', async () => {
  let finish: (() => void) | undefined;
  const run = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
  const refresh = createRefreshScheduler({ run, interval: 3000 });
  refresh.request(); refresh.request(); refresh.dispose();
  finish?.(); await vi.advanceTimersByTimeAsync(10000);
  expect(run).toHaveBeenCalledOnce();
});
