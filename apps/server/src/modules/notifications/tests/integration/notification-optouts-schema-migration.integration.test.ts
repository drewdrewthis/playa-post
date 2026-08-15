import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startPostgresTestDatabase, type PostgresTestDatabase } from '@playa-post/testing';

/**
 * Issue #209's migration-shape suite for `app.notification_optouts`, mirroring
 * `notification-seen-watermarks-schema-migration.integration.test.ts`'s discipline:
 * catalog facts, never a read of the SQL file.
 *
 * **The primary key is `(owner_id, kind)`, and that is the design rather than a
 * detail.** A row means one person switched one kind off (ADR-0020 D3); the key is
 * what makes switching it off twice one row, and it is the conflict target
 * `postgres-notification-optout.repository.ts` inserts against. The CHECK on `kind` is
 * the schema's copy of the contract union — a widened union that forgets this table
 * fails here, which is the lockstep the domain's `NOTIFICATION_KINDS` promises.
 */
describe('issue #209 migration — app.notification_optouts', () => {
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
          and table_name = 'notification_optouts'`,
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
        where n.nspname = 'app' and c.relname = 'notification_optouts'`,
    );

    expect(rows, 'app.notification_optouts must exist to assert its RLS shape').toEqual([
      { rls_enabled: true, rls_forced: true, owner: 'app_migrator' },
    ]);
  });

  it('grants app_rw all DML and no privilege to anon/authenticated/public', async () => {
    const { rows: grantRows } = await database.client.query<{ has_privilege: boolean }>(
      `select pg_catalog.has_table_privilege('app_rw', 'app.notification_optouts',
          'SELECT,INSERT,UPDATE,DELETE') as has_privilege`,
    );
    expect(grantRows[0]?.has_privilege).toBe(true);

    for (const grantee of ['anon', 'authenticated', 'public']) {
      const { rows } = await database.client.query<{ has_privilege: boolean }>(
        `select pg_catalog.has_table_privilege($1, 'app.notification_optouts',
            'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') as has_privilege`,
        [grantee],
      );
      expect(
        rows[0]?.has_privilege,
        `${grantee} must hold no privilege on app.notification_optouts`,
      ).toBe(false);
    }
  });

  it('has its primary key on (owner_id, kind) — off twice is one row', async () => {
    const { rows } = await database.client.query<{ columns: string[] }>(
      `select array_agg(kcu.column_name::text order by kcu.ordinal_position) as columns
         from information_schema.table_constraints tc
         join information_schema.key_column_usage kcu
           on kcu.constraint_name = tc.constraint_name and kcu.table_schema = tc.table_schema
        where tc.constraint_type = 'PRIMARY KEY'
          and tc.table_schema = 'app'
          and tc.table_name = 'notification_optouts'
        group by tc.constraint_name`,
    );

    expect(
      rows.map((row) => row.columns),
      'the primary key must be (owner_id, kind) — it is the idempotency of the settings ' +
        'flip and the conflict target the repository inserts against',
    ).toEqual([[['owner_id', 'kind']].flat()]);
  });

  it('has exactly owner_id, kind, and created_at, all NOT NULL', async () => {
    const { rows } = await database.client.query<{ column_name: string; is_nullable: string }>(
      `select column_name, is_nullable from information_schema.columns
        where table_schema = 'app' and table_name = 'notification_optouts'
        order by column_name`,
    );

    expect(rows).toEqual([
      { column_name: 'created_at', is_nullable: 'NO' },
      { column_name: 'kind', is_nullable: 'NO' },
      { column_name: 'owner_id', is_nullable: 'NO' },
    ]);
  });

  it('rejects a kind outside the contract union', async () => {
    // ⚠ The insert runs as the superuser test client on purpose: RLS would refuse an
    // app-role write here anyway, and the claim under test is the CHECK, not the policy.
    const owner = await database.client.query<{ id: string }>(
      `insert into app.users (auth_user_id, handle, display_name, created_at)
       values (gen_random_uuid(), 'optout_check', 'Optout Check', now()) returning id`,
    );

    await expect(
      database.client.query(
        `insert into app.notification_optouts (owner_id, kind) values ($1, 'carrier-pigeon')`,
        [owner.rows[0]?.id],
      ),
    ).rejects.toThrow(/check/i);
  });

  it('accepts the connections kind the widening migration added (#218)', async () => {
    // Same superuser seam as the rejection above; the claim is the widened CHECK.
    const owner = await database.client.query<{ id: string }>(
      `insert into app.users (auth_user_id, handle, display_name, created_at)
       values (gen_random_uuid(), 'optout_connections', 'Optout Connections', now()) returning id`,
    );

    await expect(
      database.client.query(
        `insert into app.notification_optouts (owner_id, kind) values ($1, 'connections')`,
        [owner.rows[0]?.id],
      ),
    ).resolves.toBeDefined();
  });

  it('references app.users with on delete cascade — an opt-out dies with its account', async () => {
    const { rows } = await database.client.query<{ referenced: string; delete_rule: string }>(
      `select ccu.table_name as referenced, rc.delete_rule
         from information_schema.table_constraints tc
         join information_schema.constraint_column_usage ccu
           on ccu.constraint_name = tc.constraint_name and ccu.table_schema = tc.table_schema
         join information_schema.referential_constraints rc
           on rc.constraint_name = tc.constraint_name and rc.constraint_schema = tc.table_schema
        where tc.constraint_type = 'FOREIGN KEY'
          and tc.table_schema = 'app'
          and tc.table_name = 'notification_optouts'`,
    );

    expect(rows).toEqual([{ referenced: 'users', delete_rule: 'CASCADE' }]);
  });
});
