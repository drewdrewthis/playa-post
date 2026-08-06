import type { DatabaseConnection } from '@playa-post/database';

import type { OutboxConsumer } from '../../../entrypoints/outbox-drainer/outbox-consumer';
import type { OutboxEventRecord } from '../../../entrypoints/outbox-drainer/outbox-event';
import { toAuditEntry } from '../domain/record-audit-entry';

/**
 * `app.consumer_receipts.consumer_name` this handler writes under. Stable — a rename
 * orphans every receipt already written under the old name.
 */
export const RECORD_AUDIT_ENTRY_CONSUMER_NAME = 'RecordAuditEntryHandler';

/** PostgreSQL's `unique_violation`. */
const UNIQUE_VIOLATION = '23505';

/**
 * The one field this handler needs from a driver error, read structurally so this
 * file needs no value import from `pg` (mirrors
 * `modules/identity/persistence/postgres-user.repository.ts`'s own
 * `PostgresDriverError`).
 */
function isUniqueViolation(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return false;
  }
  return (error as { code?: unknown }).code === UNIQUE_VIOLATION;
}

/** Everything the handler needs, injected (addendum §12). */
export interface CreateRecordAuditEntryHandlerDependencies {
  /** Connected as `app_rw` and nothing else (ADR-0002 §2). */
  readonly database: DatabaseConnection;
}

/**
 * `RecordAuditEntryHandler` (plan M2.15, ADR-0002 Q4) — an
 * {@link import('../../../entrypoints/outbox-drainer/outbox-consumer').OutboxConsumer}
 * that writes one `app.audit_entries` row per audited outbox event.
 *
 * **The only file in this module allowed to contain SQL** — mirrors
 * `modules/identity/persistence/postgres-user.repository.ts`'s own note; the
 * `no-sql-outside-persistence` fitness rule fails the build on a SQL literal or a
 * `sql` tag anywhere else under `apps/server/src`.
 *
 * One transaction per event, covering both writes ADR-0006 requires: the receipt
 * (this consumer's idempotency gate) and the audit entry (its effect). The receipt is
 * inserted **first** — a unique-violation on it means this event was already
 * processed, so the transaction is abandoned before the audit entry is even attempted,
 * and `handle` resolves normally rather than throwing (ADR-0006: "a unique-violation
 * means already processed → skip"). Either both rows land, or neither does.
 */
export function createRecordAuditEntryHandler(
  dependencies: CreateRecordAuditEntryHandlerDependencies,
): OutboxConsumer {
  const { database } = dependencies;

  return {
    consumerName: RECORD_AUDIT_ENTRY_CONSUMER_NAME,

    async handle(event: OutboxEventRecord): Promise<void> {
      const entry = toAuditEntry(event);

      try {
        await database.transaction().execute(async (transaction) => {
          await transaction
            .insertInto('app.consumer_receipts')
            .values({
              consumer_name: RECORD_AUDIT_ENTRY_CONSUMER_NAME,
              event_id: event.eventId,
              processed_at: new Date(),
            })
            .execute();

          await transaction
            .insertInto('app.audit_entries')
            .values({
              event_type: entry.eventType,
              occurred_at: entry.occurredAt,
              actor_id: entry.actorId,
              aggregate_id: entry.aggregateId,
              source_event_id: entry.sourceEventId,
            })
            .execute();
        });
      } catch (error) {
        if (isUniqueViolation(error)) {
          return;
        }
        throw error;
      }
    },
  };
}
