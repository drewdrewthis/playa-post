import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  generateJwtSigningSecret,
  mintSupabaseUserToken,
  readSupabaseApiConfiguration,
  startSupabaseRestTestStack,
  SUPABASE_POSTGREST_ROLES,
  type PostgrestTestEndpoint,
  type SupabaseRestTestStack,
} from '@playa-post/testing';

/**
 * ADR-0002 **B2** — "Hit the Supabase REST endpoint for each `app` table with a valid
 * user JWT → 404/`PGRST106`; catalog-driven, so a newly exposed schema fails."
 *
 * B1, B3 and B4 are catalog and privilege facts, assertable against bare Postgres. B2 is
 * not: it is a statement about the **REST layer**, and `startPostgresTestDatabase()` boots
 * a database with no REST layer in front of it. The manifest said so, and refused to let
 * the row be closed by asserting `supabase/config.toml` instead — "that would prove the
 * setting, not the behaviour".
 *
 * So this file runs a real PostgREST (ADR-0010), started with the schema list read *from*
 * `supabase/config.toml`. The direction matters: the config is an **input** to the server
 * under test, never the subject of an assertion. Add `"app"` to `[api] schemas` and no
 * string compare goes red — the server starts exposing the schema, and the assertions
 * below fail because product tables become reachable. That is what "catalog-driven, so a
 * newly exposed schema fails" has to mean to be worth anything.
 *
 * ## The failure mode this file is designed against
 *
 * Every assertion here is of the form "the request did not succeed", and there are many
 * boring reasons a request does not succeed: a mis-signed token, a container that booted
 * but never loaded its schema cache (PostgREST answers `503 PGRST002` forever if any
 * listed schema is missing — observed, and the reason the harness creates them), a wrong
 * port. Each of those turns this control into a test that cannot fail.
 *
 * The "harness credibility" block is the guard: it proves this suite can reach a table,
 * with this token, over this connection, *before* any denial is asserted. The control at
 * the bottom closes the other half — it exposes `app` deliberately and shows the denial
 * changes shape, so `PGRST106` is attributable to schema exposure and nothing else.
 */

/** A table in an exposed schema, so "the harness can read something" is provable. */
const REACHABLE_PROBE_TABLE = 'b2_harness_reachable';

interface PostgrestOutcome {
  readonly status: number;
  /** PostgREST's own error code, or `null` on success. */
  readonly code: string | null;
}

