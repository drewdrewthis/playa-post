import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startPostgresTestDatabase, type PostgresTestDatabase } from '@playa-post/testing';

/**
 * L3b-notify's migration-shape suite for `app.notify_me_queries`, mirroring
 * `modules/bulletins/tests/integration/bulletins-schema-migration.integration.test.ts`'s
 * discipline: catalog facts, never a read of the SQL file.
 *
 * m2-lane-briefs.md §L3b-notify pins two things about this table's shape beyond the
 * standard ADR-0002 §4 backstop: **the primary key is on `owner_id`** (D1 as a
 * database constraint, ADR-0007:77-79) and it **stores the source text plus the
 * validated AST with an `ast_version`** (ADR-0007:70-72).
 */
describe('L3b-notify migration — app.notify_me_queries', () => {
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
        where table_schema = 'app' and table_type = 'BASE TABLE' and table_name = 'notify_me_queries'`,
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
        where n.nspname = 'app' and c.relname = 'notify_me_queries'`,
    );

    expect(rows, 'app.notify_me_queries must exist to assert its RLS shape').toEqual([
      { rls_enabled: true, rls_forced: true, owner: 'app_migrator' },
    ]);
  });

  it('grants app_rw all DML and no privilege to anon/authenticated/public', async () => {
    const { rows: grantRows } = await database.client.query<{ has_privilege: boolean }>(
      `select pg_catalog.has_table_privilege('app_rw', 'app.notify_me_queries', 'SELECT,INSERT,UPDATE,DELETE') as has_privilege`,
    );
    expect(grantRows[0]?.has_privilege).toBe(true);

    for (const grantee of ['anon', 'authenticated', 'public']) {
      const { rows } = await database.client.query<{ has_privilege: boolean }>(
        `select pg_catalog.has_table_privilege($1, 'app.notify_me_queries',
            'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') as has_privilege`,
        [grantee],
      );
      expect(rows[0]?.has_privilege, `${grantee} must hold no privilege on app.notify_me_queries`).toBe(
        false,
      );
    }
  });

  it('has its primary key on owner_id, not a surrogate id (D1, ADR-0007:77-79)', async () => {
    const isKeyed = await hasPrimaryKeyConstraint(database, 'app.notify_me_queries', ['owner_id']);
    expect(isKeyed, 'the primary key must be owner_id — this IS the "one query per user" constraint').toBe(
      true,
    );
  });

  describe('source text + validated AST (ADR-0007:70-72)', () => {
    it('has a not-null source_text column', async () => {
      const { rows } = await database.client.query<{ is_nullable: string }>(
        `select is_nullable from information_schema.columns
          where table_schema = 'app' and table_name = 'notify_me_queries' and column_name = 'source_text'`,
      );
      expect(rows[0], 'app.notify_me_queries.source_text must exist').toBeDefined();
      expect(rows[0]?.is_nullable).toBe('NO');
    });

    it('has a not-null jsonb ast column', async () => {
      const { rows } = await database.client.query<{ is_nullable: string; data_type: string }>(
        `select is_nullable, data_type from information_schema.columns
          where table_schema = 'app' and table_name = 'notify_me_queries' and column_name = 'ast'`,
      );
      expect(rows[0], 'app.notify_me_queries.ast must exist').toBeDefined();
      expect(rows[0]?.is_nullable).toBe('NO');
      expect(rows[0]?.data_type).toBe('jsonb');
    });

    it('has a not-null integer ast_version column, separate from ast itself', async () => {
      const { rows } = await database.client.query<{ is_nullable: string; data_type: string }>(
        `select is_nullable, data_type from information_schema.columns
          where table_schema = 'app' and table_name = 'notify_me_queries' and column_name = 'ast_version'`,
      );
      expect(rows[0], 'app.notify_me_queries.ast_version must exist').toBeDefined();
      expect(rows[0]?.is_nullable).toBe('NO');
      expect(rows[0]?.data_type).toMatch(/int/i);
    });
  });

  it('has a not-null integer version column (ADR-0005 optimistic concurrency)', async () => {
    const { rows } = await database.client.query<{ is_nullable: string; data_type: string }>(
      `select is_nullable, data_type from information_schema.columns
        where table_schema = 'app' and table_name = 'notify_me_queries' and column_name = 'version'`,
    );
    expect(rows[0], 'app.notify_me_queries.version must exist').toBeDefined();
    expect(rows[0]?.is_nullable).toBe('NO');
    expect(rows[0]?.data_type).toMatch(/int/i);
  });
});

/**
 * Copied from `bulletins-schema-migration.integration.test.ts`'s local copy of the
 * same helper (itself copied from `connections-schema-migration.integration.test.ts`).
 * Kept as a third local copy per those files' own note that the coder is free to
 * promote a shared version in the same PR that removes the duplication — not this
 * suite's job to invent that shared home unasked.
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
