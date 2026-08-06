import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DrainOnceResult, OutboxDrainer } from './outbox-drainer';
import { startOutboxDrainerPoller } from './start-outbox-drainer-poller';

const INTERVAL_MS = 1_000;
const EMPTY_RESULT: DrainOnceResult = { claimedEventIds: [] };

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

describe('startOutboxDrainerPoller', () => {
  describe('given a drainer that resolves immediately', () => {
    it('does not call drainOnce before intervalMs elapses', async () => {
      const drainOnce = vi.fn<OutboxDrainer['drainOnce']>().mockResolvedValue(EMPTY_RESULT);
      const poller = startOutboxDrainerPoller({ drainer: { drainOnce }, intervalMs: INTERVAL_MS });

      await vi.advanceTimersByTimeAsync(INTERVAL_MS - 1);

      expect(drainOnce).not.toHaveBeenCalled();

      await poller.stop();
    });

    it('calls drainOnce once after intervalMs elapses', async () => {
      const drainOnce = vi.fn<OutboxDrainer['drainOnce']>().mockResolvedValue(EMPTY_RESULT);
      const poller = startOutboxDrainerPoller({ drainer: { drainOnce }, intervalMs: INTERVAL_MS });

      await vi.advanceTimersByTimeAsync(INTERVAL_MS);

      expect(drainOnce).toHaveBeenCalledTimes(1);

      await poller.stop();
    });

    it('calls drainOnce again after each subsequent interval', async () => {
      const drainOnce = vi.fn<OutboxDrainer['drainOnce']>().mockResolvedValue(EMPTY_RESULT);
      const poller = startOutboxDrainerPoller({ drainer: { drainOnce }, intervalMs: INTERVAL_MS });

      await vi.advanceTimersByTimeAsync(INTERVAL_MS);
      await vi.advanceTimersByTimeAsync(INTERVAL_MS);

      expect(drainOnce).toHaveBeenCalledTimes(2);

      await poller.stop();
    });
  });

  describe('given a drainer whose round is still pending', () => {
    it('does not start a second round while the first is in flight, across several elapsed intervals', async () => {
      const deferred = createDeferred<DrainOnceResult>();
      const drainOnce = vi.fn<OutboxDrainer['drainOnce']>().mockReturnValue(deferred.promise);
      const poller = startOutboxDrainerPoller({ drainer: { drainOnce }, intervalMs: INTERVAL_MS });

      // Fires the first round; drainOnce's promise stays pending.
      await vi.advanceTimersByTimeAsync(INTERVAL_MS);
      expect(drainOnce).toHaveBeenCalledTimes(1);

      // Several more intervals elapse while the round is still unsettled. A
      // recursive-setTimeout scheduler never queued a next timer, so nothing fires;
      // a setInterval scheduler would have called drainOnce again by now.
      await vi.advanceTimersByTimeAsync(INTERVAL_MS * 3);
      expect(drainOnce).toHaveBeenCalledTimes(1);

      deferred.resolve(EMPTY_RESULT);
      await vi.advanceTimersByTimeAsync(0);

      // Only now, after the first round settles, is the next round scheduled.
      await vi.advanceTimersByTimeAsync(INTERVAL_MS);
      expect(drainOnce).toHaveBeenCalledTimes(2);

      await poller.stop();
    });
  });

  describe('given a drainer whose round rejects', () => {
    it('reports the rejection via onError and continues polling on the next interval', async () => {
      const error = new Error('claim query failed');
      const drainOnce = vi
        .fn<OutboxDrainer['drainOnce']>()
        .mockRejectedValueOnce(error)
        .mockResolvedValue(EMPTY_RESULT);
      const onError = vi.fn();
      const poller = startOutboxDrainerPoller({
        drainer: { drainOnce },
        intervalMs: INTERVAL_MS,
        onError,
      });

      await vi.advanceTimersByTimeAsync(INTERVAL_MS);
      expect(onError).toHaveBeenCalledWith(error);

      await vi.advanceTimersByTimeAsync(INTERVAL_MS);
      expect(drainOnce).toHaveBeenCalledTimes(2);

      await poller.stop();
    });
  });

  describe('stop()', () => {
    it('clears the pending timer, so time advancing afterward adds no calls', async () => {
      const drainOnce = vi.fn<OutboxDrainer['drainOnce']>().mockResolvedValue(EMPTY_RESULT);
      const poller = startOutboxDrainerPoller({ drainer: { drainOnce }, intervalMs: INTERVAL_MS });

      await poller.stop();
      await vi.advanceTimersByTimeAsync(INTERVAL_MS * 5);

      expect(drainOnce).not.toHaveBeenCalled();
    });

    it('does not resolve while a drainOnce round is in flight, and resolves once it settles', async () => {
      const deferred = createDeferred<DrainOnceResult>();
      const drainOnce = vi.fn<OutboxDrainer['drainOnce']>().mockReturnValue(deferred.promise);
      const poller = startOutboxDrainerPoller({ drainer: { drainOnce }, intervalMs: INTERVAL_MS });

      await vi.advanceTimersByTimeAsync(INTERVAL_MS);
      expect(drainOnce).toHaveBeenCalledTimes(1);

      let settled = false;
      const stopPromise = poller.stop().then(() => {
        settled = true;
      });

      await Promise.resolve();
      await Promise.resolve();
      expect(settled).toBe(false);

      deferred.resolve(EMPTY_RESULT);
      await stopPromise;

      expect(settled).toBe(true);
    });
  });
});
