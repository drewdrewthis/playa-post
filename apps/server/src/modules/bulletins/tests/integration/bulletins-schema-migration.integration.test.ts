import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startPostgresTestDatabase, type PostgresTestDatabase } from '@playa-post/testing';

/**
 * L3a's migration-shape suite for `app.bulletins`, mirroring
 * `modules/connections/tests/integration/connections-schema-migration.integration.test.ts`'s
 * discipline: catalog facts, never a read of the SQL file.
 *
 * m2-lane-briefs.md §L3a pins exactly two things about this table's shape:
 * **lifecycle timestamps** and a **`version` column** (ADR-0005 requires it for
 * conflict handling — `bulletin.create`/`bulletin.archive` are both `expectedVersion:
 * no` per ADR-0005's matrix, but the column itself is still required so a later M5
 * mutation, e.g. `bulletin.update`, has somewhere to read a version from without a
 * second migration). Everything else about the table's columns (title, body, type,
 * author FK) is **not** ADR-pinned by anything this lane is bound to, so — matching
 * `connections-schema-migration.integration.test.ts`'s own restraint — this suite does
 * not invent column names for the coder to be wrongly held to.
 */
describe('L3a migration — app.bulletins', () => {
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
        where table_schema = 'app' and table_type = 'BASE TABLE' and table_name = 'bulletins'`,
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
        where n.nspname = 'app' and c.relname = 'bulletins'`,
    );

    expect(rows, 'app.bulletins must exist to assert its RLS shape').toEqual([
      { rls_enabled: true, rls_forced: true, owner: 'app_migrator' },
    ]);
  });

  it('grants app_rw all DML and no privilege to anon/authenticated/public', async () => {
    const { rows: grantRows } = await database.client.query<{ has_privilege: boolean }>(
      `select pg_catalog.has_table_privilege('app_rw', 'app.bulletins', 'SELECT,INSERT,UPDATE,DELETE') as has_privilege`,
    );
    expect(grantRows[0]?.has_privilege).toBe(true);

    for (const grantee of ['anon', 'authenticated', 'public']) {
      const { rows } = await database.client.query<{ has_privilege: boolean }>(
        `select pg_catalog.has_table_privilege($1, 'app.bulletins',
            'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') as has_privilege`,
        [grantee],
      );
      expect(rows[0]?.has_privilege, `${grantee} must hold no privilege on app.bulletins`).toBe(false);
    }
  });

  describe('lifecycle timestamps + version column (ADR-0005 conflict handling)', () => {
    it('has a created_at column that is not nullable', async () => {
      const { rows } = await database.client.query<{ is_nullable: string }>(
        `select is_nullable from information_schema.columns
          where table_schema = 'app' and table_name = 'bulletins' and column_name = 'created_at'`,
      );
      expect(rows[0]?.is_nullable, 'app.bulletins.created_at must exist and be NOT NULL').toBe('NO');
    });

    it('has an archived_at column that is nullable — absence, not a sentinel, is the unarchived state', async () => {
      const { rows } = await database.client.query<{ is_nullable: string }>(
        `select is_nullable from information_schema.columns
          where table_schema = 'app' and table_name = 'bulletins' and column_name = 'archived_at'`,
      );
      expect(rows[0]?.is_nullable, 'app.bulletins.archived_at must exist and be nullable').toBe('YES');
    });

    it('has a version column that is not nullable (ADR-0005 conflict handling)', async () => {
      const { rows } = await database.client.query<{
        is_nullable: string;
        data_type: string;
      }>(
        `select is_nullable, data_type from information_schema.columns
          where table_schema = 'app' and table_name = 'bulletins' and column_name = 'version'`,
      );
      expect(rows[0], 'app.bulletins.version must exist').toBeDefined();
      expect(rows[0]?.is_nullable).toBe('NO');
      expect(rows[0]?.data_type).toMatch(/int/i);
    });
  });

  it('has a primary key on id, not a bare unique index', async () => {
    const isKeyed = await hasPrimaryKeyConstraint(database, 'app.bulletins', ['id']);
    expect(isKeyed).toBe(true);
  });
});

/**
 * Copied from `connections-schema-migration.integration.test.ts`'s `hasKeyConstraint`,
 * narrowed to `PRIMARY KEY` only (this table's `id` needs exactly that, not the wider
 * UNIQUE-or-PRIMARY acceptance the connection_trust/consumer_receipts callers needed).
 * Kept as a local copy per that file's own note that the coder is free to promote a
 * shared version in the same PR that removes the duplication.
 *
 * ⚠ `::text` is load-bearing — see the origin file's comment on
 * `information_schema.sql_identifier` and `array_agg`.
 */
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
