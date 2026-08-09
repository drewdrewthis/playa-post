import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startPostgresTestDatabase, type PostgresTestDatabase } from '@playa-post/testing';

/**
 * Lane L1's migration, asserted by catalog shape rather than by reading the SQL file
 * — the same discipline `tests/security/baseline-catalog.security.test.ts` uses for
 * ADR-0002 B1/B3/B4 (see that file's docstring). This is not a B-row itself
 * (m2-lane-briefs.md:373: "no B-rows flipped" in L1) — `app.users` is what makes
 * B1/B3/B4 non-vacuous against real data for the first time, and this suite is what
 * proves the migration that adds it did the three things the lane brief specifies:
 *
 * 1. `create table app.users (...)` verbatim from ADR-0008:22-34 — including the four
 *    `not null` constraints the brief calls out as easy to silently drop
 *    (`auth_user_id`, `handle`, `display_name`, `created_at`).
 * 2. `select app.apply_rls_backstop('app.users')` plus the per-table grants.
 * 3. `drop table app.security_baseline_canary` and
 *    `drop sequence app.security_baseline_canary_seq` — the canary's whole purpose
 *    (`supabase/migrations/20260730195954_create_security_baseline.sql` §5) was to
 *    stand in until here.
 */
describe('app.users migration (ADR-0008:22-34, M1b.5/M2.4)', () => {
  let database: PostgresTestDatabase;

  beforeAll(async () => {
    database = await startPostgresTestDatabase();
  }, 300_000);

  afterAll(async () => {
    await database?.stop();
  });

  describe('app.users columns', () => {
    it('has exactly the ADR-0008:22-34 columns, in the same nullability', async () => {
      const { rows } = await database.client.query<{
        column_name: string;
        data_type: string;
        udt_name: string;
        is_nullable: string;
        column_default: string | null;
      }>(
        `select column_name, data_type, udt_name, is_nullable, column_default
           from information_schema.columns
          where table_schema = 'app' and table_name = 'users'
          order by ordinal_position`,
      );

      const byName = Object.fromEntries(rows.map((row) => [row.column_name, row]));

      // The four not-null constraints the first draft of the lane brief silently
      // dropped (m2-lane-briefs.md:350-352) — asserted individually so a future
      // regression names exactly which column lost its constraint.
      expect(byName['auth_user_id']?.is_nullable).toBe('NO');
      expect(byName['handle']?.is_nullable).toBe('NO');
      expect(byName['display_name']?.is_nullable).toBe('NO');
      expect(byName['created_at']?.is_nullable).toBe('NO');

      // Nullable by design (ADR-0008:26-30): avatar_path, deactivated_at, erased_at.
      expect(byName['avatar_path']?.is_nullable).toBe('YES');
      expect(byName['deactivated_at']?.is_nullable).toBe('YES');
      expect(byName['erased_at']?.is_nullable).toBe('YES');

      // `udt_name`, not `data_type`: `information_schema` reports any type outside
      // `pg_catalog` as the literal string `USER-DEFINED` and puts the real name in
      // `udt_name`, so asserting `data_type === 'citext'` can never pass for an
      // extension type — measured on postgres:17. Asserting the column is `citext`
      // is the point; which catalog field carries that fact is not.
      expect(byName['handle']?.udt_name).toBe('citext');
      expect(byName['status']?.column_default).toContain('active');
      expect(byName['version']?.column_default).toContain('1');

      // 20260809140000: the "who can see you at all" radius. `'anyone'` by default —
      // the column landed on a network whose members never chose anything, and
      // silently hiding people who had been visible would read as data loss.
      expect(byName['visible_to_distance']?.is_nullable).toBe('NO');
      expect(byName['visible_to_distance']?.column_default).toContain('anyone');

      expect(Object.keys(byName).sort()).toEqual(
        [
          'id',
          'auth_user_id',
          'handle',
          'display_name',
          'avatar_path',
          'status',
          'created_at',
          'deactivated_at',
          'erased_at',
          'version',
          'visible_to_distance',
        ].sort(),
      );
    });

    it('has a unique constraint on auth_user_id (rule 2 — the only bridge to auth.users)', async () => {
      const isUnique = await hasUniqueConstraint(database, 'app.users', ['auth_user_id']);
      expect(isUnique).toBe(true);
    });

    it('has a unique constraint on handle (citext-collation uniqueness, rule 5)', async () => {
      const isUnique = await hasUniqueConstraint(database, 'app.users', ['handle']);
      expect(isUnique).toBe(true);
    });

    it('has no foreign key from auth_user_id to auth.users (rule 2 — deliberately not a cross-schema FK)', async () => {
      const { rows } = await database.client.query<{ constraint_name: string }>(
        `select tc.constraint_name
           from information_schema.table_constraints tc
           join information_schema.key_column_usage kcu
             on kcu.constraint_name = tc.constraint_name
          where tc.constraint_type = 'FOREIGN KEY'
            and tc.table_schema = 'app'
            and tc.table_name = 'users'
            and kcu.column_name = 'auth_user_id'`,
      );

      expect(rows).toEqual([]);
    });
  });

  describe('RLS backstop applied to app.users (ADR-0002 §4)', () => {
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
          where n.nspname = 'app' and c.relname = 'users'`,
      );

      expect(rows).toEqual([
        { rls_enabled: true, rls_forced: true, owner: 'app_migrator' },
      ]);
    });

    it('has exactly the verbatim app_rw_full_access policy', async () => {
      const { rows } = await database.client.query<{ policyname: string; roles: string; cmd: string }>(
        `select policyname, roles::text as roles, cmd
           from pg_catalog.pg_policies
          where schemaname = 'app' and tablename = 'users'`,
      );

      expect(rows).toEqual([{ policyname: 'app_rw_full_access', roles: '{app_rw}', cmd: 'ALL' }]);
    });

    it('grants app_rw select/insert/update/delete on app.users, and no privilege to anon/authenticated/public', async () => {
      const grantedToAppRw = await hasAllDmlPrivileges(database, 'app.users', 'app_rw');
      expect(grantedToAppRw).toBe(true);

      for (const grantee of ['anon', 'authenticated', 'public']) {
        const { rows } = await database.client.query<{ has_privilege: boolean }>(
          `select pg_catalog.has_table_privilege($1, 'app.users',
              'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') as has_privilege`,
          [grantee],
        );
        expect(rows[0]?.has_privilege, `${grantee} must hold no privilege on app.users`).toBe(
          false,
        );
      }
    });
  });

  describe('the security baseline canary is retired by this migration', () => {
    it('drops app.security_baseline_canary', async () => {
      const { rows } = await database.client.query<{ exists: boolean }>(
        `select exists (
           select 1 from pg_catalog.pg_class c
           join pg_catalog.pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'app' and c.relname = 'security_baseline_canary'
         ) as exists`,
      );

      expect(rows[0]?.exists).toBe(false);
    });

    it('drops app.security_baseline_canary_seq', async () => {
      const { rows } = await database.client.query<{ exists: boolean }>(
        `select exists (
           select 1 from pg_catalog.pg_class c
           join pg_catalog.pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'app' and c.relname = 'security_baseline_canary_seq'
         ) as exists`,
      );

      expect(rows[0]?.exists).toBe(false);
    });
  });

  describe('no email column anywhere in schema app (ADR-0008:20)', () => {
    it('is a one-line fitness assertion that never gets written later (m2-lane-briefs.md:390)', async () => {
      const { rows } = await database.client.query<{ table_name: string; column_name: string }>(
        `select table_name, column_name
           from information_schema.columns
          where table_schema = 'app' and column_name = 'email'`,
      );

      expect(rows).toEqual([]);
    });
  });
});

async function hasUniqueConstraint(
  database: PostgresTestDatabase,
  qualifiedTable: string,
  columns: readonly string[],
): Promise<boolean> {
  const [schema, table] = qualifiedTable.split('.');
  const { rows } = await database.client.query<{ columns: string[] }>(
    // ⚠ `::text` is load-bearing, not tidying. `key_column_usage.column_name` is
    // `information_schema.sql_identifier`, a domain over `name`, so `array_agg` yields
    // an array of *that* type — a database-local OID `node-postgres` has no parser
    // for. Without the cast the driver hands back the raw literal `"{auth_user_id}"`
    // as a **string**, `[...row.columns]` spreads it into fifteen characters, and this
    // helper answers `false` for every table that has ever existed. Casting to `text`
    // produces `text[]` (OID 1009), which the driver does parse into a real array.
    `select array_agg(kcu.column_name::text order by kcu.ordinal_position) as columns
       from information_schema.table_constraints tc
       join information_schema.key_column_usage kcu
         on kcu.constraint_name = tc.constraint_name and kcu.table_schema = tc.table_schema
      where tc.constraint_type = 'UNIQUE'
        and tc.table_schema = $1
        and tc.table_name = $2
      group by tc.constraint_name`,
    [schema, table],
  );

  const expected = [...columns].sort();

  return rows.some((row) => {
    // A guard rather than a cast: the failure above was silent — a string is iterable,
    // so the old comparison ran happily on characters and reported a missing
    // constraint. If the driver ever stops handing back an array again, this says so
    // instead of blaming the schema.
    if (!Array.isArray(row.columns)) {
      throw new TypeError(
        `expected an array of column names from array_agg, received ${typeof row.columns}: ` +
          `${JSON.stringify(row.columns)}. The ::text cast in this query is what makes ` +
          `node-postgres parse it as text[].`,
      );
    }

    const actual = [...row.columns].sort();
    return actual.length === expected.length && actual.every((c, i) => c === expected[i]);
  });
}

async function hasAllDmlPrivileges(
  database: PostgresTestDatabase,
  qualifiedTable: string,
  role: string,
): Promise<boolean> {
  const { rows } = await database.client.query<{ has_privilege: boolean }>(
    `select pg_catalog.has_table_privilege($1, $2, 'SELECT,INSERT,UPDATE,DELETE') as has_privilege`,
    [role, qualifiedTable],
  );
  return rows[0]?.has_privilege ?? false;
}
