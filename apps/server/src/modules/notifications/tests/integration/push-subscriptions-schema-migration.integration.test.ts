import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startPostgresTestDatabase, type PostgresTestDatabase } from '@playa-post/testing';

/**
 * L3b-notify's migration-shape suite for `app.push_subscriptions`, mirroring
 * `notify-me-queries-schema-migration.integration.test.ts`'s discipline: catalog
 * facts, never a read of the SQL file.
 *
 * **Design decision recorded here as an AC ambiguity** (mirrors the discipline
 * `bulletin-request-lifecycle.integration.test.ts` and `connections.integration.
 * test.ts` establish for recording assumptions where an AC/ADR leaves a detail open):
 * `app.push_subscriptions`' primary key is `owner_id`, the same shape
 * `app.notify_me_queries` uses for D1. Neither ADR-0007 nor the plan pins this table's
 * shape — the lane brief names only "app.push_subscriptions" with no column list —
 * but M2's scope comment in `notify-me.feature` ("Web Push subscribe" singular;
 * "cross-device dedup" cut to M5) reads as one subscription per user in this
 * milestone, and a primary key is what makes that a database constraint rather than an
 * application check a future edit could forget — the same argument ADR-0007:79 makes
 * for `notify_me_queries`. It is also the conflict target
 * `postgres-push-subscription.repository.ts` upserts against: the key decides which row
 * an owner has, so a second subscribe replaces that row instead of adding one. The coder/reviewer owns ratifying this in the same PR that
 * adds the persistence layer, or replacing it with a surrogate id + unique index if a
 * multi-subscription path turns out to be needed sooner than M5.
 */
describe('L3b-notify migration — app.push_subscriptions', () => {
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
        where table_schema = 'app' and table_type = 'BASE TABLE' and table_name = 'push_subscriptions'`,
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
        where n.nspname = 'app' and c.relname = 'push_subscriptions'`,
    );

    expect(rows, 'app.push_subscriptions must exist to assert its RLS shape').toEqual([
      { rls_enabled: true, rls_forced: true, owner: 'app_migrator' },
    ]);
  });

  it('grants app_rw all DML and no privilege to anon/authenticated/public', async () => {
    const { rows: grantRows } = await database.client.query<{ has_privilege: boolean }>(
      `select pg_catalog.has_table_privilege('app_rw', 'app.push_subscriptions', 'SELECT,INSERT,UPDATE,DELETE') as has_privilege`,
    );
    expect(grantRows[0]?.has_privilege).toBe(true);

    for (const grantee of ['anon', 'authenticated', 'public']) {
      const { rows } = await database.client.query<{ has_privilege: boolean }>(
        `select pg_catalog.has_table_privilege($1, 'app.push_subscriptions',
            'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') as has_privilege`,
        [grantee],
      );
      expect(rows[0]?.has_privilege, `${grantee} must hold no privilege on app.push_subscriptions`).toBe(
        false,
      );
    }
  });

  it('has its primary key on owner_id — one subscription per user in M2 (M2-AC18)', async () => {
    const isKeyed = await hasPrimaryKeyConstraint(database, 'app.push_subscriptions', ['owner_id']);
    expect(
      isKeyed,
      'the primary key must be owner_id — it is what makes "one subscription per user" a ' +
        'constraint rather than a service-level check, and it is the conflict target the ' +
        'repository upserts against, so a re-subscribe replaces rather than accumulating',
    ).toBe(true);
  });

  it('has not-null endpoint and key columns and no bulletin/contact content', async () => {
    const { rows } = await database.client.query<{ column_name: string; is_nullable: string }>(
      `select column_name, is_nullable from information_schema.columns
        where table_schema = 'app' and table_name = 'push_subscriptions'
          and column_name in ('endpoint', 'p256dh_key', 'auth_key')`,
    );
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(row.is_nullable, `app.push_subscriptions.${row.column_name} must be NOT NULL`).toBe('NO');
    }
  });
});

/** Copied per the same-file discipline `notify-me-queries-schema-migration.integration.test.ts` notes. */
async function hasPrimaryKeyConstraint(
  database: PostgresTestDatabase,
  qualifiedTable: string,
  columns: readonly string[],
): Promise<boolean> {
  const [schema, table] = qualifiedTable.split('.');
  const { rows } = await database.client.query<{ columns: string[] }>(
    `select array_agg(kcu.column_name::text order by kcu.ordinal_position) as columns
       from information_schema.table_constraints tc
       join information_schema.key_column_usage kcu
         on kcu.constraint_name = tc.constraint_name and kcu.table_schema = tc.table_schema
      where tc.constraint_type = 'PRIMARY KEY'
        and tc.table_schema = $1
        and tc.table_name = $2
      group by tc.constraint_name`,
    [schema, table],
  );

  const expected = [...columns].sort();

  return rows.some((row) => {
    if (!Array.isArray(row.columns)) {
      throw new TypeError(`expected an array of column names, received ${typeof row.columns}`);
    }
    const actual = [...row.columns].sort();
    return actual.length === expected.length && actual.every((c, i) => c === expected[i]);
  });
}
