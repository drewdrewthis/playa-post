/**
 * One `app.outbox_events` row as a consumer receives it.
 *
 * ⚠ **Declared here rather than imported from the drainer entrypoint, permanently.**
 * The drainer (M2.14) lives in `apps/server/src/entrypoints/`, and
 * `no-domain-to-infrastructure` forbids an application service from importing an
 * entrypoint — so the envelope this module consumes is stated here, in the layer that
 * consumes it, and the drainer's own `OutboxEventRecord` is structurally compatible
 * with it. Reconciled at the wiring point by
 * `composition/outbox-consumer.adapter.ts`, which is the one place allowed to see both
 * declarations; never by a second definition of the fields.
 *
 * The fields are ADR-0006's envelope minus the delivery bookkeeping (`status`,
 * `attempts`, `available_at`, `claimed_by`), which belongs to whoever is draining and
 * is none of a consumer's business — which is why the drainer's record is a strict
 * superset of this and passing one where the other is expected needs no conversion.
 */
export interface OutboxEventRow {
  readonly eventId: string;
  /** Past tense (addendum §20). What a consumer routes on. */
  readonly eventType: string;
  /** When the fact happened, **not** when it was delivered. */
  readonly occurredAt: Date;
  /** Who caused it, or `null` for a system-originated event. */
  readonly actorId: string | null;
  readonly aggregateId: string;
  /**
   * Identifiers and routing data only (ADR-0006).
   *
   * Typed as an open record rather than a union of every event's payload: a consumer
   * that pattern-matched on a closed union would have to be edited every time another
   * module published a new event, which is the coupling the outbox exists to remove.
   * Each consumer narrows the payload it actually subscribes to.
   */
  readonly payload: Record<string, unknown>;
}

/**
 * A consumer of the transactional outbox.
 *
 * **Every implementation writes its `app.consumer_receipts` row in the same
 * transaction as its own effect, and treats a unique violation as "already processed →
 * skip"** (ADR-0006). That is what makes at-least-once delivery safe without any
 * bespoke dedup logic, and it is the whole of M2-AC8.
 *
 * `handle` is called for events this consumer may not care about — the drainer routes
 * by nothing more than "here is an event" — so an implementation returns without effect
 * for an `eventType` it does not subscribe to, rather than throwing. Throwing would
 * push an irrelevant event through the retry-and-dead-letter path (ADR-0006, M2-AC23).
 */
export interface OutboxConsumer {
  /**
   * The name written into `app.consumer_receipts.consumer_name`.
   *
   * Named by behaviour (ADR-0006: `SendGroupedPushHandler`, `EvaluateNotifyMeHandler`)
   * and **stable**: renaming it makes every past receipt invisible, and every already
   * processed event is then reprocessed once.
   *
   * The drainer's own port spells this `consumerName`; that one-word difference is the
   * only thing `composition/outbox-consumer.adapter.ts` translates.
   */
  readonly name: string;

  /** Process one delivery. Idempotent, by receipt. */
  handle(event: OutboxEventRow): Promise<void>;
}
