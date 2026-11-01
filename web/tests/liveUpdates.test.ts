// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createLiveUpdates } from '../src/liveUpdates';
import { createRefreshScheduler } from '../src/refresh';

class FakeEventSource extends EventTarget {
  static instances: FakeEventSource[] = [];
  onerror: (() => void) | null = null;
  closed = false;
  constructor(readonly url: string) { super(); FakeEventSource.instances.push(this); }
  close(): void { this.closed = true; }
  emit(name: string, data: unknown): void { this.dispatchEvent(new MessageEvent(name, { data: JSON.stringify(data) })); }
  fail(): void { this.onerror?.(); }
}

beforeEach(() => { vi.useFakeTimers(); FakeEventSource.instances = []; vi.stubGlobal('EventSource', FakeEventSource); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

it('switches modes and delivers validated change batches', () => {
  const onChange = vi.fn(); const onModeChange = vi.fn();
  const updates = createLiveUpdates({ onChange, onModeChange });
  const source = FakeEventSource.instances[0]; expect(source.url).toBe('/api/events');
  source.emit('mode', { mode: 'watch' }); expect(onModeChange).toHaveBeenLastCalledWith('watch');
  const batch = { paths: ['docs/a.md'], overflow: false, git: true, created: false };
  source.emit('change', batch); expect(onChange).toHaveBeenCalledWith(batch);
  source.emit('change', { paths: 'invalid' }); source.emit('change', null);
  source.dispatchEvent(new MessageEvent('change', { data: 'invalid JSON' }));
  expect(onChange).toHaveBeenCalledOnce();
  source.emit('mode', { mode: 'poll' }); expect(onModeChange).toHaveBeenLastCalledWith('poll');
  updates.dispose(); expect(source.closed).toBe(true);
});

it('uses native reconnects for three failures then retries once each minute until recovery', async () => {
  const onModeChange = vi.fn();
  const updates = createLiveUpdates({ onChange: vi.fn(), onModeChange });
  const source = FakeEventSource.instances[0];
  source.fail(); source.fail(); expect(source.closed).toBe(false);
  source.fail(); expect(source.closed).toBe(true); expect(onModeChange).toHaveBeenLastCalledWith('poll');
  await vi.advanceTimersByTimeAsync(59999); expect(FakeEventSource.instances).toHaveLength(1);
  await vi.advanceTimersByTimeAsync(1); expect(FakeEventSource.instances).toHaveLength(2);
  const retry = FakeEventSource.instances[1]; retry.fail(); expect(retry.closed).toBe(true);
  await vi.advanceTimersByTimeAsync(60000); expect(FakeEventSource.instances).toHaveLength(3);
  const recovered = FakeEventSource.instances[2]; recovered.emit('mode', { mode: 'watch' });
  recovered.fail(); recovered.fail(); expect(recovered.closed).toBe(false);
  updates.dispose();
});

it('ignores late events and cancels retry timers on disposal', async () => {
  const onChange = vi.fn(); const onModeChange = vi.fn();
  const updates = createLiveUpdates({ onChange, onModeChange }); const source = FakeEventSource.instances[0];
  source.fail(); source.fail(); source.fail(); onModeChange.mockClear();
  updates.dispose(); source.emit('mode', { mode: 'watch' }); source.emit('change', { paths: [], overflow: true, git: false, created: false }); source.fail();
  await vi.advanceTimersByTimeAsync(120000);
  expect(FakeEventSource.instances).toHaveLength(1); expect(onChange).not.toHaveBeenCalled(); expect(onModeChange).not.toHaveBeenCalled();
});

it('keeps polling when EventSource is missing or its constructor fails', async () => {
  const onModeChange = vi.fn(); vi.stubGlobal('EventSource', undefined);
  createLiveUpdates({ onChange: vi.fn(), onModeChange }).dispose(); expect(onModeChange).not.toHaveBeenCalled();
  const attempts = vi.fn();
  vi.stubGlobal('EventSource', class { constructor() { attempts(); throw new Error('blocked'); } });
  const updates = createLiveUpdates({ onChange: vi.fn(), onModeChange });
  expect(onModeChange).toHaveBeenLastCalledWith('poll');
  await vi.advanceTimersByTimeAsync(60000); expect(attempts).toHaveBeenCalledTimes(2); updates.dispose();
});

it('connects pushed changes to refreshes and index invalidation, then restores three-second polling', async () => {
  const run = vi.fn().mockResolvedValue(undefined); const onIndexChange = vi.fn();
  const scheduler = createRefreshScheduler({ run, interval: 3000, onIndexChange });
  const source = FakeEventSource.instances[0]; source.emit('mode', { mode: 'watch' });
  await vi.advanceTimersByTimeAsync(29999); expect(run).toHaveBeenCalledTimes(1);
  source.emit('change', { paths: ['a.md'], overflow: false, git: true, created: false });
  await vi.advanceTimersByTimeAsync(0); expect(run).toHaveBeenCalledTimes(2); expect(onIndexChange).toHaveBeenCalledTimes(1);
  source.emit('change', { paths: ['b.md'], overflow: false, git: false, created: true });
  await vi.advanceTimersByTimeAsync(0); expect(onIndexChange).toHaveBeenCalledTimes(2);
  source.emit('change', { paths: [], overflow: true, git: false, created: false });
  await vi.advanceTimersByTimeAsync(0); expect(run).toHaveBeenCalledTimes(4); expect(onIndexChange).toHaveBeenCalledTimes(3);
  source.fail(); await vi.advanceTimersByTimeAsync(2000); source.fail();
  await vi.advanceTimersByTimeAsync(1000); expect(run).toHaveBeenCalledTimes(5);
  scheduler.dispose(); expect(source.closed).toBe(true);
  await vi.advanceTimersByTimeAsync(60000); expect(run).toHaveBeenCalledTimes(5);
});

it('retains a pushed change arriving while a foreground refresh is still loading', async () => {
  let finish: (() => void) | undefined;
  const run = vi.fn().mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; })).mockResolvedValue(undefined);
  const scheduler = createRefreshScheduler({ run, interval: 3000 });
  scheduler.request();
  FakeEventSource.instances[0].emit('change', { paths: ['a.md'], overflow: false, git: false, created: false });
  expect(scheduler.revision).toBe(1); expect(run).toHaveBeenCalledOnce();
  finish?.(); await vi.advanceTimersByTimeAsync(0);
  expect(run).toHaveBeenCalledTimes(2);
  expect(run).toHaveBeenLastCalledWith({ revision: 2, foreground: false });
  scheduler.dispose();
});

it('catches up missed changes and filenames immediately after reconnecting', async () => {
  const run = vi.fn().mockResolvedValue(undefined); const onIndexChange = vi.fn();
  const scheduler = createRefreshScheduler({ run, interval: 3000, onIndexChange });
  const source = FakeEventSource.instances[0]; source.emit('mode', { mode: 'watch' });
  await vi.advanceTimersByTimeAsync(0); expect(run).toHaveBeenCalledTimes(1);
  source.fail(); source.emit('mode', { mode: 'watch' });
  await vi.advanceTimersByTimeAsync(0); expect(run).toHaveBeenCalledTimes(2); expect(onIndexChange).toHaveBeenCalledTimes(2);
  scheduler.dispose();
});
