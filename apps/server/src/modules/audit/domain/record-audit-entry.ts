/**
 * The slice of an outbox event's envelope {@link toAuditEntry} reads (ADR-0002 Q4).
 *
 * Structurally compatible with `entrypoints/outbox-drainer/outbox-event.ts`'s
 * `OutboxEventRecord` — the drainer hands that shape to every consumer — but defined
 * locally rather than imported: `modules/<name>/domain/` may not depend on
 * `entrypoints/**` (`no-domain-to-infrastructure`, `.dependency-cruiser.cjs`), and the
 * domain owning its own input port is the correct direction of dependency regardless.
 *
 * Deliberately has **no `payload` field.** `toAuditEntry` must never read it, and the
 * cheapest way to guarantee that is for the type it accepts to have nowhere for
 * `payload` to be read from, even by a future edit — the mapping cannot leak what it
 * has no field to name.
 */
export interface AuditableOutboxEvent {
  readonly eventId: string;
  readonly eventType: string;
  readonly occurredAt: Date;
  readonly actorId: string | null;
  readonly aggregateId: string;
}

/**
 * One `app.audit_entries` row, in domain shape (plan M2.15, ADR-0002 Q4).
 *
 * Internal IDs only, matching the table's own column set exactly — there is no field
 * here capable of holding bulletin content or contact data.
 */
export interface AuditEntry {
  readonly eventType: string;
  readonly occurredAt: Date;
  readonly actorId: string | null;
  readonly aggregateId: string;
  /** The outbox event this entry was recorded from — not a freshly-minted ID. */
  readonly sourceEventId: string;
}

/**
 * Map an outbox event's envelope to the audit entry recorded from it.
 *
 * Pure — the unit-level half of "internal IDs only, no bulletin content, no contact
 * data" (ADR-0002 Q4). `record-audit-entry-handler.integration.test.ts` covers the
 * transactional write into `app.audit_entries`; this covers the shape of what gets
 * written, independent of Postgres. `event`'s `payload` is never read, whatever it
 * contains — see {@link AuditableOutboxEvent}.
 */
export function toAuditEntry(event: AuditableOutboxEvent): AuditEntry {
  return {
    eventType: event.eventType,
    occurredAt: event.occurredAt,
    actorId: event.actorId,
    aggregateId: event.aggregateId,
    sourceEventId: event.eventId,
  };
}
