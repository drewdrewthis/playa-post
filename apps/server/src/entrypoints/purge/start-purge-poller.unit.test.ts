import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PurgeRoundResult, SoftDeletedRowPurge } from './purge-soft-deleted-rows';
import { startPurgePoller } from './start-purge-poller';

const INTERVAL_MS = 1_000;

const CUTOFF = new Date('2026-07-13T12:00:00.000Z');

/** A round that removed nothing — the steady state of a healthy deployment. */
const SWEPT_NOTHING: PurgeRoundResult = {
  purged: [
    { name: 'removed bulletins', deletedBefore: CUTOFF, rows: 0 },
    { name: 'deleted saved views', deletedBefore: CUTOFF, rows: 0 },
  ],
  totalRows: 0,
};

/** A round that actually removed something — the only kind worth a log line. */
const SWEPT_SOMETHING: PurgeRoundResult = {
  purged: [
    { name: 'removed bulletins', deletedBefore: CUTOFF, rows: 8 },
    { name: 'deleted saved views', deletedBefore: CUTOFF, rows: 4 },
  ],
  totalRows: 12,
};

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
 * The retention sweep's scheduler (issue #169).
 *
 * The three pollers in `entrypoints/` share a scheduling shape deliberately
 * (`start-notification-flush-poller.ts`'s own docstring), so this suite exercises the
 * same cases as its siblings plus the one respect in which the purge differs: it reports
 * what a round removed, and only when a round removed something.
 */
describe('startPurgePoller', () => {
  describe('given a sweep that resolves immediately', () => {
    it('does not sweep before intervalMs elapses', async () => {
      const purgeOnce = vi
        .fn<SoftDeletedRowPurge['purgeOnce']>()
        .mockResolvedValue(SWEPT_NOTHING);
      const poller = startPurgePoller({ purge: { purgeOnce }, intervalMs: INTERVAL_MS });

      await vi.advanceTimersByTimeAsync(INTERVAL_MS - 1);

      expect(purgeOnce).not.toHaveBeenCalled();

      await poller.stop();
    });

    it('sweeps once after intervalMs elapses', async () => {
      const purgeOnce = vi
        .fn<SoftDeletedRowPurge['purgeOnce']>()
        .mockResolvedValue(SWEPT_NOTHING);
      const poller = startPurgePoller({ purge: { purgeOnce }, intervalMs: INTERVAL_MS });

      await vi.advanceTimersByTimeAsync(INTERVAL_MS);

      expect(purgeOnce).toHaveBeenCalledTimes(1);

      await poller.stop();
    });

    it('sweeps again after each subsequent interval', async () => {
      const purgeOnce = vi
        .fn<SoftDeletedRowPurge['purgeOnce']>()
        .mockResolvedValue(SWEPT_NOTHING);
      const poller = startPurgePoller({ purge: { purgeOnce }, intervalMs: INTERVAL_MS });

      await vi.advanceTimersByTimeAsync(INTERVAL_MS);
      await vi.advanceTimersByTimeAsync(INTERVAL_MS);

      expect(purgeOnce).toHaveBeenCalledTimes(2);

      await poller.stop();
    });
  });

  describe('given a sweep whose round is still in flight', () => {
    it('does not start a second round, across several elapsed intervals', async () => {
      // A first sweep against a deployment that has never had one can be slow, and a
      // second round underneath it would contend for the same rows and delete nothing
      // extra. A recursive-setTimeout scheduler never queues the next timer; a
      // setInterval one would have swept again by now.
      const deferred = createDeferred<PurgeRoundResult>();
      const purgeOnce = vi
        .fn<SoftDeletedRowPurge['purgeOnce']>()
        .mockReturnValue(deferred.promise);
      const poller = startPurgePoller({ purge: { purgeOnce }, intervalMs: INTERVAL_MS });

      await vi.advanceTimersByTimeAsync(INTERVAL_MS);
      expect(purgeOnce).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(INTERVAL_MS * 3);
      expect(purgeOnce).toHaveBeenCalledTimes(1);

      deferred.resolve(SWEPT_NOTHING);
      await vi.advanceTimersByTimeAsync(0);

      await vi.advanceTimersByTimeAsync(INTERVAL_MS);
      expect(purgeOnce).toHaveBeenCalledTimes(2);

      await poller.stop();
    });
  });

  describe('given a sweep whose round rejects', () => {
    it('reports the rejection via onError and keeps sweeping on the next interval', async () => {
      // The property that makes "a failing target ends the round" affordable: the loop
      // does not end with it, so the next hour's sweep tries again.
      const error = new Error('retention sweep failed');
      const purgeOnce = vi
        .fn<SoftDeletedRowPurge['purgeOnce']>()
        .mockRejectedValueOnce(error)
        .mockResolvedValue(SWEPT_NOTHING);
      const onError = vi.fn();
      const poller = startPurgePoller({
        purge: { purgeOnce },
        intervalMs: INTERVAL_MS,
        onError,
      });

      await vi.advanceTimersByTimeAsync(INTERVAL_MS);
      expect(onError).toHaveBeenCalledWith(error);

      await vi.advanceTimersByTimeAsync(INTERVAL_MS);
      expect(purgeOnce).toHaveBeenCalledTimes(2);

      await poller.stop();
    });

    it('reports nothing purged when the round never produced a result', async () => {
      const purgeOnce = vi
        .fn<SoftDeletedRowPurge['purgeOnce']>()
        .mockRejectedValue(new Error('retention sweep failed'));
      const onPurged = vi.fn();
      const poller = startPurgePoller({
        purge: { purgeOnce },
        intervalMs: INTERVAL_MS,
        onError: () => undefined,
        onPurged,
      });

      await vi.advanceTimersByTimeAsync(INTERVAL_MS);

      expect(onPurged).not.toHaveBeenCalled();

      await poller.stop();
    });
  });

  describe('reporting what a round removed', () => {
    it('reports a round that removed rows, with its counts', async () => {
      const purgeOnce = vi
        .fn<SoftDeletedRowPurge['purgeOnce']>()
        .mockResolvedValue(SWEPT_SOMETHING);
      const onPurged = vi.fn();
      const poller = startPurgePoller({ purge: { purgeOnce }, intervalMs: INTERVAL_MS, onPurged });

      await vi.advanceTimersByTimeAsync(INTERVAL_MS);

      expect(onPurged).toHaveBeenCalledWith(SWEPT_SOMETHING);

      await poller.stop();
    });

    it('stays silent on a round that removed nothing', async () => {
      // The steady state is "nothing is old enough yet". Reporting every round would be
      // an hourly line reading zero, which trains a reader to skip exactly the line that
      // matters on the day it is not zero.
      const purgeOnce = vi
        .fn<SoftDeletedRowPurge['purgeOnce']>()
        .mockResolvedValue(SWEPT_NOTHING);
      const onPurged = vi.fn();
      const poller = startPurgePoller({ purge: { purgeOnce }, intervalMs: INTERVAL_MS, onPurged });

      await vi.advanceTimersByTimeAsync(INTERVAL_MS * 3);

      expect(purgeOnce).toHaveBeenCalledTimes(3);
      expect(onPurged).not.toHaveBeenCalled();

      await poller.stop();
    });

    it('does not call an observer a failed round never produced a result for', async () => {
      const purgeOnce = vi
        .fn<SoftDeletedRowPurge['purgeOnce']>()
        .mockRejectedValue(new Error('connection terminated'));
      const onPurged = vi.fn();
      const onError = vi.fn();
      const poller = startPurgePoller({
        purge: { purgeOnce },
        intervalMs: INTERVAL_MS,
        onPurged,
        onError,
      });

      await vi.advanceTimersByTimeAsync(INTERVAL_MS);

      expect(onError).toHaveBeenCalledTimes(1);
      expect(onPurged).not.toHaveBeenCalled();

      await poller.stop();
    });

    it('survives an observer that throws, and does not call it a failed round', async () => {
      // `onPurged` runs outside the round it describes. Routing its failure into `onError`
      // would log a failed sweep for a round that deleted every row it meant to; letting
      // it propagate would reject the in-flight promise `stop()` awaits, turning a clean
      // shutdown into a crash. So it is swallowed — and the loop keeps its interval.
      const purgeOnce = vi
        .fn<SoftDeletedRowPurge['purgeOnce']>()
        .mockResolvedValue(SWEPT_SOMETHING);
      const onError = vi.fn();
      const onPurged = vi.fn(() => {
        throw new Error('log transport closed');
      });
      const poller = startPurgePoller({
        purge: { purgeOnce },
        intervalMs: INTERVAL_MS,
        onPurged,
        onError,
      });

      await vi.advanceTimersByTimeAsync(INTERVAL_MS * 2);

      expect(onPurged).toHaveBeenCalledTimes(2);
      expect(onError).not.toHaveBeenCalled();
      expect(purgeOnce).toHaveBeenCalledTimes(2);

      // And shutdown still resolves rather than rejecting with the observer's error.
      await expect(poller.stop()).resolves.toBeUndefined();
    });
  });

  describe('given `now`', () => {
    it('advances per round rather than being captured once at start-up', async () => {
      // `now` is what the retention cutoff is derived from, so a captured reading would
      // freeze the window on the first round and stop sweeping anything new for the life
      // of the process.
      const purgeOnce = vi
        .fn<SoftDeletedRowPurge['purgeOnce']>()
        .mockResolvedValue(SWEPT_NOTHING);
      const poller = startPurgePoller({ purge: { purgeOnce }, intervalMs: INTERVAL_MS });

      await vi.advanceTimersByTimeAsync(INTERVAL_MS);
      await vi.advanceTimersByTimeAsync(INTERVAL_MS);

      const firstNow = purgeOnce.mock.calls[0]?.[0]?.now;
      const secondNow = purgeOnce.mock.calls[1]?.[0]?.now;

      expect(firstNow).toBeInstanceOf(Date);
      expect(secondNow).toBeInstanceOf(Date);
      expect(secondNow?.getTime()).toBeGreaterThan(firstNow?.getTime() ?? 0);

      await poller.stop();
    });
  });

  describe('stop()', () => {
    it('clears the pending timer, so time advancing afterward adds no sweeps', async () => {
      const purgeOnce = vi
        .fn<SoftDeletedRowPurge['purgeOnce']>()
        .mockResolvedValue(SWEPT_NOTHING);
      const poller = startPurgePoller({ purge: { purgeOnce }, intervalMs: INTERVAL_MS });

      await poller.stop();
      await vi.advanceTimersByTimeAsync(INTERVAL_MS * 5);

      expect(purgeOnce).not.toHaveBeenCalled();
    });

    it('does not resolve while a round is in flight, and resolves once it settles', async () => {
      // What makes the shutdown order in `main.ts` safe: the pool is disposed only after
      // an in-flight `DELETE` has finished with it.
      const deferred = createDeferred<PurgeRoundResult>();
      const purgeOnce = vi
        .fn<SoftDeletedRowPurge['purgeOnce']>()
        .mockReturnValue(deferred.promise);
      const poller = startPurgePoller({ purge: { purgeOnce }, intervalMs: INTERVAL_MS });

      await vi.advanceTimersByTimeAsync(INTERVAL_MS);
      expect(purgeOnce).toHaveBeenCalledTimes(1);

      let settled = false;
      const stopPromise = poller.stop().then(() => {
        settled = true;
      });

      await Promise.resolve();
      await Promise.resolve();
      expect(settled).toBe(false);

      deferred.resolve(SWEPT_NOTHING);
      await stopPromise;

      expect(settled).toBe(true);
    });
  });
});