describe('ADR-0002 B2 — PostgREST cannot reach schema app', () => {
  const exposedSchemas = readSupabaseApiConfiguration().exposedSchemas;
  const jwtSecret = generateJwtSigningSecret();

  let stack: SupabaseRestTestStack;
  let endpoint: PostgrestTestEndpoint;
  /** Bare `relname`s — PostgREST addresses relations unqualified, not `app.foo`. */
  let appTables: readonly string[];
  /** Bare `proname`s, addressed as `/rpc/<name>`. */
  let appFunctions: readonly string[];
  const tokens = new Map<string, string>();

  beforeAll(async () => {
    stack = await startSupabaseRestTestStack();
    appTables = await listAppTables();
    appFunctions = await listAppFunctions();

    // Created before the server starts: PostgREST builds its schema cache at boot, so a
    // table created afterwards is invisible and the credibility control would fail for a
    // reason that has nothing to do with what it is checking.
    const { client } = stack.database;
    await client.query(
      `create table public.${REACHABLE_PROBE_TABLE} (id int primary key, note text)`,
    );
    await client.query(`insert into public.${REACHABLE_PROBE_TABLE} values (1, 'reachable')`);
    await client.query(`grant usage on schema public to ${SUPABASE_POSTGREST_ROLES.join(', ')}`);
    await client.query(
      `grant select on public.${REACHABLE_PROBE_TABLE} to ${SUPABASE_POSTGREST_ROLES.join(', ')}`,
    );

    endpoint = await stack.startPostgrest({ exposedSchemas, jwtSecret });

    for (const role of SUPABASE_POSTGREST_ROLES) {
      tokens.set(role, await mintSupabaseUserToken({ secret: jwtSecret, role }));
    }
  });

  afterAll(async () => {
    await stack?.stop();
  });

  /**
   * Ordinary tables in `app`, by bare name, from the catalog.
   *
   * Catalog-driven for the same reason B1 is: a table a future migration adds is covered
   * without anyone remembering this file exists. That property is half of B2's assertion,
   * not a convenience.
   */
  async function listAppTables(): Promise<readonly string[]> {
    const { rows } = await stack.database.client.query<{ relname: string }>(
      `select c.relname
         from pg_catalog.pg_class c
         join pg_catalog.pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'app' and c.relkind = 'r'
        order by 1`,
    );
    return rows.map((row) => row.relname);
  }

  /**
   * Functions in `app`, by bare name.
   *
   * Deduplicated: PostgREST addresses an RPC by name, so two overloads are one endpoint,
   * and asserting the same URL twice would inflate the count without widening the check.
   */
  async function listAppFunctions(): Promise<readonly string[]> {
    const { rows } = await stack.database.client.query<{ proname: string }>(
      `select distinct p.proname
         from pg_catalog.pg_proc p
         join pg_catalog.pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'app'
        order by 1`,
    );
    return rows.map((row) => row.proname);
  }

  /** One request to `endpoint`, reduced to the pair every assertion below compares on. */
  async function call(
    path: string,
    {
      token,
      method = 'GET',
      headers = {},
      baseUrl = endpoint.baseUrl,
    }: {
      token?: string;
      method?: string;
      headers?: Record<string, string>;
      baseUrl?: string;
    } = {},
  ): Promise<PostgrestOutcome> {
    const response = await fetch(`${baseUrl}/${path}`, {
      method,
      headers: {
        ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
        ...(method === 'GET' ? {} : { 'content-type': 'application/json' }),
        ...headers,
      },
      ...(method === 'GET' ? {} : { body: '{}' }),
    });

    const text = await response.text();
    let code: string | null = null;
    try {
      const parsed: unknown = JSON.parse(text);
      if (typeof parsed === 'object' && parsed !== null && 'code' in parsed) {
        const raw = (parsed as { code?: unknown }).code;
        code = typeof raw === 'string' ? raw : null;
      }
    } catch {
      // A non-JSON body is itself a finding; `status` still carries the outcome.
    }

    return { status: response.status, code };
  }

  function tokenFor(role: string): string {
    const token = tokens.get(role);
    if (token === undefined) {
      throw new Error(`no token minted for role ${role}`);
    }
    return token;
  }

  describe('harness credibility — every B2 assertion is void if one of these fails', () => {
    it('enumerates at least one table in app, so the rows below cannot pass vacuously', () => {
      // Identical guard to B1's: "denied on every table" over an empty set is green and
      // worthless. The canary table in the baseline migration keeps it honest until M2.
      expect(appTables.length).toBeGreaterThan(0);
    });

    it('serves a real request — the minted token reads an exposed table', async () => {
      // The load-bearing control. Without it, a 503 from a server that never loaded its
      // schema cache, or a token PostgREST refuses outright, reads exactly like "denied".
      const outcome = await call(REACHABLE_PROBE_TABLE, { token: tokenFor('authenticated') });

      expect(outcome).toEqual({ status: 200, code: null });
    });

    it('rejects a token signed with a different secret', async () => {
      // And this is what makes the success above informative: acceptance is earned by the
      // signature, not granted to any string in the Authorization header.
      const forged = await mintSupabaseUserToken({
        secret: generateJwtSigningSecret(),
        role: 'authenticated',
      });

      expect(await call(REACHABLE_PROBE_TABLE, { token: forged })).toEqual({
        status: 401,
        code: 'PGRST301',
      });
    });

    it('answers as a server configured from supabase/config.toml, read back over HTTP', async () => {
      // Read back from the *running server*, not from the object this test handed it.
      // Comparing `endpoint.exposedSchemas` to `exposedSchemas` would be one array
      // reference compared with itself — green even if the container were started with a
      // completely different `PGRST_DB_SCHEMAS`.
      //
      // A profile that is exposed accepts the request and then fails to find the relation
      // (404 PGRST205); a profile that is not exposed is rejected outright (406 PGRST106).
      // The difference is exactly `db-schemas`, so this enumerates it behaviourally.
      const observed = await Promise.all(
        exposedSchemas.map(async (schema) => ({
          schema,
          ...(await call('b2_no_such_relation_probe', {
            token: tokenFor('authenticated'),
            headers: { 'accept-profile': schema },
          })),
        })),
      );

      expect(observed).toEqual(
        exposedSchemas.map((schema) => ({ schema, status: 404, code: 'PGRST205' })),
      );
      // …and `app` is not among them, by the same probe. This is the one-line statement of
      // the whole row, before the per-table sweep below spells it out.
      expect(
        await call('b2_no_such_relation_probe', {
          token: tokenFor('authenticated'),
          headers: { 'accept-profile': 'app' },
        }),
      ).toEqual({ status: 406, code: 'PGRST106' });
    });
  });

  describe('B2 — every table in app is unreachable, for every Supabase principal', () => {
    it.each(SUPABASE_POSTGREST_ROLES)(
      '%s: an app table addressed by name is not found (404 PGRST205)',
      async (role) => {
        // Covers the misconfiguration where `app` is exposed *and first*, making it the
        // default profile — then these become reachable without any explicit header.
        // A 200 here would also mean an exposed schema serves a relation named like an
        // `app` table, which is its own finding.
        const observed = await Promise.all(
          appTables.map(async (table) => ({
            table,
            ...(await call(table, { token: tokenFor(role) })),
          })),
        );

        expect(observed).toEqual(
          appTables.map((table) => ({ table, status: 404, code: 'PGRST205' })),
        );
      },
    );

    it.each(SUPABASE_POSTGREST_ROLES)(
      '%s: schema app addressed explicitly is refused (406 PGRST106)',
      async (role) => {
        // The row's named code. `Accept-Profile` is PostgREST's supported way to target a
        // non-default schema, so this is the request an attacker who has read ADR-0002
        // actually sends — and the assertion that goes red the moment `app` joins the
        // exposed list.
        const observed = await Promise.all(
          appTables.map(async (table) => ({
            table,
            ...(await call(table, {
              token: tokenFor(role),
              headers: { 'accept-profile': 'app' },
            })),
          })),
        );

        expect(observed).toEqual(
          appTables.map((table) => ({ table, status: 406, code: 'PGRST106' })),
        );
      },
    );

    it('refuses writes into app, not only reads', async () => {
      // B1 asserts the same asymmetry at the SQL layer. A control that only ever checks
      // SELECT is one INSERT away from irrelevant. Asserted as `service_role`, the
      // strongest principal: if the weakest were used, a reader could not tell whether
      // the denial came from exposure or from privileges.
      const writeMethods = ['POST', 'PATCH', 'DELETE'];
      const observed = await Promise.all(
        writeMethods.flatMap((method) =>
          appTables.map(async (table) => ({
            method,
            table,
            ...(await call(table, {
              token: tokenFor('service_role'),
              method,
              headers: { 'content-profile': 'app' },
            })),
          })),
        ),
      );

      expect(
        observed.filter(({ status, code }) => status !== 406 || code !== 'PGRST106'),
      ).toEqual([]);
      // Derived, not a literal: adding a method above must not leave a stale count here.
      expect(observed).toHaveLength(writeMethods.length * appTables.length);
    });

    it('refuses RPC into app, which is the other door into a schema', async () => {
      // Exposing the schema publishes every function in it, not only the tables — so this
      // enumerates `pg_proc` the way the table sweep enumerates `pg_class`, rather than
      // naming one function. A hardcoded name would keep passing after that function was
      // renamed, which is the opposite of catalog-driven.
      expect(appFunctions.length).toBeGreaterThan(0);

      const observed = await Promise.all(
        appFunctions.map(async (routine) => ({
          routine,
          ...(await call(`rpc/${routine}`, {
            token: tokenFor('authenticated'),
            method: 'POST',
            headers: { 'content-profile': 'app' },
          })),
        })),
      );

      expect(observed).toEqual(
        appFunctions.map((routine) => ({ routine, status: 406, code: 'PGRST106' })),
      );
    });

    it('advertises no app relation in its OpenAPI document', async () => {
      // The discovery surface, not the data surface: PostgREST publishes a schema document
      // at `/`, and a leak there tells an attacker what to ask for before any request is
      // denied.
      //
      // ⚠ Read this as a check on §1 **and** §3 together, not on §1 alone. PostgREST's
      // default `openapi-mode` is `follow-privileges`, so the document is already filtered
      // by what this token may touch — and the token holds nothing in `app`. Exposing the
      // schema on its own therefore does *not* redden this test; the control at the bottom
      // of this file is what isolates §1.
      const response = await fetch(`${endpoint.baseUrl}/`, {
        headers: { authorization: `Bearer ${tokenFor('authenticated')}` },
      });
      const document = (await response.json()) as {
        paths?: Record<string, unknown>;
        definitions?: Record<string, unknown>;
      };
      const published = [
        ...Object.keys(document.paths ?? {}),
        ...Object.keys(document.definitions ?? {}),
      ];

      // Vacuity guard, same argument as the table count: an empty document mentions no
      // `app` table either. The probe table must be in it for the absence to mean anything.
      expect(published).toContain(`/${REACHABLE_PROBE_TABLE}`);

      // Exact keys, not a substring scan. PostgREST publishes a relation as the path
      // `/name` and the definition `name`, so exact is complete — while a substring match
      // would eventually redden on an unrelated table whose name contains an `app` table's.
      const leaked = [
        ...appTables.flatMap((table) => [`/${table}`, table]),
        ...appFunctions.map((routine) => `/rpc/${routine}`),
      ];
      expect(published.filter((entry) => leaked.includes(entry))).toEqual([]);
    });
  });

  describe('B2 — control: this harness reaches schema app when app is exposed', () => {
    it('is stopped by the ADR-0002 §3 revoke set instead, with a different failure', async () => {
      // The falsification, installed rather than performed once by hand. Same database,
      // same token, same client — only `db-schemas` differs. If the denials above were
      // caused by a broken harness rather than by ADR-0002 §1, this would deny
      // identically; it does not.
      //
      // What it shows on the way past: exposure alone is still not a breach. The request
      // gets through the schema gate and is stopped by `revoke all on schema app`, which
      // is §1 and §3 being independent lines rather than one control counted twice.
      const exposedEndpoint = await stack.startPostgrest({
        exposedSchemas: [...exposedSchemas, 'app'],
        jwtSecret,
      });

      try {
        const observed = await Promise.all(
          SUPABASE_POSTGREST_ROLES.flatMap((role) =>
            appTables.map(async (table) => ({
              role,
              table,
              ...(await call(table, {
                token: tokenFor(role),
                headers: { 'accept-profile': 'app' },
                baseUrl: exposedEndpoint.baseUrl,
              })),
            })),
          ),
        );

        // `42501` is `permission denied for schema app` — PostgreSQL's code, surfaced by
        // PostgREST, which means the request reached the database. Emphatically not
        // `PGRST106`: that is the code this control proves is caused by non-exposure.
        // PostgREST maps the same denial to HTTP 401 for `anon` (unauthenticated
        // semantics) and 403 for authenticated roles — measured, not recalled.
        expect(
          observed.filter(
            ({ role, status, code }) =>
              status !== (role === 'anon' ? 401 : 403) || code !== '42501',
          ),
        ).toEqual([]);
        expect(observed).toHaveLength(SUPABASE_POSTGREST_ROLES.length * appTables.length);
      } finally {
        await exposedEndpoint.stop();
      }
    });
  });
});
