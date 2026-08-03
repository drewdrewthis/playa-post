import { randomBytes, randomUUID } from 'node:crypto';

import {
  GenericContainer,
  Network,
  Wait,
  type StartedNetwork,
  type StartedTestContainer,
} from 'testcontainers';

import {
  startPostgresTestDatabase,
  type PostgresTestDatabase,
  type StartPostgresTestDatabaseOptions,
} from './postgres-test-database';

/**
 * The PostgREST image the ADR-0002 B2 harness runs.
 *
 * Supabase's own build, from AWS public ECR, rather than upstream `postgrest/postgrest`:
 * it is the binary a real Supabase project serves the Data API with, and public ECR has
 * no anonymous pull-rate limit, so the security job does not inherit Docker Hub's.
 *
 * Observed provenance: `supabase start` on CLI 2.110.0 leaves exactly this tag in the
 * local image cache, and the server self-reports `Starting PostgREST 14.15`. Nothing
 * mechanically couples the two — the CLI does not publish its image map in a form a test
 * can read — so **bump this by hand when the CLI's pin moves**, the same standing
 * obligation `POSTGRES_TEST_IMAGE` carries against `db.major_version`.
 */
export const POSTGREST_TEST_IMAGE = 'public.ecr.aws/supabase/postgrest:v14.15';

/**
 * The roles a Supabase project's PostgREST can act as, in ascending order of power.
 *
 * `anon` and `authenticated` are created by `supabase/migrations`, which explains why:
 * they exist on every Supabase project, and without them the revoke set would be
 * untestable. `service_role` is provisioned by the platform and is `BYPASSRLS`, so it is
 * the strongest principal a leaked Supabase key can present. B2 asserts against all three
 * — schema exposure is decided before any of them is consulted, so the strongest key must
 * fare no better than the weakest.
 */
export const SUPABASE_POSTGREST_ROLES = ['anon', 'authenticated', 'service_role'] as const;

export interface StartPostgrestOptions {
  /**
   * Schemas to hand PostgREST as `db-schemas`.
   *
   * Pass `readSupabaseApiConfiguration().exposedSchemas` to run the server the project
   * really runs. Pass something wider to model a misconfiguration — that is B2's control.
   */
  readonly exposedSchemas: readonly string[];
  /** HS256 secret, from `generateJwtSigningSecret()`. Never a checked-in value. */
  readonly jwtSecret: string;
  /** Override the image. Defaults to {@link POSTGREST_TEST_IMAGE}. */
  readonly image?: string;
}

export interface PostgrestTestEndpoint {
  /** `http://host:port`, with no trailing slash. */
  readonly baseUrl: string;
  /** The `db-schemas` this server was started with, echoed back for assertions. */
  readonly exposedSchemas: readonly string[];
  /**
   * Stops this endpoint early. Idempotent, because
   * {@link SupabaseRestTestStack.stop} also stops it — a test that tears down a
   * short-lived endpoint in a `finally` must not then fail its own `afterAll`.
   */
  stop(): Promise<void>;
}

export interface SupabaseRestTestStack {
  /** The migrated database, for catalog reads and fixture DDL. */
  readonly database: PostgresTestDatabase;
  /**
   * Start a PostgREST over {@link database}.
   *
   * ⚠ Call this **after** any DDL the server must see: PostgREST builds its schema cache
   * at boot and does not poll, so a table created afterwards is invisible to it.
   *
   * Callable more than once — B2's control runs a second server, over the same database
   * and the same token, with `app` deliberately added to `db-schemas`.
   */
  startPostgrest(options: StartPostgrestOptions): Promise<PostgrestTestEndpoint>;
  /** Stops every endpoint, then the database, then the network. Always call this. */
  stop(): Promise<void>;
}

