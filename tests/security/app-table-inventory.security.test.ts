import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startPostgresTestDatabase, type PostgresTestDatabase } from '@playa-post/testing';

/**
 * The M2 exit assertion on `schema app` (`m2-lane-briefs.md` §"Ratified decisions" (a)):
 * *"each lane's migration PR reconciles its own rows against the table in §Migration
 * ownership, and **L5 asserts the total**"*.
 *
 * ⚠ **The exact set of names, not a count.** A count-only assertion fails with
 * `expected 13, got 12` and tells the reader nothing about which table went missing or
 * which one appeared. The count is derived from the set below so the two can never
 * disagree — which is the failure mode a hand-maintained count-plus-list acquires
 * within one milestone.
 *
 * A table added by a later migration is *supposed* to fail this test. Adding its name
 * here is how a new table is declared owned by a lane; the test is the door, and a
 * silent addition is what it exists to stop.
 */
const INVENTORY = [
  // identity (L1)
  'users',
  // connections (L2)
  'connections',
  'connection_trust',
  'invitations',
  // the transactional outbox and its consumers (L2 / L3b-infra)
  'consumer_receipts',
  'outbox_events',
  // bulletins (L3a)
  'bulletins',
  // audit (L3b-infra)
  'audit_entries',
  // Notify Me and push (L3b-notify)
  'notify_me_queries',
  'push_subscriptions',
  // The named board queries the Saved tab lists (issue #45, ADR-0007:77, ADR-0016).
  // Pulled forward from M5's A6 — the tab shipped in M2 and pointed at a placeholder.
  // The per-view bell does NOT live here: it is a pointer on `notify_me_queries`, so
  // D1's "exactly one Notify Me query per user" stays a primary key.
  'saved_views',
  // Per-recipient panel state — a dismissal is the one durable fact behind
  // `notifications.list`'s `unread` flag. Its own table rather than a column on
  // `consumer_receipts`, which is ADR-0006 infrastructure this module does not own.
  'notification_dismissals',
  // The other half of per-recipient panel state (issue #178, decision D7): one row per
  // person recording when they last opened the panel, which is what the bell's badge
  // counts against. A *third* table rather than a column beside `dismissed_at`, and the
  // reason is cardinality — a dismissal is one row per (recipient, notification) and this
  // is one row per recipient, so a `seen_at` column there could only ever be written for
  // notifications that had also been dismissed, collapsing the exact distinction the
  // feature exists to keep.
  'notification_seen_watermarks',
  // moderation and sync (L4)
  'bulletin_dismissals',
  'bulletin_reports',
  'mutation_results',
  // The private person-to-person channel (issue #88, decision D6). Its own table and
  // NOT a bulletin type, which is the whole point: PDF §6 forbids mixing
  // fixed-recipient messaging into the bulletin model, so the separation has to be
  // visible right here, in the inventory, rather than asserted in a doc comment.
  'notes',
  // One-hop introductions (issue #89). Its own aggregate and NOT a note subtype:
  // three parties and a via-decided lifecycle, where a note is two parties and
  // lifecycle-free — see ADR-0017.
  'intro_requests',
] as const;

describe('schema app holds exactly the tables M2 declared (m2-lane-briefs.md ratified decision (a))', () => {
  let testDatabase: PostgresTestDatabase;

  beforeAll(async () => {
    testDatabase = await startPostgresTestDatabase();
  }, 300_000);

  afterAll(async () => {
    await testDatabase?.stop();
  });

  it('matches the eighteen-name inventory as a set, and in count', async () => {
    const { rows } = await testDatabase.client.query<{ tablename: string }>(
      `select tablename from pg_tables where schemaname = 'app' order by tablename`,
    );
    const actual = rows.map((row) => row.tablename);

    expect(actual).toEqual([...INVENTORY].sort());
    expect(actual).toHaveLength(INVENTORY.length);
  });

  it('enumerated something — a comparison against an empty database proves nothing', () => {
    expect(INVENTORY.length).toBeGreaterThan(0);
  });

  it('retired the M1b security-baseline canary rather than leaving it in the inventory', async () => {
    // The canary existed only to prove the RLS backstop applied to *something* before
    // any real table existed, and `create_app_users.sql` drops it. Asserted by name so
    // a re-introduced canary shows up as a deliberate decision rather than as a
    // fourteenth row nobody can account for.
    const { rows } = await testDatabase.client.query<{ count: string }>(
      `select count(*)::text as count from pg_tables
       where schemaname = 'app' and tablename = 'security_baseline_canary'`,
    );

    expect(rows[0]?.count).toBe('0');
  });
});
