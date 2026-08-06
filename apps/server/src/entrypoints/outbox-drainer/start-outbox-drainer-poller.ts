import type { OutboxDrainer } from './outbox-drainer';

/** ADR-0006: "an in-process poller on a 2-second interval, same query, same handlers". */
const DEFAULT_POLL_INTERVAL_MS = 2_000;

export interface StartOutboxDrainerPollerOptions {
  readonly drainer: OutboxDrainer;
  /** Overridable for tests. Omitted → {@link DEFAULT_POLL_INTERVAL_MS}. */
  readonly intervalMs?: number;
  /**
   * Reported when a round rejects — the claim query itself failing (a database blip),
   * never a single consumer's failure, which `drainOnce()` already turns into a
   * retry/backoff write on the row and never throws for. Omitted → the failure is
   * swallowed and polling continues on the next interval regardless.
   */
  readonly onError?: (error: unknown) => void;
}

/** What {@link startOutboxDrainerPoller} hands back. */
export interface OutboxDrainerPoller {
  /**
   * Stop scheduling further rounds and wait for any in-flight `drainOnce()` to settle.
   * Resolves once it is safe to dispose the database pool the drainer reads through —
   * always the caller's next step.
   */
  stop(): Promise<void>;
}

/**
 * Start the in-process outbox-drainer poll loop (ADR-0006, m2-lane-briefs.md
 * §L3b-infra: "in-process on the Node server … no cron variant, no second service").
 * Called once from `entrypoints/http/main.ts`'s own startup sequence — there is no
 * separate drainer process to start it from.
 *
 * **Recursive `setTimeout`, not `setInterval` — deliberately, so one round can never
 * overlap itself.** The next round is scheduled only after the current `drainOnce()`
 * settles. `drainOnce()`'s own `FOR UPDATE SKIP LOCKED` claim already makes concurrent
 * calls *safe* — that is exactly what M2-AC24 proves, across separate drainer
 * instances — but safe is not the same as *useful*: this process has no second
 * instance to divide work with, so letting its own loop overlap itself would only add
 * concurrent load on the same connection pool the HTTP server's own queries share,
 * for no throughput gain. Backpressure — a slow round simply pushes the next one
 * later rather than piling a second one on top of it — is the better default for a
 * single in-process poller.
 *
 * Every round is caught internally, so a rejected `drainOnce()` never stops the loop —
 * a background poller that gives up forever after one transient database blip is
 * worse than one that keeps trying on the next interval.
 */
export function startOutboxDrainerPoller(
  options: StartOutboxDrainerPollerOptions,
): OutboxDrainerPoller {
  const { drainer, onError } = options;
  const intervalMs = options.intervalMs ?? DEFAULT_POLL_INTERVAL_MS;

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
      await drainer.drainOnce();
    } catch (error) {
      onError?.(error);
    } finally {
      // Re-checked after the `await` above, not just at the top of `tick`: `stop()`
      // may have run *while* this round was in flight, and the whole point of that
      // path is that no further round gets scheduled once it has.
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
        // A no-op if `timer` already fired (the in-flight round below is what that
        // case needs to wait on, not this call) — clearing a consumed timeout id is
        // harmless, and guarding it would only add a branch that never changes
        // behavior.
        clearTimeout(timer);
      }
      await inFlight;
    },
  };
}