/**
 * Start the Supabase-shaped surface ADR-0002 B2 needs: a migrated Postgres with a real
 * PostgREST able to sit in front of it.
 *
 * This is the **second** test harness, and it exists because the first one cannot serve
 * B2 at all. `startPostgresTestDatabase()` boots bare `postgres:17`; B2 is a statement
 * about the REST layer, and there is no REST layer in that container. See ADR-0010 for
 * why this is a purpose-built pair rather than `supabase start`'s full stack.
 *
 * The stack owns the Docker network, so callers compose containers without touching
 * Testcontainers plumbing. It also provisions what a real Supabase project gets from the
 * platform rather than from our migrations — `service_role`, and a login role PostgREST
 * connects as — and creates any exposed schema that does not exist. That last one is not
 * cosmetic: PostgREST refuses to build its schema cache if a listed schema is missing and
 * then answers **every** request with `503 PGRST002`, which a "denied" assertion reads as
 * a pass.
 *
 * @example
 * ```ts
 * const stack = await startSupabaseRestTestStack();
 * await stack.database.client.query('create table public.probe (id int primary key)');
 * const endpoint = await stack.startPostgrest({ exposedSchemas, jwtSecret });
 * // afterAll(() => stack.stop());
 * ```
 */
export async function startSupabaseRestTestStack(
  // `network` is omitted rather than accepted-and-ignored: the stack owns the network, and
  // a caller passing one would silently have it overwritten.
  options: Omit<StartPostgresTestDatabaseOptions, 'network'> = {},
): Promise<SupabaseRestTestStack> {
  const network = await new Network().start();
  const endpoints: PostgrestTestEndpoint[] = [];

  let started: PostgresTestDatabase | undefined;
  try {
    started = await startPostgresTestDatabase({ ...options, network });
    await provisionServiceRole(started);
  } catch (error) {
    // Unwind whatever came up. Leaking a half-built stack strands containers for the rest
    // of the run, and `afterAll` never sees a stack it can stop.
    await started?.stop().catch(() => undefined);
    await network.stop().catch(() => undefined);
    throw error;
  }
  const database = started;

  return {
    database,

    async startPostgrest(postgrestOptions: StartPostgrestOptions): Promise<PostgrestTestEndpoint> {
      const endpoint = await startPostgrest(database, network, postgrestOptions);
      endpoints.push(endpoint);
      return endpoint;
    },

    async stop(): Promise<void> {
      // Reverse order, and every stop attempted: one container failing to die must not
      // strand the rest for the remainder of the run.
      const failures: unknown[] = [];
      for (const endpoint of [...endpoints].reverse()) {
        await endpoint.stop().catch((error: unknown) => failures.push(error));
      }
      await database.stop().catch((error: unknown) => failures.push(error));
      await network.stop().catch((error: unknown) => failures.push(error));

      if (failures.length > 0) {
        throw new AggregateError(failures, 'startSupabaseRestTestStack: teardown failed');
      }
    },
  };
}

async function startPostgrest(
  database: PostgresTestDatabase,
  network: StartedNetwork,
  { exposedSchemas, jwtSecret, image = POSTGREST_TEST_IMAGE }: StartPostgrestOptions,
): Promise<PostgrestTestEndpoint> {
  if (database.containerConnectionString === null) {
    throw new Error('startPostgrest: the database is not on a network PostgREST can reach');
  }

  const { role: authenticator, password } = await provisionPlatformRoles(database, exposedSchemas);

  // Same database, different credentials: PostgREST connects as the authenticator, never
  // as the superuser the harness provisions with.
  const databaseUri = new URL(database.containerConnectionString);
  databaseUri.username = authenticator;
  databaseUri.password = password;

  const container: StartedTestContainer = await new GenericContainer(image)
    .withNetwork(network)
    .withExposedPorts(3000)
    .withEnvironment({
      PGRST_DB_URI: databaseUri.toString(),
      PGRST_DB_SCHEMAS: exposedSchemas.join(','),
      PGRST_DB_ANON_ROLE: 'anon',
      PGRST_JWT_SECRET: jwtSecret,
      // Two connections is plenty for a test and shortens startup. Left at the default of
      // ten, a suite that starts a second endpoint doubles the pool for no benefit.
      PGRST_DB_POOL: '2',
      PGRST_LOG_LEVEL: 'info',
    })
    // The schema cache is what fails when a schema is missing, and it loads *after* the
    // listener binds — so waiting on the port hands back a server that 503s every request.
    .withWaitStrategy(Wait.forLogMessage(/Schema cache loaded in/))
    .withStartupTimeout(60_000)
    .start();

  const baseUrl = `http://${container.getHost()}:${container.getMappedPort(3000)}`;

  try {
    await assertServing(baseUrl);
  } catch (error) {
    // A half-started container is worse than none: leaking it strands a container for the
    // rest of the run.
    await container.stop();
    throw error;
  }

  let stopped = false;

  return {
    baseUrl,
    exposedSchemas,
    async stop(): Promise<void> {
      if (stopped) {
        return;
      }
      stopped = true;
      await container.stop();
    },
  };
}

