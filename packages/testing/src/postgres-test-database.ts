import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Client } from 'pg';

/**
 * The Postgres image integration tests run against.
 *
 * Pinned to the major version Supabase runs locally and in production so SQL that
 * passes here is SQL that passes there (see `supabase/config.toml`).
 */
export const POSTGRES_TEST_IMAGE = 'postgres:16';

export interface StartPostgresTestDatabaseOptions {
  /**
   * Directory of `.sql` files to apply, in lexical filename order, after the
   * container is up. Missing directory means "no schema" — that is not an error,
   * which is what lets a test opt out of schema entirely.
   */
  readonly migrationsDirectory?: string;
  /** Override the image. Defaults to {@link POSTGRES_TEST_IMAGE}. */
  readonly image?: string;
}

export interface PostgresTestDatabase {
  /** `postgres://…` URI for the throwaway database. */
  readonly connectionString: string;
  /** An already-connected client. The test owns it; {@link stop} closes it. */
  readonly client: Client;
  /** Filenames applied from `migrationsDirectory`, in the order they ran. */
  readonly appliedMigrations: readonly string[];
  /** Closes the connection and destroys the container. Always call this. */
  stop(): Promise<void>;
}

/**
 * Start a disposable Postgres 16 container, apply a directory of `.sql` files,
 * and hand back a live connection.
 *
 * This is a **test fixture loader, not a migration system** (addendum §18 forbids
 * building one): no version table, no down-migrations, no state tracking. It
 * replays the same checked-in SQL that the Supabase CLI applies for real, into a
 * container that is destroyed when the test finishes.
 *
 * @example
 * ```ts
 * const database = await startPostgresTestDatabase({
 *   migrationsDirectory: fileURLToPath(new URL('../../../supabase/migrations', import.meta.url)),
 * });
 * afterAll(() => database.stop());
 * ```
 */
export async function startPostgresTestDatabase(
  options: StartPostgresTestDatabaseOptions = {},
): Promise<PostgresTestDatabase> {
  const container: StartedPostgreSqlContainer = await new PostgreSqlContainer(
    options.image ?? POSTGRES_TEST_IMAGE,
  ).start();

  const connectionString = container.getConnectionUri();
  const client = new Client({ connectionString });
  await client.connect();

  let appliedMigrations: readonly string[];
  try {
    appliedMigrations = await applyMigrations(client, options.migrationsDirectory);
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
    appliedMigrations,
    async stop(): Promise<void> {
      await client.end();
      await container.stop();
    },
  };
}

async function applyMigrations(
  client: Client,
  migrationsDirectory: string | undefined,
): Promise<readonly string[]> {
  if (migrationsDirectory === undefined) {
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

function isDirectoryMissing(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as NodeJS.ErrnoException).code === 'ENOENT'
  );
}
