import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Client } from 'pg';

/**
 * The Postgres image integration tests run against.
 *
 * Pinned to the major version Supabase runs locally and in production so SQL that
 * passes here is SQL that passes there (see `supabase/config.toml`).
 */
export const POSTGRES_TEST_IMAGE = 'postgres:16';

/**
 * The repository's own `supabase/migrations`, applied unless a caller opts out.
 *
 * Resolved from this file rather than from `process.cwd()` so the harness behaves
 * identically whether Vitest runs from the repo root, from the package, or from
 * an editor.
 */
export const REPOSITORY_MIGRATIONS_DIRECTORY = fileURLToPath(
  new URL('../../../supabase/migrations', import.meta.url),
);

export interface StartPostgresTestDatabaseOptions {
  /**
   * Directory of `.sql` files to apply, in lexical filename order.
   *
   * Omitted → {@link REPOSITORY_MIGRATIONS_DIRECTORY}, so an integration test gets
   * the real schema by default and cannot silently drift from what
   * `supabase db reset` produces. `null` → apply nothing, for tests that own their
   * own schema. A directory that does not exist is not an error: it yields an
   * empty database, which is exactly M1's state.
   */
  readonly migrationsDirectory?: string | null;
  /** Override the image. Defaults to {@link POSTGRES_TEST_IMAGE}. */
  readonly image?: string;
}

export interface PostgresTestDatabase {
  /** `postgres://…` URI for the throwaway database. */
  readonly connectionString: string;
  /** An already-connected client. The test owns it; {@link stop} closes it. */
  readonly client: Client;
  /** The directory migrations were read from, or `null` if the caller opted out. */
  readonly migrationsDirectory: string | null;
  /** Filenames applied from {@link migrationsDirectory}, in the order they ran. */
  readonly appliedMigrations: readonly string[];
  /**
   * Empty every table while keeping the migrated schema, and return the tables
   * truncated (schema-qualified, sorted).
   *
   * This is the between-tests reset. It deliberately does **not** re-run
   * migrations: re-applying schema per test would cost seconds each and would
   * hide migrations that are not idempotent.
   */
  truncateAllTables(): Promise<readonly string[]>;
  /** Closes the connection and destroys the container. Always call this. */
  stop(): Promise<void>;
}

/**
 * Start a disposable Postgres 16 container, apply the repository's migrations, and
 * hand back a live connection.
 *
 * This is a **test fixture loader, not a migration system** (addendum §18 forbids
 * building one): no version table, no down-migrations, no state tracking. It
 * replays the same checked-in SQL the Supabase CLI applies for real, into a
 * container that is destroyed when the test finishes.
 *
 * @example
 * ```ts
 * const database = await startPostgresTestDatabase();   // repo migrations applied
 * afterAll(() => database.stop());
 * beforeEach(() => database.truncateAllTables());
 * ```
 */
export async function startPostgresTestDatabase(
  options: StartPostgresTestDatabaseOptions = {},
): Promise<PostgresTestDatabase> {
  const migrationsDirectory =
    options.migrationsDirectory === undefined
      ? REPOSITORY_MIGRATIONS_DIRECTORY
      : options.migrationsDirectory;

  const container: StartedPostgreSqlContainer = await new PostgreSqlContainer(
    options.image ?? POSTGRES_TEST_IMAGE,
  ).start();

  const connectionString = container.getConnectionUri();
  const client = new Client({ connectionString });
  await client.connect();

  let appliedMigrations: readonly string[];
  try {
    appliedMigrations = await applyMigrations(client, migrationsDirectory);
  } catch (error) {
    // A half-migrated container is worse than none: leaking it would strand a
    // docker container for the rest of the CI run.
    await client.end();
    await container.stop();
    throw error;
  }

  return {
    connectionString,
    client,
    migrationsDirectory,
    appliedMigrations,

    async truncateAllTables(): Promise<readonly string[]> {
      const tables = await listTruncatableTables(client);
      if (tables.length > 0) {
        await client.query(`truncate table ${tables.join(', ')} restart identity cascade`);
      }
      return tables;
    },

    async stop(): Promise<void> {
      await client.end();
      await container.stop();
    },
  };
}

async function applyMigrations(
  client: Client,
  migrationsDirectory: string | null,
): Promise<readonly string[]> {
  if (migrationsDirectory === null) {
    return [];
  }

  const filenames = await listMigrationFilenames(migrationsDirectory);
  for (const filename of filenames) {
    const sql = await readFile(join(migrationsDirectory, filename), 'utf8');
    await client.query(sql);
  }

  return filenames;
}

async function listMigrationFilenames(migrationsDirectory: string): Promise<string[]> {
  try {
    const entries = await readdir(migrationsDirectory);
    return entries.filter((entry) => entry.endsWith('.sql')).sort();
  } catch (error) {
    if (isDirectoryMissing(error)) {
      return [];
    }
    throw error;
  }
}

/**
 * Every user table, schema-qualified and quoted.
 *
 * Catalog-driven rather than a hand-maintained list, so a table added by a future
 * migration is reset without anyone remembering to update this file. The failure
 * mode being prevented is a test that passes because stale rows from the previous
 * test happened to satisfy it.
 */
async function listTruncatableTables(client: Client): Promise<string[]> {
  const { rows } = await client.query<{ qualified_name: string }>(
    `select quote_ident(schemaname) || '.' || quote_ident(tablename) as qualified_name
       from pg_tables
      where schemaname not in ('pg_catalog', 'information_schema')
        and schemaname not like 'pg\\_toast%'
      order by 1`,
  );
  return rows.map((row) => row.qualified_name);
}

function isDirectoryMissing(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as NodeJS.ErrnoException).code === 'ENOENT'
  );
}
