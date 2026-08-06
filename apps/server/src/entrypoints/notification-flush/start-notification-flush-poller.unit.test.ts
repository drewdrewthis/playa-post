import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  startNotificationFlushPoller,
  type NotificationFlusher,
} from './start-notification-flush-poller';

const INTERVAL_MS = 1_000;

/** A promise this test controls the settlement of, to prove overlap and shutdown ordering. */
function createDeferred<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (reason: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

/**
 * Mirrors the merged `start-outbox-drainer-poller.unit.test.ts`'s style (origin/main,
 * `apps/server/src/entrypoints/outbox-drainer/`) — the two pollers share a scheduling
 * shape deliberately (`start-notification-flush-poller.ts`'s own docstring), so this
 * suite exercises the same cases plus the one respect in which the flush differs: `now`
 * is read per round rather than captured once at start-up.
 */
describe('startNotificationFlushPoller', () => {
  describe('given a flusher that resolves immediately', () => {
    it('does not call flush before intervalMs elapses', async () => {
      const flush = vi.fn<NotificationFlusher['flush']>().mockResolvedValue(undefined);
      const poller = startNotificationFlushPoller({ flusher: { flush }, intervalMs: INTERVAL_MS });

      await vi.advanceTimersByTimeAsync(INTERVAL_MS - 1);

      expect(flush).not.toHaveBeenCalled();

      await poller.stop();
    });

    it('calls flush once after intervalMs elapses', async () => {
      const flush = vi.fn<NotificationFlusher['flush']>().mockResolvedValue(undefined);
      const poller = startNotificationFlushPoller({ flusher: { flush }, intervalMs: INTERVAL_MS });

      await vi.advanceTimersByTimeAsync(INTERVAL_MS);

      expect(flush).toHaveBeenCalledTimes(1);

      await poller.stop();
    });

    it('calls flush again after each subsequent interval', async () => {
      const flush = vi.fn<NotificationFlusher['flush']>().mockResolvedValue(undefined);
      const poller = startNotificationFlushPoller({ flusher: { flush }, intervalMs: INTERVAL_MS });

      await vi.advanceTimersByTimeAsync(INTERVAL_MS);
      await vi.advanceTimersByTimeAsync(INTERVAL_MS);

      expect(flush).toHaveBeenCalledTimes(2);

      await poller.stop();
    });
  });

  describe('given a flusher whose round is still pending', () => {
    it('does not start a second round while the first is in flight, across several elapsed intervals', async () => {
      const deferred = createDeferred<void>();
      const flush = vi.fn<NotificationFlusher['flush']>().mockReturnValue(deferred.promise);
      const poller = startNotificationFlushPoller({ flusher: { flush }, intervalMs: INTERVAL_MS });

      await vi.advanceTimersByTimeAsync(INTERVAL_MS);
      expect(flush).toHaveBeenCalledTimes(1);

      // Several more intervals elapse while the round is still unsettled. A
      // recursive-setTimeout scheduler never queued a next timer, so nothing fires;
      // a setInterval scheduler would have called flush again by now.
      await vi.advanceTimersByTimeAsync(INTERVAL_MS * 3);
      expect(flush).toHaveBeenCalledTimes(1);

      deferred.resolve();
      await vi.advanceTimersByTimeAsync(0);

      // Only now, after the first round settles, is the next round scheduled.
      await vi.advanceTimersByTimeAsync(INTERVAL_MS);
      expect(flush).toHaveBeenCalledTimes(2);

      await poller.stop();
    });
  });

  describe('given a flusher whose round rejects', () => {
    it('reports the rejection via onError and continues polling on the next interval', async () => {
      const error = new Error('grouping-window flush failed');
      const flush = vi
        .fn<NotificationFlusher['flush']>()
        .mockRejectedValueOnce(error)
        .mockResolvedValue(undefined);
      const onError = vi.fn();
      const poller = startNotificationFlushPoller({
        flusher: { flush },
        intervalMs: INTERVAL_MS,
        onError,
      });

      await vi.advanceTimersByTimeAsync(INTERVAL_MS);
      expect(onError).toHaveBeenCalledWith(error);

      await vi.advanceTimersByTimeAsync(INTERVAL_MS);
      expect(flush).toHaveBeenCalledTimes(2);

      await poller.stop();
    });
  });

  describe('given `now`', () => {
    it('advances per round rather than being captured once at start-up', async () => {
      const flush = vi.fn<NotificationFlusher['flush']>().mockResolvedValue(undefined);
      const poller = startNotificationFlushPoller({ flusher: { flush }, intervalMs: INTERVAL_MS });

      await vi.advanceTimersByTimeAsync(INTERVAL_MS);
      await vi.advanceTimersByTimeAsync(INTERVAL_MS);

      const firstNow = flush.mock.calls[0]?.[0]?.now;
      const secondNow = flush.mock.calls[1]?.[0]?.now;

      expect(firstNow).toBeInstanceOf(Date);
      expect(secondNow).toBeInstanceOf(Date);
      expect(secondNow?.getTime()).toBeGreaterThan(firstNow?.getTime() ?? 0);

      await poller.stop();
    });
  });

  describe('stop()', () => {
    it('clears the pending timer, so time advancing afterward adds no calls', async () => {
      const flush = vi.fn<NotificationFlusher['flush']>().mockResolvedValue(undefined);
      const poller = startNotificationFlushPoller({ flusher: { flush }, intervalMs: INTERVAL_MS });

      await poller.stop();
      await vi.advanceTimersByTimeAsync(INTERVAL_MS * 5);

      expect(flush).not.toHaveBeenCalled();
    });

    it('does not resolve while a flush round is in flight, and resolves once it settles', async () => {
      const deferred = createDeferred<void>();
      const flush = vi.fn<NotificationFlusher['flush']>().mockReturnValue(deferred.promise);
      const poller = startNotificationFlushPoller({ flusher: { flush }, intervalMs: INTERVAL_MS });

      await vi.advanceTimersByTimeAsync(INTERVAL_MS);
      expect(flush).toHaveBeenCalledTimes(1);

      let settled = false;
      const stopPromise = poller.stop().then(() => {
        settled = true;
      });

      await Promise.resolve();
      await Promise.resolve();
      expect(settled).toBe(false);

      deferred.resolve();
      await stopPromise;

      expect(settled).toBe(true);
    });
  });
});
