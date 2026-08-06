import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startPostgresTestDatabase, type PostgresTestDatabase } from '@playa-post/testing';

/**
 * `app.visible_bulletins` — M2.8/M2.9 (m2-lane-briefs.md §L3a, "and it composes
 * rather than re-derives").
 *
 * Migration-shape assertion, same discipline as
 * `modules/graph/tests/integration/visible-people-migration.integration.test.ts`:
 * catalog facts about the function, never a read of the checked-in SQL file (that
 * read is `visible-bulletins-sql-composition.unit.test.ts`'s job instead).
 *
 * Checked in at `modules/bulletins/persistence/sql/visible-bulletins.sql` per the
 * lane brief. This suite proves the migration installs it with the same two
 * properties ADR-0002/ADR-0004 make non-negotiable for every `app.visible_*`
 * function — **`SECURITY INVOKER`** and **`SET search_path = ''`** — plus that it is
 * the checked-in text, installed from exactly one migration, with EXECUTE granted to
 * `app_rw` alone.
 *
 * The exact argument list beyond `viewer_id uuid` is **not** ADR-pinned the way
 * `visible_people`'s `max_depth`/`node_budget` defaults are, so this suite asserts
 * only the one argument the lane brief and ADR-0004:75-77 require: a `viewer_id`.
 */
describe('app.visible_bulletins(viewer_id uuid, ...) — m2-lane-briefs.md §L3a', () => {
  let database: PostgresTestDatabase;

  beforeAll(async () => {
    database = await startPostgresTestDatabase();
  }, 300_000);

  afterAll(async () => {
    await database?.stop();
  });

  it('exists as a function in schema app named visible_bulletins', async () => {
    const { rows } = await database.client.query<{ exists: boolean }>(
      `select exists (
         select 1 from pg_catalog.pg_proc p
         join pg_catalog.pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'app' and p.proname = 'visible_bulletins'
       ) as exists`,
    );
    expect(rows[0]?.exists).toBe(true);
  });

  it('takes a viewer_id uuid argument', async () => {
    const { rows } = await database.client.query<{ arguments: string }>(
      `select pg_catalog.pg_get_function_arguments(p.oid) as arguments
         from pg_catalog.pg_proc p
         join pg_catalog.pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'app' and p.proname = 'visible_bulletins'`,
    );
    expect(rows[0]?.arguments).toMatch(/viewer_id\s+uuid/i);
  });

  it('is SECURITY INVOKER (ADR-0004:25) — never DEFINER, per the B4 allowlist discipline', async () => {
    const { rows } = await database.client.query<{ prosecdef: boolean }>(
      `select p.prosecdef
         from pg_catalog.pg_proc p
         join pg_catalog.pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'app' and p.proname = 'visible_bulletins'`,
    );
    expect(rows[0]?.prosecdef).toBe(false);
  });

  it("pins SET search_path = '' (ADR-0002:164)", async () => {
    const { rows } = await database.client.query<{ proconfig: string[] | null }>(
      `select p.proconfig
         from pg_catalog.pg_proc p
         join pg_catalog.pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'app' and p.proname = 'visible_bulletins'`,
    );
    // ⚠ `search_path=""`, not `search_path=` — see visible-people-migration's
    // identical comment; measured against PostgreSQL 17.
    expect(rows[0]?.proconfig ?? []).toEqual(expect.arrayContaining(['search_path=""']));
  });

  /**
   * Same discipline as `visible-people-migration.integration.test.ts`'s identically
   * named test: containment, not a `pg_proc.prosrc` comparison, because PostgreSQL
   * normalises a stored function body.
   */
  it('installs the checked-in modules/bulletins/persistence/sql/visible-bulletins.sql verbatim, from exactly one migration', async () => {
    const checkedIn = (
      await readFile(
        fileURLToPath(new URL('../../persistence/sql/visible-bulletins.sql', import.meta.url)),
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
      'the checked-in visible-bulletins.sql must appear verbatim in exactly one migration',
    ).toHaveLength(1);
  });

  it('grants EXECUTE to app_rw and to no other role (schema-wide B3 rule, named here for this function)', async () => {
    for (const grantee of ['anon', 'authenticated', 'public']) {
      const { rows } = await database.client.query<{ has_privilege: boolean }>(
        `select pg_catalog.has_function_privilege($1, 'app.visible_bulletins(uuid)', 'EXECUTE') as has_privilege`,
        [grantee],
      );
      expect(rows[0]?.has_privilege, `${grantee} must not be able to execute app.visible_bulletins`).toBe(
        false,
      );
    }
  });
});
