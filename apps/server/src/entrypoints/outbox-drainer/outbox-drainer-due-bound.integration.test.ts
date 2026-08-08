import { randomUUID } from 'node:crypto';

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { createDatabaseConnection, type DatabaseConnection } from '@playa-post/database';
import { startPostgresTestDatabase, type PostgresTestDatabase } from '@playa-post/testing';

import type { OutboxConsumer } from './outbox-consumer';
import { createOutboxDrainer } from './outbox-drainer';

/**
 * Regression coverage for #74 — the claim bound's millisecond truncation
 * (`outbox-drainer.ts`'s `DUE_BOUND_SLACK_MS`, which is module-private and so is named
 * here rather than linked).
 *
 * `app.outbox_events.available_at` is `timestamptz`, filled by `default now()` to
 * MICROsecond precision. `new Date()` is truncated to the millisecond. A row written
 * microseconds before the drainer read its clock therefore sits at `T.000999` — earlier
 * in time, larger as a number — and `available_at <= T` skipped it. Measured at ~1.9%
 * of rows; observed as an intermittent red on `outbox-drainer-exclusion.integration.test.ts`,
 * which seeds two rows and asserts one `drainOnce()` claims both.
 *
 * **Why this is a new file rather than a case appended to the two siblings**: both are
 * merged, both are will-conflict-on-rebase, and the exclusion suite's own header records
 * that convention for this directory.
 */
