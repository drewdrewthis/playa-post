import type { PurgeRoundResult, SoftDeletedRowPurge } from './purge-soft-deleted-rows';

/**
 * How often the retention sweep runs.
 *
 * **Hourly, and deliberately not configurable.** The thing an operator has a policy about
 * is how long deleted data survives, and that is `PURGE_RETENTION_DAYS`; the interval
 * only decides how far past the window a row may linger before it goes. An hour is three
 * orders of magnitude below the shortest legal window (one day), so the observable
 * behaviour is "gone after the window" at every setting — which is what makes a second
 * knob here a knob with no distinct settings.
 *
 * Far longer than either sibling loop's interval (the drainer's 2 seconds, the flush's
 * 10) because nothing waits on this one: no user-visible latency depends on a removed
 * bulletin's row going at 14:00 rather than 15:00, and each round is two `DELETE`s over
 * indexed predicates that match nothing in the steady state.
 */
const DEFAULT_PURGE_INTERVAL_MS = 60 * 60 * 1000;

export interface StartPurgePollerOptions {
  readonly purge: SoftDeletedRowPurge;
  /** Overridable for tests. Omitted → {@link DEFAULT_PURGE_INTERVAL_MS}. */
  readonly intervalMs?: number;
  /**
   * Reported when a round rejects — a target's `DELETE` failing, or the pool being
   * unreachable. Omitted → the failure is swallowed and the sweep runs again on the next
   * interval regardless.
   */
  readonly onError?: (error: unknown) => void;
  /**
   * Reported after a round that **removed at least one row**, so an operator has evidence
   * the sweep is running and what it took.
   *
   * ⚠ **Only when something went, and that condition is the whole point of the callback.**
   * The steady state of a healthy deployment is "nothing is old enough yet", so a report
   * every round would be an hourly line saying zero — noise that trains a reader to skip
   * exactly the line that matters on the day it is not zero. Omitted → counts are
   * discarded and the sweep is silent either way.
   */
  readonly onPurged?: (result: PurgeRoundResult) => void;
}

/** What {@link startPurgePoller} hands back. */
export interface PurgePoller {
  /**
   * Stop scheduling further sweeps and wait for any in-flight round to settle. Resolves
   * once it is safe to dispose the database pool the sweep deletes through — always the
   * caller's next step.
   */
  stop(): Promise<void>;
}

/**
 * Start the in-process retention sweep (issue #169; ADR-0006 §"Scheduled (cron) work",
 * which lists retention chores as scheduled work without naming a cadence).
 *
 * **A third poller beside `start-outbox-drainer-poller.ts` and
 * `start-notification-flush-poller.ts`, on the same scheduling shape** — recursive
 * `setTimeout` so a round can never overlap itself, every round caught internally so one
 * failure does not end the loop. Overlap matters here for the plainest reason of the
 * three: a first sweep against a deployment that has never had one may take a while, and
 * a second round starting underneath it would contend for the same rows and delete
 * nothing extra.
 *
 * Still not extracted into a shared helper with the other two. They now differ in what
 * they call and in nothing else, which is the third call site
 * `start-notification-flush-poller.ts` said to revisit at — and revisiting it is a change
 * to three loops' failure semantics that belongs in its own commit, not smuggled in with
 * the feature that made them three.
 *
 * Unconditional, unlike the flush: there is no configuration under which a retention
 * sweep has nothing it could do, and a deployment that skipped it would accumulate
 * deleted rows silently forever — the exact failure #169 exists to end.
 */
export function startPurgePoller(options: StartPurgePollerOptions): PurgePoller {
  const { purge, onError, onPurged } = options;
  const intervalMs = options.intervalMs ?? DEFAULT_PURGE_INTERVAL_MS;

  let stopped = false;
  let timer: NodeJS.Timeout | undefined;
  let inFlight: Promise<void> = Promise.resolve();

  function scheduleNext(): void {
    timer = setTimeout(() => {
      inFlight = tick();
    }, intervalMs);
  }

  async function tick(): Promise<void> {
    try {
      // Read at dispatch time rather than once at start-up: `now` is what the retention
      // cutoff is derived from, so a captured clock would freeze the window on the first
      // round's view of the world and stop sweeping anything new for the life of the
      // process.
      const result = await purge.purgeOnce({ now: new Date() });

      if (result.totalRows > 0) {
        onPurged?.(result);
      }
    } catch (error) {
      onError?.(error);
    } finally {
      // Re-checked after the `await` above, not just at the top of `tick`: `stop()` may
      // have run *while* this round was in flight, and the whole point of that path is
      // that no further round gets scheduled once it has.
      if (!stopped) {
        scheduleNext();
      }
    }
  }

  scheduleNext();

  return {
    async stop(): Promise<void> {
      stopped = true;
      if (timer !== undefined) {
        clearTimeout(timer);
      }
      await inFlight;
    },
  };
}
