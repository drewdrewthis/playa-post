/**
 * How often the grouping-window flush runs.
 *
 * ADR-0006 lists "notification grouping window flush" as scheduled work without naming
 * a cadence, so this is chosen rather than quoted. Ten seconds is an order of magnitude
 * below the 60-second grouping window, which is the property that matters: the *window*
 * has to be what decides when a notification is sent, and a poll interval near 60
 * seconds would let a closed window wait almost as long again as it took to fill —
 * doubling the observed latency of a rule the product states in seconds. It is also
 * five times the drainer's own 2-second interval (ADR-0006:65), because one indexed
 * sweep of `status='pending'` `NotifyMeMatched` rows buys nothing by running faster
 * than the window it is waiting on.
 */
const DEFAULT_FLUSH_INTERVAL_MS = 10_000;

/**
 * The one thing this poller drives, declared here rather than imported.
 *
 * Structurally satisfied by `modules/notifications`'
 * `SendGroupedPushHandler`, and deliberately narrower than it: an entrypoint that named
 * that type would know which module it is scheduling, which is the coupling
 * `entrypoints/**` exists to not have — the same reason
 * `start-outbox-drainer-poller.ts` types against `OutboxDrainer` rather than against
 * any consumer's concrete class.
 */
export interface NotificationFlusher {
  /** Deliver every grouping window that has fully elapsed as of `now`. */
  flush(command: { readonly now: Date }): Promise<void>;
}

export interface StartNotificationFlushPollerOptions {
  readonly flusher: NotificationFlusher;
  /** Overridable for tests. Omitted → {@link DEFAULT_FLUSH_INTERVAL_MS}. */
  readonly intervalMs?: number;
  /**
   * Reported when a flush round rejects — the pending-match query or a push transport
   * failing. Omitted → the failure is swallowed and polling continues on the next
   * interval regardless.
   */
  readonly onError?: (error: unknown) => void;
}

/** What {@link startNotificationFlushPoller} hands back. */
export interface NotificationFlushPoller {
  /**
   * Stop scheduling further flushes and wait for any in-flight `flush()` to settle.
   * Resolves once it is safe to dispose the database pool the flush writes through —
   * always the caller's next step.
   */
  stop(): Promise<void>;
}

/**
 * Start the in-process grouping-window flush loop (ADR-0006 §"Scheduled (cron) work",
 * plan M2.11).
 *
 * **A second poller beside `start-outbox-drainer-poller.ts`, not a second drainer.**
 * The flush is driven by a clock rather than by an event — "has this 60-second window
 * elapsed" is the only question it asks — so it cannot be a consumer the drainer
 * dispatches to, and the rows it reads are excluded from the drainer's claim query for
 * that reason (`modules/notifications`' `SELF_DRAINED_EVENT_TYPES`, passed through the
 * composition root). The two loops are independent: neither waits on the other, and
 * either can be stopped first.
 *
 * The scheduling shape is deliberately the one
 * {@link import('../outbox-drainer/start-outbox-drainer-poller').startOutboxDrainerPoller}
 * established — **recursive `setTimeout`, so a round can never overlap itself**, and
 * every round caught internally so one failure does not end the loop. Overlap matters
 * more here than there: the flush claims a window by inserting its receipts, so two
 * concurrent rounds would not double-send (`completeWindow` returns early when another
 * flush already claimed the rows), but they would contend on the same rows for no
 * throughput gain, and a slow round pushing the next one later is the behaviour worth
 * having in a single-instance process.
 *
 * Not extracted into a shared helper with the drainer's poller: the two differ in what
 * they call and in nothing else today, and a `startPoller(fn)` abstraction over two
 * call sites would remove fifteen lines while making both loops' failure semantics
 * indirect. Revisit at the third.
 */
export function startNotificationFlushPoller(
  options: StartNotificationFlushPollerOptions,
): NotificationFlushPoller {
  const { flusher, onError } = options;
  const intervalMs = options.intervalMs ?? DEFAULT_FLUSH_INTERVAL_MS;

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
      // Read at dispatch time rather than once at start-up: `now` is what decides which
      // windows have elapsed, so a captured clock would freeze the flush on the first
      // round's view of the world and never deliver anything again.
      await flusher.flush({ now: new Date() });
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
