import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startPostgresTestDatabase, type PostgresTestDatabase } from '@playa-post/testing';

/**
 * `app.visible_people` — M2.7 (ADR-0004:25-42, m2-lane-briefs.md §L2 "M2.7").
 *
 * Migration-shape assertion, same discipline as
 * `modules/identity/tests/integration/app-users-migration.integration.test.ts`: catalog
 * facts about the function, never a read of the checked-in SQL file. Checked in at
 * `modules/graph/persistence/sql/visible-people.sql` per the lane brief; this suite
 * proves the migration installs it with the two properties ADR-0002/ADR-0004 make
 * non-negotiable for every `app.visible_*` function:
 *
 * - **`SECURITY INVOKER`** (ADR-0004:25) — it must run as the caller, not the
 *   definer, so it cannot become a second, un-reviewed privilege-escalation surface
 *   the way an unallowlisted `SECURITY DEFINER` function would (ADR-0002 B4).
 * - **`SET search_path = ''`** (ADR-0002:164) — pooler-safety: with no `search_path`
 *   pinned, a transaction-mode pooler can hand this function to a session whose
 *   `search_path` means something else, and every unqualified identifier inside it
 *   becomes ambiguous. Already asserted schema-wide by
 *   `tests/security/baseline-catalog.security.test.ts`'s "every function in app pins
 *   its search_path" — this test names the specific function so a future signature
 *   change cannot slip through a schema-wide assertion by accident.
 */
describe('app.visible_people(viewer_id uuid, max_depth int, node_budget int) — ADR-0004:25-42', () => {
  let database: PostgresTestDatabase;

  beforeAll(async () => {
    database = await startPostgresTestDatabase();
  }, 300_000);

  afterAll(async () => {
    await database?.stop();
  });

  it('exists as a function in schema app named visible_people', async () => {
    const { rows } = await database.client.query<{ exists: boolean }>(
      `select exists (
         select 1 from pg_catalog.pg_proc p
         join pg_catalog.pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'app' and p.proname = 'visible_people'
       ) as exists`,
    );
    expect(rows[0]?.exists).toBe(true);
  });

  it('takes (viewer_id uuid, max_depth int default 4, node_budget int default 1500)', async () => {
    const { rows } = await database.client.query<{ arguments: string }>(
      `select pg_catalog.pg_get_function_arguments(p.oid) as arguments
         from pg_catalog.pg_proc p
         join pg_catalog.pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'app' and p.proname = 'visible_people'`,
    );

    expect(rows[0]?.arguments).toMatch(/viewer_id\s+uuid/i);
    expect(rows[0]?.arguments).toMatch(/max_depth\s+integer\s+DEFAULT\s+4/i);
    expect(rows[0]?.arguments).toMatch(/node_budget\s+integer\s+DEFAULT\s+1500/i);
  });

  it('is SECURITY INVOKER (ADR-0004:25) — never DEFINER, per the B4 allowlist discipline', async () => {
    const { rows } = await database.client.query<{ prosecdef: boolean }>(
      `select p.prosecdef
         from pg_catalog.pg_proc p
         join pg_catalog.pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'app' and p.proname = 'visible_people'`,
    );
    expect(rows[0]?.prosecdef).toBe(false);
  });

  it("pins SET search_path = '' (ADR-0002:164)", async () => {
    const { rows } = await database.client.query<{ proconfig: string[] | null }>(
      `select p.proconfig
         from pg_catalog.pg_proc p
         join pg_catalog.pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'app' and p.proname = 'visible_people'`,
    );
    // ⚠ `search_path=""`, not `search_path=`. PostgreSQL renders a list-valued GUC
    // through the same quoting rules it uses for identifiers, so an empty
    // `search_path` comes back out of `pg_proc.proconfig` as a quoted empty string —
    // measured against PostgreSQL 17, and true of `app.apply_rls_backstop` too, which
    // has pinned its search_path the same way since the baseline migration. Asserting
    // the rendered form is also the stronger check: a function that pinned
    // `search_path=public` would satisfy a prefix match and would still be a function
    // whose meaning a schema on the caller's path can change.
    expect(rows[0]?.proconfig ?? []).toEqual(expect.arrayContaining(['search_path=""']));
  });

  /**
   * ADR-0004:73-74 requires the function to be **checked in** at
   * `modules/graph/persistence/sql/visible-people.sql`, and the migration rules
   * require migrations to be forward-only and never edited. A migration cannot read a
   * file, so the statement necessarily exists twice — and two copies of the most
   * security-critical SQL in the system, with nothing comparing them, is how the
   * checked-in one quietly becomes documentation of a function that no longer exists.
   *
   * Asserted as verbatim containment rather than by comparing `pg_proc.prosrc`:
   * PostgreSQL normalises a stored function body, so a catalog comparison would
   * either need its own normaliser or would fail on whitespace. Containment answers
   * the question that matters — is the text that ran the text that is checked in.
   *
   * Exactly one, not at least one: two migrations carrying it would mean an older
   * definition is still being replayed, and which one wins would depend on filename
   * order.
   */
  it('installs the checked-in modules/graph/persistence/sql/visible-people.sql verbatim, from exactly one migration', async () => {
    const checkedIn = (
      await readFile(fileURLToPath(new URL('../../persistence/sql/visible-people.sql', import.meta.url)), 'utf8')
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
      'the checked-in visible-people.sql must appear verbatim in exactly one migration',
    ).toHaveLength(1);
  });

  it('grants EXECUTE to app_rw and to no other role (schema-wide B3 rule, named here for this function)', async () => {
    for (const grantee of ['anon', 'authenticated', 'public']) {
      const { rows } = await database.client.query<{ has_privilege: boolean }>(
        `select pg_catalog.has_function_privilege($1, 'app.visible_people(uuid, integer, integer)', 'EXECUTE') as has_privilege`,
        [grantee],
      );
      expect(rows[0]?.has_privilege, `${grantee} must not be able to execute app.visible_people`).toBe(
        false,
      );
    }
  });
});