describe('outbox drainer due-bound (#74, available_at microsecond precision)', () => {
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

  /**
   * Seeds one claimable row at an explicitly-chosen `available_at`.
   *
   * ⚠ Explicit, never the column's `default now()`: the whole subject here is a
   * sub-millisecond offset between the row and the drainer's clock, and a default-filled
   * row's offset is whatever the two clocks happened to differ by. `availableAt` is a
   * literal so it can carry microseconds — a JS `Date` parameter cannot express one.
   */
  async function seedEventDueAt(availableAt: string): Promise<string> {
    const eventId = randomUUID();
    await testDatabase.client.query(
      `insert into app.outbox_events
         (event_id, event_type, occurred_at, actor_id, aggregate_id, payload, status, available_at)
       values ($1, 'DueBoundProbe', now(), null, $2, '{}'::jsonb, 'pending', $3::timestamptz)`,
      [eventId, randomUUID(), availableAt],
    );
    return eventId;
  }

  async function eventRow(
    eventId: string,
  ): Promise<{ status: string; claimed_at: Date; available_at: Date }> {
    const { rows } = await testDatabase.client.query<{
      status: string;
      claimed_at: Date;
      available_at: Date;
    }>(
      `select status, claimed_at, available_at from app.outbox_events where event_id = $1`,
      [eventId],
    );
    const row = rows[0];
    if (row === undefined) {
      throw new Error(`seed invariant broken: no row for ${eventId}`);
    }
    return row;
  }

  describe('given a pinned clock reading and rows straddling it by microseconds', () => {
    /**
     * The deterministic guard, and the one that actually holds the regression down.
     *
     * Pinning the clock is what makes the assertion decidable at all: an off-by-one-
     * truncation-window bound is indistinguishable from a correct one unless you know
     * the exact reading it was derived from, and against the real wall clock you never
     * do — the transaction's `BEGIN` round-trip lands the drainer's `new Date()` an
     * unpredictable millisecond or two after anything the test can observe.
     */
    it('claims the row 999µs into the reading and leaves the row 2ms past it', async () => {
      const clockReading = new Date('2026-01-01T00:00:00.000Z');

      // Chronologically inside the very millisecond the drainer believes it is in. A
      // `Date` cannot express any instant more precisely than that millisecond, so a
      // claim round that has arrived is a claim round that must see this row.
      const dueWithinTheReading = await seedEventDueAt('2026-01-01 00:00:00.000999+00');
      // Genuinely later: two whole milliseconds out. Pins the slack at one truncation
      // window and stops a future flake being "fixed" by widening the due-window into a
      // seconds-scale fudge factor.
      const dueTwoMillisecondsLater = await seedEventDueAt('2026-01-01 00:00:00.002000+00');

      const drainer = createOutboxDrainer({
        database,
        consumers: [],
        drainerId: 'due-bound-pinned-clock',
        now: () => clockReading,
      });

      const { claimedEventIds } = await drainer.drainOnce();

      expect(
        claimedEventIds,
        'a row due 999µs into the drainer\'s own millisecond is due now, not next poll',
      ).toContain(dueWithinTheReading);
      expect(
        claimedEventIds,
        'the slack is one millisecond of truncation, not a widened due-window',
      ).not.toContain(dueTwoMillisecondsLater);
    }, 60_000);

    /**
     * The bound's exact width, pinned from the excluded side.
     *
     * `00:00:00.001000` is the first instant the predicate must reject: the reading stands
     * for some instant in `[00:00:00.000, 00:00:00.001)`, so this row is strictly later
     * than the drainer's own clock wherever in that interval the true reading fell. The
     * negative case above sits a comfortable 2ms out and would still pass if the slack
     * were bumped to 1.5ms; this one goes red the moment the bound grows by a single
     * microsecond, or the moment `<` relaxes back to `<=`.
     */
    it('leaves the row at exactly one millisecond past the reading — the bound is exclusive', async () => {
      const clockReading = new Date('2026-01-01T00:00:00.000Z');
      const dueExactlyOneMillisecondLater = await seedEventDueAt('2026-01-01 00:00:00.001000+00');

      const drainer = createOutboxDrainer({
        database,
        consumers: [],
        drainerId: 'due-bound-exclusive-edge',
        now: () => clockReading,
      });

      const { claimedEventIds } = await drainer.drainOnce();

      expect(
        claimedEventIds,
        'T+1.000000 is the first instant the reading provably is not — it is future',
      ).not.toContain(dueExactlyOneMillisecondLater);
      expect(claimedEventIds, 'and it was the only row seeded').toEqual([]);
    }, 60_000);

    /**
     * The other half of the coupling: the widened bound is a *read* predicate only.
     * Writing `dueBound` into either field would make the drainer claim a millisecond it
     * did not act in, and would drift the lease forward by 1ms on every reclaim.
     */
    it('still stamps claimed_at and the lease from the reading itself, not from the bound', async () => {
      const clockReading = new Date('2026-01-01T00:00:00.000Z');
      const eventId = await seedEventDueAt('2026-01-01 00:00:00.000999+00');

      const drainer = createOutboxDrainer({
        database,
        consumers: [],
        drainerId: 'due-bound-write-fields',
        now: () => clockReading,
      });
      await drainer.drainOnce();

      const row = await eventRow(eventId);
      expect(new Date(row.claimed_at).toISOString()).toBe('2026-01-01T00:00:00.000Z');
      // CLAIM_LEASE_SECONDS (300) past the reading, to the millisecond.
      expect(new Date(row.available_at).toISOString()).toBe('2026-01-01T00:05:00.000Z');
    }, 60_000);
  });

  describe('given a pinned clock and a consumer that throws', () => {
    /**
     * Covers the *second* of the two clock reads this change threaded — the retry backoff
     * in `dispatchAndRecordOutcome`, which now reads the injected clock rather than
     * `Date.now()`. The pinned-clock cases above cannot reach it: they register no
     * consumers, so nothing ever throws and the `catch` never runs.
     *
     * It also pins the backoff formula, which otherwise has no exact test. The sibling
     * 8-attempt scenario (`outbox-drainer.integration.test.ts`, M2-AC23) measures growth
     * against the real wall clock with a ±5s tolerance — enough to prove "grows per the
     * formula", not enough to notice a constant that moved. With the reading pinned,
     * `available_at` is decidable to the millisecond.
     *
     * ⚠ This case leaves the row at `2026-01-01T00:00:05Z` — years in the past in real
     * terms, so it is immediately reclaimable by any real-clock drain that runs after it.
     * Harmless only because `afterEach` truncates every table between cases: a future case
     * added to this file that drains on the real clock and asserts on *what* it claimed
     * would pick this row up if that truncation ever went away.
     */
    it('retries at exactly BACKOFF_BASE_SECONDS past the reading, from the injected clock', async () => {
      const clockReading = new Date('2026-01-01T00:00:00.000Z');
      const eventId = await seedEventDueAt('2026-01-01 00:00:00.000999+00');

      const alwaysThrows: OutboxConsumer = {
        consumerName: 'DueBoundThrowsProbe',
        async handle(): Promise<void> {
          throw new Error('this consumer always throws');
        },
      };
      const drainer = createOutboxDrainer({
        database,
        consumers: [alwaysThrows],
        drainerId: 'due-bound-retry-clock',
        now: () => clockReading,
      });

      const { claimedEventIds } = await drainer.drainOnce();
      expect(claimedEventIds, 'the row was claimed before its consumer threw').toEqual([eventId]);

      const row = await eventRow(eventId);
      // `attempts` is 1 — the claim incremented it off the column's `default 0` — so the
      // backoff is BACKOFF_BASE_SECONDS * 1^2 = 5s, and 1 < MAX_ATTEMPTS (8) means retry
      // rather than dead-letter.
      expect(row.status, 'the first failure of eight is a retry, not a dead letter').toBe(
        'pending',
      );
      expect(
        new Date(row.available_at).toISOString(),
        'backoff measured from the injected reading, not from Date.now()',
      ).toBe('2026-01-01T00:00:05.000Z');
    }, 60_000);
  });

  describe('given the real wall clock', () => {
    /**
     * End-to-end over the default `new Date()` path, so the pinned-clock cases above
     * cannot both pass while production — which injects no clock — stays broken.
     *
     * ⚠ **Deliberately asymmetric sensitivity, and do not "fix" it.** With the bound
     * correct this can never fail: the drainer reads some millisecond `M >= targetMs`,
     * so its bound is `M + 1 >= targetMs + 1`, which is strictly past
     * `targetMs.000999`. With the bound broken it fails only when `M === targetMs`
     * exactly — the `BEGIN` round-trip often pushes the reading to `targetMs + 1` or
     * later, where the old bound also passes. So: never spuriously red, only sometimes
     * red on the real bug. That is the correct asymmetry for a test guarding a race —
     * the sensitivity lives in the pinned-clock case, and tightening this one would buy
     * flakiness in the suite that #74 was filed about.
     */
    it('claims a row due 999µs into the current millisecond, with no injected clock', async () => {
      const targetMs = Date.now() + 5;
      // `2026-…T…:…:….mmmZ` -> `2026-…T…:…:….mmm999+00`: the same millisecond floor as
      // `targetMs`, carrying a sub-millisecond remainder a `Date` could not have held.
      const availableAt = `${new Date(targetMs).toISOString().slice(0, -1)}999+00`;
      const eventId = await seedEventDueAt(availableAt);

      while (Date.now() < targetMs) {
        // Spin, rather than await a timer: a timer wakes on a coarse boundary and the
        // property under test lives inside a single millisecond. 5ms, bounded.
      }

      const drainer = createOutboxDrainer({
        database,
        consumers: [],
        drainerId: 'due-bound-real-clock',
      });

      const { claimedEventIds } = await drainer.drainOnce();

      expect(claimedEventIds).toEqual([eventId]);
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
