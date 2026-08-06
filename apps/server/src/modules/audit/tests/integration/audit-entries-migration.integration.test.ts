import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startPostgresTestDatabase, type PostgresTestDatabase } from '@playa-post/testing';

/**
 * L3b-infra's migration-shape suite for `app.audit_entries`
 * (m2-lane-briefs.md §L3b-infra, plan M2.15), mirroring the discipline of
 * `modules/connections/tests/integration/connections-schema-migration.integration.test.ts`:
 * catalog facts, not a read of the SQL file.
 *
 * The column list is pinned exactly, because "internal IDs only, no bulletin content,
 * no contact data" (ADR-0002 Q4, lane brief) is a claim about the *shape* of the
 * table — there is no `payload` column for content to occupy — and pinning the shape
 * is what makes a future migration that widens it fail here first.
 */
describe('L3b-infra migration — app.audit_entries', () => {
  let database: PostgresTestDatabase;
  let appTables: readonly string[];

  beforeAll(async () => {
    database = await startPostgresTestDatabase();
    const { rows } = await database.client.query<{ table_name: string }>(
      `select table_name from information_schema.tables
        where table_schema = 'app' and table_type = 'BASE TABLE'`,
    );
    appTables = rows.map((row) => row.table_name);
  }, 300_000);

  afterAll(async () => {
    await database?.stop();
  });

  it('is created by the migration', () => {
    expect(appTables).toContain('audit_entries');
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
        where n.nspname = 'app' and c.relname = 'audit_entries'`,
    );

    expect(rows, 'app.audit_entries must exist to assert its RLS shape').toEqual([
      { rls_enabled: true, rls_forced: true, owner: 'app_migrator' },
    ]);
  });

  it('grants app_rw all DML and no privilege to anon/authenticated/public', async () => {
    const { rows: grantRows } = await database.client.query<{ has_privilege: boolean }>(
      `select pg_catalog.has_table_privilege('app_rw', 'app.audit_entries', 'SELECT,INSERT,UPDATE,DELETE') as has_privilege`,
    );
    expect(grantRows[0]?.has_privilege).toBe(true);

    for (const grantee of ['anon', 'authenticated', 'public']) {
      const { rows } = await database.client.query<{ has_privilege: boolean }>(
        `select pg_catalog.has_table_privilege($1, 'app.audit_entries',
            'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') as has_privilege`,
        [grantee],
      );
      expect(rows[0]?.has_privilege, `${grantee} must hold no privilege on app.audit_entries`).toBe(
        false,
      );
    }
  });

  it('has exactly the internal-IDs-only column set — no payload, no content column of any kind', async () => {
    const { rows } = await database.client.query<{ column_name: string; is_nullable: string }>(
      `select column_name, is_nullable
         from information_schema.columns
        where table_schema = 'app' and table_name = 'audit_entries'
        order by ordinal_position`,
    );
    const byName = Object.fromEntries(rows.map((row) => [row.column_name, row]));

    // The whole point of the shape: no `payload`, no `body`, no `content`, no
    // `email`/`phone`/`contact` column exists to carry what ADR-0002 Q4 forbids.
    expect(Object.keys(byName).sort()).toEqual(
      ['entry_id', 'event_type', 'occurred_at', 'recorded_at', 'actor_id', 'aggregate_id', 'source_event_id'].sort(),
    );

    expect(byName['entry_id']?.is_nullable).toBe('NO');
    expect(byName['event_type']?.is_nullable).toBe('NO');
    expect(byName['occurred_at']?.is_nullable).toBe('NO');
    expect(byName['recorded_at']?.is_nullable).toBe('NO');
    expect(byName['aggregate_id']?.is_nullable).toBe('NO');
    expect(byName['source_event_id']?.is_nullable).toBe('NO');
    expect(byName['actor_id']?.is_nullable).toBe('YES');
  });

  it('is keyed on entry_id, a uuid default rather than a bigserial — introduces no app sequence', async () => {
    const { rows } = await database.client.query<{ column_default: string | null }>(
      `select column_default
         from information_schema.columns
        where table_schema = 'app' and table_name = 'audit_entries' and column_name = 'entry_id'`,
    );
    expect(rows[0]?.column_default).toMatch(/gen_random_uuid/);
  });

  it('indexes aggregate_id and occurred_at for the audit trail\'s read paths', async () => {
    const { rows } = await database.client.query<{ indexdef: string }>(
      `select indexdef from pg_catalog.pg_indexes
        where schemaname = 'app' and tablename = 'audit_entries'`,
    );
    expect(rows.some((row) => /aggregate_id/i.test(row.indexdef))).toBe(true);
    expect(rows.some((row) => /occurred_at/i.test(row.indexdef))).toBe(true);
  });
});
