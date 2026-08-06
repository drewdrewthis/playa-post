import { randomUUID } from 'node:crypto';

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { createDatabaseConnection, type DatabaseConnection } from '@playa-post/database';
import { startPostgresTestDatabase, type PostgresTestDatabase } from '@playa-post/testing';

// Does not exist yet — legible failure at this seam until the coder writes it.
// `apps/server/src/entrypoints/outbox-drainer/` — an entrypoint, not a module
// (m2-lane-briefs.md §L3b-infra: "in-process on the Node server … no cron variant, no
// second service. It is an entrypoint, not a module").
import type { OutboxConsumer } from './outbox-consumer';
import { createOutboxDrainer, type OutboxDrainer } from './outbox-drainer';
import type { OutboxEventRecord } from './outbox-event';

/**
 * `specs/features/notify-me.feature`'s two `@integration` scenarios owned by
 * L3b-infra (m2-lane-briefs.md §L3b-infra):
 *
 * - M2-AC23 "A throwing consumer is retried with growing backoff and eventually
 *   dead-lettered"
 * - M2-AC24 "Two concurrent drainers claim disjoint events"
 *
 * Both are pure infrastructure assertions over `app.outbox_events` — no bulletin, no
 * push subscription, no Notify Me query, per the lane brief's own framing.
 *
 * ADR-0006's claim query is `UPDATE … WHERE status IN ('pending','claimed') AND
 * available_at <= now() ORDER BY available_at FOR UPDATE SKIP LOCKED LIMIT $2
 * RETURNING *`, retry backoff `available_at = now() + least(15 min, 5s *
 * attempts^2)`, and dead-lettering at the 8th attempt. `createOutboxDrainer` is this
 * lane's entrypoint factory: `drainOnce()` claims up to `limit` rows, hands each to
 * every consumer whose name matches `event_type`... in this suite, to every consumer
 * registered, mirroring ADR-0006 §5's "one consumer per event family" — the fixture
 * below registers exactly one.
 */
