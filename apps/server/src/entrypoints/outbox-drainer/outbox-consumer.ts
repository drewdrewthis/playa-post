import type { OutboxEventRecord } from './outbox-event';

/**
 * One event-family handler the outbox drainer dispatches claimed events to
 * (ADR-0006 §"Consumers").
 *
 * `consumerName` is the `app.consumer_receipts.consumer_name` this handler writes
 * under — stable, because a rename orphans every receipt already written under the
 * old name. A consumer owns its own idempotency: it inserts its receipt in the same
 * transaction as its effect, and treats a unique-violation on that receipt as
 * "already processed, skip" (ADR-0006). The drainer itself does not deduplicate —
 * that would be a second, competing idempotency mechanism.
 *
 * The drainer offers every claimed event to every registered consumer; ADR-0006 §5's
 * "one consumer per event family" describes how consumers are authored (each cares
 * about a specific family and is a no-op otherwise), not a filter the drainer applies
 * on their behalf.
 */
export interface OutboxConsumer {
  readonly consumerName: string;
  /**
   * Process one claimed event.
   *
   * @throws on any failure. The drainer catches it, applies backoff or dead-letters
   *   the row, and retries — a consumer never has to implement its own retry loop.
   */
  handle(event: OutboxEventRecord): Promise<void>;
}
