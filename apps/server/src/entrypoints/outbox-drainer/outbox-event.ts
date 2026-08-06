/**
 * The envelope of a claimed `app.outbox_events` row (ADR-0006 §"Schema"), as handed to
 * every registered {@link import('./outbox-consumer').OutboxConsumer}.
 *
 * Owned by the outbox-drainer entrypoint (`apps/server/src/entrypoints/`, not a
 * module — m2-lane-briefs.md §L3b-infra). A consumer that needs this shape imports it
 * as a type only, from its own `persistence/` layer — never from a module's `domain/`
 * or `application/`, which `no-domain-to-infrastructure` forbids from depending on
 * `entrypoints/**` at all.
 *
 * `payload` carries only what ADR-0006 allows a consumer to route on — identifiers and
 * the minimum needed to dispatch, never bulletin content or contact details. A consumer
 * that needs more re-reads it through its own module's authorized read path.
 */
export interface OutboxEventRecord {
  /** `app.outbox_events.event_id`. */
  readonly eventId: string;
  /** `app.outbox_events.event_type` — past tense (addendum §20), e.g. `'ConnectionAccepted'`. */
  readonly eventType: string;
  /** `app.outbox_events.occurred_at` — when the underlying fact happened. */
  readonly occurredAt: Date;
  /** `app.outbox_events.actor_id`. `null` for a system-originated event. */
  readonly actorId: string | null;
  /** `app.outbox_events.aggregate_id`. */
  readonly aggregateId: string;
  /** `app.outbox_events.payload`. Identifiers and routing data only (ADR-0006). */
  readonly payload: Record<string, unknown>;
  /** `app.outbox_events.attempts`, **after** the claim that produced this record. */
  readonly attempts: number;
}