describe('outbox drainer entrypoint (notify-me.feature @integration, M2-AC23/AC24)', () => {
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

  async function seedPendingEvent(eventType = 'ProbeEvent'): Promise<string> {
    const eventId = randomUUID();
    await testDatabase.client.query(
      `insert into app.outbox_events
         (event_id, event_type, occurred_at, actor_id, aggregate_id, payload, status)
       values ($1, $2, now(), null, $3, '{}'::jsonb, 'pending')`,
      [eventId, eventType, randomUUID()],
    );
    return eventId;
  }

  async function eventRow(eventId: string): Promise<{
    status: string;
    attempts: number;
    available_at: string;
    last_error: string | null;
  }> {
    const { rows } = await testDatabase.client.query(
      `select status, attempts, available_at, last_error from app.outbox_events where event_id = $1`,
      [eventId],
    );
    const row = rows[0];
    if (row === undefined) {
      throw new Error(`seed/claim invariant broken: no row for ${eventId}`);
    }
    return row;
  }

  /** Bypasses real wall-clock backoff so the 8-attempt scenario runs in test time. */
  async function forceClaimableNow(eventId: string): Promise<void> {
    await testDatabase.client.query(
      `update app.outbox_events set available_at = now() - interval '1 second' where event_id = $1`,
      [eventId],
    );
  }

  describe('Scenario: A throwing consumer is retried with growing backoff and eventually dead-lettered (M2-AC23)', () => {
    it('grows available_at per least(15 min, 5s * attempts^2) on each of 8 attempts, then dead-letters and stops', async () => {
      const alwaysThrows: OutboxConsumer = {
        consumerName: 'AlwaysThrowsProbe',
        async handle(): Promise<void> {
          throw new Error('this consumer always throws');
        },
      };
      const drainer: OutboxDrainer = createOutboxDrainer({
        database,
        consumers: [alwaysThrows],
        drainerId: 'drainer-ac23',
      });

      const eventId = await seedPendingEvent();

      for (let attempt = 1; attempt <= 8; attempt += 1) {
        const before = Date.now();
        await drainer.drainOnce({ limit: 10 });
        const row = await eventRow(eventId);

        expect(row.attempts, `attempt ${attempt}`).toBe(attempt);

        const expectedBackoffSeconds = Math.min(15 * 60, 5 * attempt ** 2);
        const actualBackoffMs = new Date(row.available_at).getTime() - before;
        // Generous tolerance for test-runner scheduling jitter — the property under
        // test is "grows per the formula", not "millisecond-exact".
        expect(
          actualBackoffMs,
          `attempt ${attempt}: expected ~${expectedBackoffSeconds}s of backoff`,
        ).toBeGreaterThan(expectedBackoffSeconds * 1000 - 5_000);
        expect(actualBackoffMs).toBeLessThan(expectedBackoffSeconds * 1000 + 5_000);

        if (attempt < 8) {
          expect(row.status, `attempt ${attempt}: not yet dead`).toBe('pending');
          await forceClaimableNow(eventId);
        } else {
          expect(row.status, 'after the 8th attempt').toBe('dead');
          expect(row.last_error).not.toBeNull();
        }
      }

      // No further attempt occurs: dead-lettered rows are never reclaimed by drainOnce,
      // even when forced immediately claimable.
      await forceClaimableNow(eventId);
      await drainer.drainOnce({ limit: 10 });
      const finalRow = await eventRow(eventId);
      expect(finalRow.attempts).toBe(8);
      expect(finalRow.status).toBe('dead');
    }, 60_000);
  });

  describe('Scenario: Two concurrent drainers claim disjoint events (M2-AC24)', () => {
    it('produces empty-intersection claimed-ID sets and exactly one receipt per event', async () => {
      const seededEventIds = await Promise.all(
        Array.from({ length: 20 }, () => seedPendingEvent('ProbeEvent')),
      );

      // Mirrors ADR-0006's consumer contract directly (§ "Consumers": "Each consumer
      // inserts its receipt in the same transaction as its own effect") rather than
      // relying on the drainer to write receipts generically — the same contract
      // `RecordAuditEntryHandler` implements for real in
      // `record-audit-entry-handler.integration.test.ts`. This fixture proves the
      // drainer's claim step hands each event to exactly one consumer instance; the
      // consumer proves ADR-0006's receipt-per-effect rule for itself.
      const succeeds: OutboxConsumer = {
        consumerName: 'SucceedsProbe',
        async handle(event: OutboxEventRecord): Promise<void> {
          await testDatabase.client.query(
            `insert into app.consumer_receipts (consumer_name, event_id, processed_at)
             values ($1, $2, now())`,
            ['SucceedsProbe', event.eventId],
          );
        },
      };

      const drainerA = createOutboxDrainer({ database, consumers: [succeeds], drainerId: 'drainer-a' });
      const drainerB = createOutboxDrainer({ database, consumers: [succeeds], drainerId: 'drainer-b' });

      const [resultA, resultB] = await Promise.all([
        drainerA.drainOnce({ limit: 20 }),
        drainerB.drainOnce({ limit: 20 }),
      ]);

      const setA = new Set(resultA.claimedEventIds);
      const setB = new Set(resultB.claimedEventIds);
      const intersection = [...setA].filter((id) => setB.has(id));

      expect(intersection, 'the two drainers must claim disjoint events').toEqual([]);

      const union = new Set([...setA, ...setB]);
      expect(union.size).toBe(seededEventIds.length);
      for (const id of seededEventIds) {
        expect(union.has(id), `${id} must have been claimed by exactly one drainer`).toBe(true);
      }

      const { rows: receiptRows } = await testDatabase.client.query<{ event_id: string; count: string }>(
        `select event_id, count(*)::text as count
           from app.consumer_receipts
          where consumer_name = 'SucceedsProbe'
          group by event_id`,
      );
      expect(receiptRows).toHaveLength(seededEventIds.length);
      expect(receiptRows.every((row) => row.count === '1')).toBe(true);
    }, 60_000);
  });
});

/** Mirrors `packages/database/src/database-schema.integration.test.ts`'s helper. */
function asRole(connectionString: string, username: string, password: string): string {
  const url = new URL(connectionString);
  url.username = username;
  url.password = password;
  return url.toString();
}
