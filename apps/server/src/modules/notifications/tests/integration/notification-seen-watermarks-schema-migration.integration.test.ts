import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startPostgresTestDatabase, type PostgresTestDatabase } from '@playa-post/testing';

/**
 * Issue #178's migration-shape suite for `app.notification_seen_watermarks`, mirroring
 * `push-subscriptions-schema-migration.integration.test.ts`'s discipline: catalog facts,
 * never a read of the SQL file.
 *
 * **The primary key is `recipient_id`, and that is the design rather than a detail.** One
 * watermark per person is what makes "everything up to here" answerable without a reader
 * deciding which of two rows to believe, and it is the conflict target
 * `postgres-notification-seen-watermark.repository.ts` upserts against — the key is what
 * makes a second open *replace* the moment rather than append one. Asserted here so a
 * later widening to per-device watermarks has to come past this test and say so.
 */
describe('issue #178 migration — app.notification_seen_watermarks', () => {
  let database: PostgresTestDatabase;

  beforeAll(async () => {
    database = await startPostgresTestDatabase();
  }, 300_000);

  afterAll(async () => {
    await database?.stop();
  });

  it('is created by the migration', async () => {
    const { rows } = await database.client.query<{ table_name: string }>(
      `select table_name from information_schema.tables
        where table_schema = 'app' and table_type = 'BASE TABLE'
          and table_name = 'notification_seen_watermarks'`,
    );
    expect(rows).toHaveLength(1);
  });

  it('has RLS enabled, FORCEd, and owned by app_migrator', async () => {
    const { rows } = await database.client.query<{
      rls_enabled: boolean;
      rls_forced: boolean;
      owner: string;
    }>(
      `select c.relrowsecurity as rls_enabled,
              c.relforcerowsecurity as rls_forced,
              pg_catalog.pg_get_userbyid(c.relowner) as owner
         from pg_catalog.pg_class c
         join pg_catalog.pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'app' and c.relname = 'notification_seen_watermarks'`,
    );

    expect(rows, 'app.notification_seen_watermarks must exist to assert its RLS shape').toEqual([
      { rls_enabled: true, rls_forced: true, owner: 'app_migrator' },
    ]);
  });

  it('grants app_rw all DML and no privilege to anon/authenticated/public', async () => {
    const { rows: grantRows } = await database.client.query<{ has_privilege: boolean }>(
      `select pg_catalog.has_table_privilege('app_rw', 'app.notification_seen_watermarks',
          'SELECT,INSERT,UPDATE,DELETE') as has_privilege`,
    );
    expect(grantRows[0]?.has_privilege).toBe(true);

    for (const grantee of ['anon', 'authenticated', 'public']) {
      const { rows } = await database.client.query<{ has_privilege: boolean }>(
        `select pg_catalog.has_table_privilege($1, 'app.notification_seen_watermarks',
            'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') as has_privilege`,
        [grantee],
      );
      expect(
        rows[0]?.has_privilege,
        `${grantee} must hold no privilege on app.notification_seen_watermarks`,
      ).toBe(false);
    }
  });

  it('has its primary key on recipient_id — one watermark per person', async () => {
    const { rows } = await database.client.query<{ columns: string[] }>(
      `select array_agg(kcu.column_name::text order by kcu.ordinal_position) as columns
         from information_schema.table_constraints tc
         join information_schema.key_column_usage kcu
           on kcu.constraint_name = tc.constraint_name and kcu.table_schema = tc.table_schema
        where tc.constraint_type = 'PRIMARY KEY'
          and tc.table_schema = 'app'
          and tc.table_name = 'notification_seen_watermarks'
        group by tc.constraint_name`,
    );

    expect(
      rows.map((row) => row.columns),
      'the primary key must be recipient_id — it is what makes "one watermark per person" ' +
        'a constraint rather than a service-level check, and it is the conflict target the ' +
        'repository upserts against, so a second open replaces rather than accumulating',
    ).toEqual([['recipient_id']]);
  });

  it('has a NOT NULL last_seen_at and no second timestamp beside it', async () => {
    // Two columns and no more. A `first_seen_at`, a `device_id`, or anything else nothing
    // writes is a column every later reader has to guess the meaning of — the rule
    // `create_notification_dismissals` states for its own single timestamp.
    const { rows } = await database.client.query<{ column_name: string; is_nullable: string }>(
      `select column_name, is_nullable from information_schema.columns
        where table_schema = 'app' and table_name = 'notification_seen_watermarks'
        order by column_name`,
    );

    expect(rows).toEqual([
      { column_name: 'last_seen_at', is_nullable: 'NO' },
      { column_name: 'recipient_id', is_nullable: 'NO' },
    ]);
  });

  it('references app.users, so a watermark can never name somebody who does not exist', async () => {
    // Unlike `app.notification_dismissals.notification_id`, which deliberately carries no
    // foreign key because outbox rows are pruned: a *user* is not pruned, so the reference
    // costs nothing and keeps the table from accumulating rows for deleted accounts.
    const { rows } = await database.client.query<{ referenced: string }>(
      `select ccu.table_name as referenced
         from information_schema.table_constraints tc
         join information_schema.constraint_column_usage ccu
           on ccu.constraint_name = tc.constraint_name and ccu.table_schema = tc.table_schema
        where tc.constraint_type = 'FOREIGN KEY'
          and tc.table_schema = 'app'
          and tc.table_name = 'notification_seen_watermarks'`,
    );

    expect(rows.map((row) => row.referenced)).toEqual(['users']);
  });
});