/**
 * Create `service_role` — the one platform role that is database-scoped rather than
 * per-endpoint, and `BYPASSRLS` because that is what it is on a real Supabase project.
 *
 * ⚠ Provisioned when the **stack** starts, not when an endpoint does. A caller grants to
 * `SUPABASE_POSTGREST_ROLES` while seeding fixtures, which happens *before* the first
 * `startPostgrest()` — so creating it any later means `grant … to service_role` raises
 * `42704 role "service_role" does not exist` and the whole suite dies in `beforeAll`.
 *
 * It is the worst case ADR-0002 §1 claims to survive: a leaked `service_role` key
 * survives only because the schema is not exposed, since every privilege check happens
 * after that gate.
 */
async function provisionServiceRole(database: PostgresTestDatabase): Promise<void> {
  await database.client.query(`do $$ begin
      if not exists (select 1 from pg_catalog.pg_roles where rolname = 'service_role') then
        create role service_role nologin noinherit bypassrls;
      end if;
    end $$`);
}

/**
 * Create what each endpoint needs on top of the database-scoped roles: a login role for
 * PostgREST, and any missing exposed schema.
 *
 * The login role is suffixed rather than named plain `authenticator` because a second
 * endpoint over one database is a first-class shape here — B2's control does exactly that
 * — and re-provisioning one shared role would rotate the password under the first
 * server's connection pool.
 */
async function provisionPlatformRoles(
  database: PostgresTestDatabase,
  exposedSchemas: readonly string[],
): Promise<{ role: string; password: string }> {
  const role = `authenticator_${randomUUID().replaceAll('-', '').slice(0, 8)}`;
  const password = randomBytes(16).toString('hex');
  const { client } = database;

  for (const schema of exposedSchemas) {
    const { rowCount } = await client.query(
      'select 1 from pg_catalog.pg_namespace where nspname = $1',
      [schema],
    );
    if (rowCount !== 0) {
      // ⚠ A schema the migrations own is left exactly as the migrations left it. Granting
      // here would be the worst bug this file could have: B2's control starts a server
      // with `app` in `db-schemas` and asserts the ADR-0002 §3 revoke set stops the
      // request anyway. A blanket `grant usage` in this loop would hand `app` to `anon`,
      // turn that control green for the wrong reason, and weaken every row below it.
      continue;
    }

    // Only a schema this harness invented — `graphql_public` on a bare Postgres. It is
    // created because PostgREST refuses to build its schema cache when a listed schema is
    // missing and then answers `503 PGRST002` to everything, and granted because that is
    // what a real Supabase project does with it.
    await client.query(`create schema ${quoteIdentifier(schema)}`);
    await client.query(
      `grant usage on schema ${quoteIdentifier(schema)} to ` +
        SUPABASE_POSTGREST_ROLES.map(quoteIdentifier).join(', '),
    );
  }

  await client.query(
    `create role ${quoteIdentifier(role)} login noinherit password ${quoteLiteral(password)}`,
  );
  await client.query(
    `grant ${SUPABASE_POSTGREST_ROLES.map(quoteIdentifier).join(', ')} to ${quoteIdentifier(role)}`,
  );

  return { role, password };
}

/** Fail loudly if the server is up but not serving — the `503 PGRST002` trap. */
async function assertServing(baseUrl: string): Promise<void> {
  const response = await fetch(`${baseUrl}/`);
  if (!response.ok) {
    throw new Error(
      `startPostgrest: server answered ${response.status} at ${baseUrl}/ — not serving: ` +
        (await response.text()),
    );
  }
}

/** `pg` has no identifier binding, and these values reach DDL. */
function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function quoteLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}
