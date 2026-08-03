import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startPostgresTestDatabase, type PostgresTestDatabase } from '@playa-post/testing';

import { loadSecurityDefinerAllowlist } from './b-rows';

/**
 * ADR-0002 B1, B3 and B4 against a real Postgres with `supabase/migrations` applied.
 *
 * These three rows are catalog and privilege facts, so they are assertable from the
 * security baseline alone — before any product table exists. The remaining rows need
 * features and are declared `pending` in `b-rows.manifest.json`.
 *
 * The assertions read the catalog and exercise the privileges; they never read the
 * migration file. A table that skips `app.apply_rls_backstop`, or a migration that
 * hand-rolls a subtly different policy, fails here — which is the whole point of
 * asserting the shape rather than the source (ADR-0002 §4).
 */

/**
 * Supabase's PostgREST roles. `SET ROLE`-able, so B1 can exercise them directly —
 * unlike PUBLIC, which is a pseudo-role and is covered by the privilege assertions.
 */
const POSTGREST_ROLES = ['anon', 'authenticated'] as const;

/** Every table privilege PostgreSQL knows. Any one of them held is a leak. */
const ALL_TABLE_PRIVILEGES = 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER';

describe('ADR-0002 security baseline', () => {
  let database: PostgresTestDatabase;
  let appTables: readonly string[];

  beforeAll(async () => {
    database = await startPostgresTestDatabase();
    appTables = await listAppTables();
  });

  afterAll(async () => {
    await database?.stop();
  });

  /**
   * Ordinary tables in `app`, schema-qualified and quoted, from the catalog.
   *
   * Catalog-driven rather than a hand-maintained list: a table added by a future
   * migration is covered by every assertion below without anyone remembering to
   * update this file. That is the property that makes B3 a gate on M2 rather than a
   * snapshot of M1.
   */
  async function listAppTables(): Promise<readonly string[]> {
    const { rows } = await database.client.query<{ qualified_name: string }>(
      `select quote_ident(n.nspname) || '.' || quote_ident(c.relname) as qualified_name
         from pg_catalog.pg_class c
         join pg_catalog.pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'app' and c.relkind = 'r'
        order by 1`,
    );
    return rows.map((row) => row.qualified_name);
  }

  /**
   * Run `statement` as `role` inside a transaction that is always rolled back, and
   * report the SQLSTATE it raised.
   *
   * `SET LOCAL ROLE` rather than a second connection because that is how PostgREST
   * reaches `anon` in production too — and because a role with no password cannot be
   * connected as, which is itself part of the design (ADR-0002 §2: credentials are
   * provisioned out of band, never in a migration).
   */
  async function sqlstateOf(role: string, statement: string): Promise<string> {
    const { client } = database;
    await client.query('begin');
    try {
      await client.query(`set local role ${role}`);
      await client.query(statement);
      return 'no error raised';
    } catch (error) {
      return sqlstateFrom(error);
    } finally {
      await client.query('rollback');
    }
  }

  describe('B1 — anon and authenticated cannot read schema app', () => {
    it('enumerates at least one table, so the rows below cannot pass vacuously', () => {
      // A `for all tables` assertion over an empty set is green and worthless. The
      // canary table in the baseline migration exists to keep this honest until M2
      // brings real tables (ADR-0002 B1: "fails if the enumerated table count is 0").
      expect(appTables.length).toBeGreaterThan(0);
    });

    it.each(POSTGREST_ROLES)(
      'denies %s with SQLSTATE 42501 on every table',
      async (role) => {
        const observed = await Promise.all(
          appTables.map(async (table) => ({
            table,
            sqlstate: await sqlstateOf(role, `select 1 from ${table} limit 1`),
          })),
        );

        expect(observed).toEqual(
          appTables.map((table) => ({ table, sqlstate: '42501' })),
        );
      },
    );

    it('denies writes too, not only reads', async () => {
      const observed = await Promise.all(
        appTables.map(async (table) => ({
          table,
          sqlstate: await sqlstateOf('anon', `delete from ${table}`),
        })),
      );

      expect(observed).toEqual(appTables.map((table) => ({ table, sqlstate: '42501' })));
    });
  });

  describe('B3 — policy shape, ownership, and role attributes', () => {
    it('has RLS enabled, FORCEd, and owned by app_migrator on every table', async () => {
      const { rows } = await database.client.query<{
        table_name: string;
        rls_enabled: boolean;
        rls_forced: boolean;
        owner: string;
      }>(
        `select quote_ident(n.nspname) || '.' || quote_ident(c.relname) as table_name,
                c.relrowsecurity                as rls_enabled,
                c.relforcerowsecurity           as rls_forced,
                pg_catalog.pg_get_userbyid(c.relowner) as owner
           from pg_catalog.pg_class c
           join pg_catalog.pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'app' and c.relkind = 'r'
          order by 1`,
      );

      // FORCE is the clause that stops the owner bypassing RLS silently while
      // `relrowsecurity` still reads true, and ownership drift to `postgres` is the
      // other half of the same hole (ADR-0002 §4).
      expect(rows).toEqual(
        appTables.map((table) => ({
          table_name: table,
          rls_enabled: true,
          rls_forced: true,
          owner: 'app_migrator',
        })),
      );
    });

    it('has exactly the verbatim app_rw_full_access policy on every table', async () => {
      const { rows } = await database.client.query<{
        table_name: string;
        policyname: string;
        permissive: string;
        roles: string;
        cmd: string;
        qual: string | null;
        with_check: string | null;
      }>(
        `select quote_ident(schemaname) || '.' || quote_ident(tablename) as table_name,
                policyname, permissive, roles::text as roles, cmd, qual, with_check
           from pg_catalog.pg_policies
          where schemaname = 'app'
          order by 1, policyname`,
      );

      // Exactly one row per table, and every clause pinned. Omitting `TO` would leave
      // RLS enabled and every naive check green while permitting the whole cluster;
      // `FOR SELECT` instead of `FOR ALL` would break writes and invite a permissive
      // grant as the field fix (ADR-0002 §4).
      expect(rows).toEqual(
        appTables.map((table) => ({
          table_name: table,
          policyname: 'app_rw_full_access',
          permissive: 'PERMISSIVE',
          roles: '{app_rw}',
          cmd: 'ALL',
          qual: 'true',
          with_check: 'true',
        })),
      );
    });

    it('documents every policy, so USING (true) reads as deliberate', async () => {
      const { rows } = await database.client.query<{ table_name: string; description: string }>(
        `select quote_ident(n.nspname) || '.' || quote_ident(c.relname) as table_name,
                coalesce(d.description, '') as description
           from pg_catalog.pg_policy p
           join pg_catalog.pg_class c on c.oid = p.polrelid
           join pg_catalog.pg_namespace n on n.oid = c.relnamespace
           left join pg_catalog.pg_description d
                  on d.objoid = p.oid and d.classoid = 'pg_policy'::regclass
          where n.nspname = 'app'
          order by 1`,
      );

      // The comment is load-bearing documentation, not decoration: it is what stops a
      // reviewer "fixing" an unconditional policy they assume is a mistake.
      for (const row of rows) {
        expect(row.description, `${row.table_name} has an undocumented policy`).toContain(
          'Viewer-scoped authorization lives in the application layer (ADR-0002)',
        );
      }
      expect(rows).toHaveLength(appTables.length);
    });

    it('keeps app_rw least-privileged and a member of nothing', async () => {
      const { rows } = await database.client.query<{
        rolname: string;
        rolsuper: boolean;
        rolbypassrls: boolean;
        memberships: string;
        members: string;
      }>(
        `select r.rolname, r.rolsuper, r.rolbypassrls,
                (select count(*) from pg_catalog.pg_auth_members m where m.member = r.oid)::text
                  as memberships,
                (select count(*) from pg_catalog.pg_auth_members m where m.roleid = r.oid)::text
                  as members
           from pg_catalog.pg_roles r
          where r.rolname = 'app_rw'`,
      );

      // No pg_auth_members row in either direction: app_rw cannot SET ROLE out of
      // itself, and nothing can SET ROLE into it (ADR-0002 §2, B3).
      expect(rows).toEqual([
        {
          rolname: 'app_rw',
          rolsuper: false,
          rolbypassrls: false,
          memberships: '0',
          members: '0',
        },
      ]);
    });

    it('keeps app_migrator unable to bypass RLS', async () => {
      const { rows } = await database.client.query<{
        rolname: string;
        rolsuper: boolean;
        rolbypassrls: boolean;
      }>(
        `select rolname, rolsuper, rolbypassrls
           from pg_catalog.pg_roles where rolname = 'app_migrator'`,
      );

      // NOBYPASSRLS on the owner is what makes FORCE ROW LEVEL SECURITY worth
      // anything if a migrator credential leaks (ADR-0002 Q5).
      expect(rows).toEqual([{ rolname: 'app_migrator', rolsuper: false, rolbypassrls: false }]);
    });

    it('grants no privilege on app to anon, authenticated, or PUBLIC', async () => {
      const { rows } = await database.client.query<{
        grantee: string;
        object_kind: string;
        object_name: string;
      }>(
        `with principals(grantee) as (values ('anon'), ('authenticated'), ('public'))
         select p.grantee, 'schema' as object_kind, 'app' as object_name
           from principals p
          where pg_catalog.has_schema_privilege(p.grantee, 'app', 'USAGE, CREATE')
         union all
         select p.grantee, 'table',
                quote_ident(n.nspname) || '.' || quote_ident(c.relname)
           from principals p
          cross join pg_catalog.pg_class c
           join pg_catalog.pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'app' and c.relkind = 'r'
            and pg_catalog.has_table_privilege(p.grantee, c.oid, '${ALL_TABLE_PRIVILEGES}')
         union all
         select p.grantee, 'sequence',
                quote_ident(n.nspname) || '.' || quote_ident(c.relname)
           from principals p
          cross join pg_catalog.pg_class c
           join pg_catalog.pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'app' and c.relkind = 'S'
            and pg_catalog.has_sequence_privilege(p.grantee, c.oid, 'USAGE, SELECT, UPDATE')
         union all
         select p.grantee, 'function',
                quote_ident(n.nspname) || '.' || quote_ident(pr.proname)
           from principals p
          cross join pg_catalog.pg_proc pr
           join pg_catalog.pg_namespace n on n.oid = pr.pronamespace
          where n.nspname = 'app'
            and pg_catalog.has_function_privilege(p.grantee, pr.oid, 'EXECUTE')
          order by 1, 2, 3`,
      );

      // The function line is the one doing real work: PostgreSQL grants EXECUTE on
      // every new function to PUBLIC by default, so a missing revoke makes each
      // future `app.visible_*` world-executable (ADR-0002 §3).
      expect(rows).toEqual([]);
    });

    it('leaves objects created later just as locked down', async () => {
      // The forward guarantee, asserted behaviourally rather than by reading
      // pg_default_acl — because `ALTER DEFAULT PRIVILEGES ... IN SCHEMA app REVOKE
      // ... FROM PUBLIC` parses, reports success, and does nothing. That silent
      // no-op is the exact bug this test would have caught; see
      // .github/evidence/alter-default-privileges-scope.txt.
      const { client } = database;
      await client.query('begin');
      try {
        await client.query('set local role app_migrator');
        await client.query(`create function app.future_visible_people() returns int
                              language sql as 'select 1'`);
        await client.query('create type app.future_disclosure as enum (\'none\', \'full\')');
        await client.query('create table app.future_bulletins (id bigserial primary key)');

        const { rows } = await client.query<{ grantee: string; leak: string }>(
          `with principals(grantee) as (values ('anon'), ('authenticated'), ('public'))
           select p.grantee, 'function' as leak from principals p
            where pg_catalog.has_function_privilege(
                    p.grantee, 'app.future_visible_people()', 'EXECUTE')
           union all
           select p.grantee, 'type' from principals p
            where pg_catalog.has_type_privilege(p.grantee, 'app.future_disclosure', 'USAGE')
           union all
           select p.grantee, 'table' from principals p
            where pg_catalog.has_table_privilege(
                    p.grantee, 'app.future_bulletins', '${ALL_TABLE_PRIVILEGES}')
           union all
           select p.grantee, 'sequence' from principals p
            where pg_catalog.has_sequence_privilege(
                    p.grantee, 'app.future_bulletins_id_seq', 'USAGE, SELECT, UPDATE')
            order by 1, 2`,
        );

        expect(rows).toEqual([]);
      } finally {
        await client.query('rollback');
      }
    });

    it('still lets app_rw read and write — the backstop permits, it does not block', async () => {
      // RLS enabled with a policy that does not match returns zero rows *silently*.
      // A privacy-config mistake then presents as "the board is empty" and gets
      // debugged as a product bug for a day (ADR-0002 Consequences). Asserting the
      // permit path is what converts that into a loud failure at migration time.
      const { client } = database;
      await client.query('begin');
      try {
        await client.query('set local role app_rw');
        await client.query('insert into app.security_baseline_canary default values');
        const { rows } = await client.query<{ count: string }>(
          'select count(*)::text as count from app.security_baseline_canary',
        );
        expect(rows[0]?.count).toBe('1');

        await client.query('update app.security_baseline_canary set created_at = now()');
        await client.query('delete from app.security_baseline_canary');
      } finally {
        await client.query('rollback');
      }
    });
  });

  describe('B4 — no unallowlisted SECURITY DEFINER function in app', () => {
    it('has no SECURITY DEFINER function outside the checked-in allowlist', async () => {
      const allowlist = loadSecurityDefinerAllowlist();
      const { rows } = await database.client.query<{ function_name: string; config: string }>(
        `select quote_ident(n.nspname) || '.' || quote_ident(p.proname) as function_name,
                coalesce(array_to_string(p.proconfig, ', '), '') as config
           from pg_catalog.pg_proc p
           join pg_catalog.pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'app' and p.prosecdef
          order by 1`,
      );

      // A definer function bypasses the caller's privileges, so one bug in one of
      // these is total. Adding one is a reviewed act, not a line in a migration
      // (ADR-0002 B4, Q2).
      expect(rows.map((row) => row.function_name).filter((name) => !allowlist.includes(name))).toEqual(
        [],
      );
    });

    it('requires every allowlisted definer to pin its search_path', async () => {
      const allowlist = loadSecurityDefinerAllowlist();
      if (allowlist.length === 0) {
        // Vacuous by construction, and correctly so — but say it out loud rather than
        // reporting a green assertion over nothing.
        expect(allowlist).toEqual([]);
        return;
      }

      const { rows } = await database.client.query<{ function_name: string; config: string }>(
        `select quote_ident(n.nspname) || '.' || quote_ident(p.proname) as function_name,
                coalesce(array_to_string(p.proconfig, ', '), '') as config
           from pg_catalog.pg_proc p
           join pg_catalog.pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'app' and p.prosecdef
          order by 1`,
      );

      expect(rows.filter((row) => !row.config.includes('search_path='))).toEqual([]);
    });

    it('rejects an allowlist entry naming a function that does not exist', async () => {
      const allowlist = loadSecurityDefinerAllowlist();
      const { rows } = await database.client.query<{ function_name: string }>(
        `select quote_ident(n.nspname) || '.' || quote_ident(p.proname) as function_name
           from pg_catalog.pg_proc p
           join pg_catalog.pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'app'`,
      );
      const existing = new Set(rows.map((row) => row.function_name));

      // A stale allowlist pre-authorizes a future function that nobody reviewed.
      expect(allowlist.filter((name) => !existing.has(name))).toEqual([]);
    });
  });

  describe('ADR-0002 §5 — every function in app pins its search_path', () => {
    it('leaves no function whose meaning a caller can change', async () => {
      const { rows } = await database.client.query<{ function_name: string; config: string }>(
        `select quote_ident(n.nspname) || '.' || quote_ident(p.proname) as function_name,
                coalesce(array_to_string(p.proconfig, ', '), '') as config
           from pg_catalog.pg_proc p
           join pg_catalog.pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'app'
          order by 1`,
      );

      // Without `SET search_path`, a caller's search_path decides which `bulletins` a
      // function body means. Under a transaction-mode pooler that is not a
      // theoretical risk (ADR-0002 §5).
      expect(rows.filter((row) => !row.config.includes('search_path='))).toEqual([]);
    });
  });
});

/** PostgreSQL error codes arrive on `error.code`; anything else is a bug in the test. */
function sqlstateFrom(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const { code } = error as { code?: unknown };
    if (typeof code === 'string') {
      return code;
    }
  }
  return `non-postgres error: ${String(error)}`;
}
