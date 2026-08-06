import { randomUUID } from 'node:crypto';

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { createDatabaseConnection, type DatabaseConnection } from '@playa-post/database';
import { startPostgresTestDatabase, type PostgresTestDatabase } from '@playa-post/testing';

import type { OutboxEventRecord } from '../../../../entrypoints/outbox-drainer/outbox-event';
// Does not exist yet — legible failure at this seam until the coder writes it.
import {
  createRecordAuditEntryHandler,
  RECORD_AUDIT_ENTRY_CONSUMER_NAME,
} from '../../persistence/postgres-record-audit-entry-handler';

/**
 * `RecordAuditEntryHandler` (plan M2.15, ADR-0002 Q4) against real Postgres.
 *
 * Covers what `record-audit-entry.unit.test.ts` cannot: the transactional write into
 * `app.audit_entries` + `app.consumer_receipts` (ADR-0006's "same transaction as its
 * own effect" idempotency rule), and a second, database-level negative assertion that
 * nothing from a source payload lands anywhere in the row this handler actually
 * writes — not just in the pure mapping.
 */
describe('RecordAuditEntryHandler (ADR-0002 Q4, ADR-0006 consumer idempotency)', () => {
  let testDatabase: PostgresTestDatabase;
  let database: DatabaseConnection;

  beforeAll(async () => {
    testDatabase = await startPostgresTestDatabase();
    await testDatabase.client.query(`alter role app_rw with password 'app_rw_in_a_throwaway_container'`);
    database = createDatabaseConnection({
      connectionString: asRole(testDatabase.connectionString, 'app_rw', 'app_rw_in_a_throwaway_container'),
    });
  }, 300_000);

  afterEach(async () => {
    await testDatabase.truncateAllTables();
  });

  afterAll(async () => {
    await database?.destroy();
    await testDatabase?.stop();
  });

  async function seedOutboxEvent(overrides: Partial<{
    eventType: string;
    actorId: string | null;
    aggregateId: string;
    payload: Record<string, unknown>;
  }> = {}): Promise<OutboxEventRecord> {
    const eventId = randomUUID();
    const aggregateId = overrides.aggregateId ?? randomUUID();
    const actorId = overrides.actorId === undefined ? randomUUID() : overrides.actorId;
    const eventType = overrides.eventType ?? 'ConnectionAccepted';
    const occurredAt = new Date();
    const payload = overrides.payload ?? {};

    await testDatabase.client.query(
      `insert into app.outbox_events
         (event_id, event_type, occurred_at, actor_id, aggregate_id, payload, status)
       values ($1, $2, $3, $4, $5, $6, 'claimed')`,
      [eventId, eventType, occurredAt.toISOString(), actorId, aggregateId, JSON.stringify(payload)],
    );

    return { eventId, eventType, occurredAt, actorId, aggregateId, payload, attempts: 1 };
  }

  async function auditEntryRows(): Promise<
    Array<{
      entry_id: string;
      event_type: string;
      actor_id: string | null;
      aggregate_id: string;
      source_event_id: string;
    }>
  > {
    const { rows } = await testDatabase.client.query(
      `select entry_id, event_type, actor_id, aggregate_id, source_event_id from app.audit_entries`,
    );
    return rows;
  }

  async function receiptRows(): Promise<Array<{ consumer_name: string; event_id: string }>> {
    const { rows } = await testDatabase.client.query(
      `select consumer_name, event_id from app.consumer_receipts`,
    );
    return rows;
  }

  describe('given an ordinary audited event', () => {
    it('writes one app.audit_entries row carrying only the event envelope\'s internal IDs', async () => {
      const handler = createRecordAuditEntryHandler({ database });
      const event = await seedOutboxEvent();

      await handler.handle(event);

      const rows = await auditEntryRows();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        event_type: event.eventType,
        actor_id: event.actorId,
        aggregate_id: event.aggregateId,
        source_event_id: event.eventId,
      });
    });

    it('writes exactly one app.consumer_receipts row for this consumer and event, in the same transaction as the effect', async () => {
      const handler = createRecordAuditEntryHandler({ database });
      const event = await seedOutboxEvent();

      await handler.handle(event);

      const rows = await receiptRows();
      expect(rows).toEqual([
        { consumer_name: RECORD_AUDIT_ENTRY_CONSUMER_NAME, event_id: event.eventId },
      ]);
    });
  });

  describe('given a payload carrying content or contact data — the negative assertion, at the database', () => {
    it('leaves no trace of the payload anywhere in the written row', async () => {
      const handler = createRecordAuditEntryHandler({ database });
      const event = await seedOutboxEvent({
        payload: {
          headline: 'Need propane, will trade',
          contactEmail: 'playa-dweller@example.com',
          contactPhone: '+1-555-0199',
        },
      });

      await handler.handle(event);

      const { rows } = await testDatabase.client.query<{ raw: string }>(
        `select row_to_json(audit_entries)::text as raw from app.audit_entries`,
      );
      const serializedRow = rows.map((row) => row.raw).join('\n');
      expect(serializedRow).not.toContain('propane');
      expect(serializedRow).not.toContain('playa-dweller@example.com');
      expect(serializedRow).not.toContain('+1-555-0199');
    });
  });

  describe('given the same event delivered twice (ADR-0006 at-least-once delivery)', () => {
    it('writes only one audit entry and only one receipt across two deliveries', async () => {
      const handler = createRecordAuditEntryHandler({ database });
      const event = await seedOutboxEvent();

      await handler.handle(event);
      await expect(handler.handle(event)).resolves.not.toThrow();

      expect(await auditEntryRows()).toHaveLength(1);
      expect(await receiptRows()).toHaveLength(1);
    });
  });
});

/** Mirrors `packages/database/src/database-schema.integration.test.ts`'s helper. */
function asRole(connectionString: string, username: string, password: string): string {
  const url = new URL(connectionString);
  url.username = username;
  url.password = password;
  return url.toString();
}
