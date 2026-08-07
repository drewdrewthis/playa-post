import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startPostgresTestDatabase, type PostgresTestDatabase } from '@playa-post/testing';

/**
 * `app.visible_edges` — migration-shape assertions, the same discipline
 * `visible-people-migration.integration.test.ts` and
 * `visible-bulletins-migration.integration.test.ts` hold to: catalog facts about the
 * installed function, never a read of the checked-in SQL file (that read is
 * `visible-edges-sql-composition.unit.test.ts`'s job instead).
 *
 * The two properties ADR-0002/ADR-0004 make non-negotiable for every `app.visible_*`
 * function — **`SECURITY INVOKER`** and **`SET search_path = ''`** — plus that the
 * installed text is the checked-in text, from exactly one migration, executable by
 * `app_rw` alone.
 */
describe('app.visible_edges(viewer_id uuid)', () => {
  let database: PostgresTestDatabase;

  beforeAll(async () => {
    database = await startPostgresTestDatabase();
  }, 300_000);

  afterAll(async () => {
    await database?.stop();
  });

  it('exists as a function in schema app named visible_edges', async () => {
    const { rows } = await database.client.query<{ exists: boolean }>(
      `select exists (
         select 1 from pg_catalog.pg_proc p
         join pg_catalog.pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'app' and p.proname = 'visible_edges'
       ) as exists`,
    );
    expect(rows[0]?.exists).toBe(true);
  });

  it('takes a viewer_id uuid argument', async () => {
    const { rows } = await database.client.query<{ arguments: string }>(
      `select pg_catalog.pg_get_function_arguments(p.oid) as arguments
         from pg_catalog.pg_proc p
         join pg_catalog.pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'app' and p.proname = 'visible_edges'`,
    );
    expect(rows[0]?.arguments).toMatch(/viewer_id\s+uuid/i);
  });

  it('is SECURITY INVOKER (ADR-0004:25) — never DEFINER, per the B4 allowlist discipline', async () => {
    const { rows } = await database.client.query<{ prosecdef: boolean }>(
      `select p.prosecdef
         from pg_catalog.pg_proc p
         join pg_catalog.pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'app' and p.proname = 'visible_edges'`,
    );
    expect(rows[0]?.prosecdef).toBe(false);
  });

  it("pins SET search_path = '' (ADR-0002:164)", async () => {
    const { rows } = await database.client.query<{ proconfig: string[] | null }>(
      `select p.proconfig
         from pg_catalog.pg_proc p
         join pg_catalog.pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'app' and p.proname = 'visible_edges'`,
    );
    // ⚠ `search_path=""`, not `search_path=` — see visible-people-migration's identical
    // comment; measured against PostgreSQL 17.
    expect(rows[0]?.proconfig ?? []).toEqual(expect.arrayContaining(['search_path=""']));
  });

  it('installs the checked-in modules/graph/persistence/sql/visible-edges.sql verbatim, from exactly one migration', async () => {
    const checkedIn = (
      await readFile(
        fileURLToPath(new URL('../../persistence/sql/visible-edges.sql', import.meta.url)),
        'utf8',
      )
    ).trim();

    const migrationsDirectory = database.migrationsDirectory;
    if (migrationsDirectory === null) {
      throw new Error('this suite runs against the repository migrations, not an empty schema');
    }

    const carrying: string[] = [];
    for (const filename of database.appliedMigrations) {
      const text = await readFile(join(migrationsDirectory, filename), 'utf8');
      if (text.includes(checkedIn)) {
        carrying.push(filename);
      }
    }

    expect(
      carrying,
      'the checked-in visible-edges.sql must appear verbatim in exactly one migration',
    ).toHaveLength(1);
  });

  it('grants EXECUTE to app_rw and to no other role', async () => {
    for (const grantee of ['anon', 'authenticated', 'public']) {
      const { rows } = await database.client.query<{ has_privilege: boolean }>(
        `select pg_catalog.has_function_privilege($1, 'app.visible_edges(uuid)', 'EXECUTE') as has_privilege`,
        [grantee],
      );
      expect(
        rows[0]?.has_privilege,
        `${grantee} must not be able to execute app.visible_edges`,
      ).toBe(false);
    }
  });

  it('adds no table — the graph inventory is unchanged by this migration', async () => {
    // The `schema app` inventory assertion is a hand-maintained door
    // (tests/security/app-table-inventory.security.test.ts). Stating here that this
    // migration walks past it deliberately means a future edit that *does* add a table
    // has to notice both files rather than one.
    const { rows } = await database.client.query<{ count: string }>(
      `select count(*)::text as count from pg_tables
        where schemaname = 'app' and tablename like '%edge%'`,
    );
    expect(rows[0]?.count).toBe('0');
  });
});
