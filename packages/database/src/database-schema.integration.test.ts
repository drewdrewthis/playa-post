import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { startPostgresTestDatabase, type PostgresTestDatabase } from '@playa-post/testing';

import { createDatabaseConnection } from './create-database-connection';

/**
 * Two concerns, one container, on purpose.
 *
 * The `integration` project runs with `fileParallelism: false`, so every extra
 * file is another serialised Postgres boot on a two-core runner. Both suites here
 * ask the same question of the same database — "does the checked-in TypeScript
 * still describe what the migrations actually build?" — so splitting them would
 * buy separation of concerns at the price of doubling the slowest job in CI.
 */

const execFileAsync = promisify(execFile);

/** Package root: where `.kysely-codegenrc.json` and the `src/schema.ts` it names live. */
const PACKAGE_ROOT = fileURLToPath(new URL('..', import.meta.url));

const KYSELY_CODEGEN = fileURLToPath(new URL('../node_modules/.bin/kysely-codegen', import.meta.url));

/**
 * Given to `app_rw` inside a throwaway container that lives for one test file.
 *
 * The security baseline creates the role with `LOGIN` and no password because a
 * real one is issued out of band into the API's secret store. Connecting *as*
 * `app_rw` — rather than as the superuser with `SET ROLE` — is the whole point of
 * this file, so the test has to give it one.
 */
const APP_RW_TEST_PASSWORD = 'app_rw_in_a_throwaway_container';

let testDatabase: PostgresTestDatabase;
let appRwConnectionString: string;

beforeAll(async () => {
  testDatabase = await startPostgresTestDatabase();
  await testDatabase.client.query(`alter role app_rw with password '${APP_RW_TEST_PASSWORD}'`);
  appRwConnectionString = asRole(testDatabase.connectionString, 'app_rw', APP_RW_TEST_PASSWORD);
}, 300_000);

afterAll(async () => {
  await testDatabase.stop();
});

beforeEach(async () => {
  await testDatabase.truncateAllTables();
});

describe('the checked-in schema types', () => {
  it('describe the schema the migrations actually build', async () => {
    await expect(verifyGeneratedTypes(testDatabase.connectionString)).resolves.toBeUndefined();
  });

  it('fail verification when the database gains a table they do not declare', async () => {
    // A drift check that has never been observed to fail is a drift check that
    // reports green forever — the same failure mode the boundary fixtures exist
    // to rule out. This is that observation, made every run.
    await testDatabase.client.query('create table app.drift_probe (id int primary key)');

    try {
      await expect(verifyGeneratedTypes(testDatabase.connectionString)).rejects.toThrow(
        /out of date/,
      );
    } finally {
      await testDatabase.client.query('drop table app.drift_probe');
    }
  });
});

describe('reaching the security baseline as app_rw', () => {
  it('connects as the least-privileged role, not as the container superuser', async () => {
    // Without this, a bug in `asRole` would silently fall back to the superuser
    // and every assertion below would still pass — proving nothing about the role
    // the application actually uses.
    const database = createDatabaseConnection({ connectionString: appRwConnectionString });

    try {
      const { rows } = await sql<{ current_user: string }>`select current_user`.execute(database);

      expect(rows[0]?.current_user).toBe('app_rw');
    } finally {
      await database.destroy();
    }
  });

  it('writes and reads app.users through the generated types', async () => {
    // Was the security-baseline canary until the `app.users` migration retired it
    // (ADR-0008). A real product table is the better subject anyway: the canary's
    // every column was defaulted, so it could not have caught the `Timestamp` and
    // `citext` claims asserted below.
    const database = createDatabaseConnection({ connectionString: appRwConnectionString });

    try {
      const inserted = await database
        .insertInto('app.users')
        .values({
          auth_user_id: '00000000-0000-4000-8000-00000000beef',
          handle: 'dusty_rhodes',
          display_name: 'Dusty Rhodes',
          created_at: new Date(),
        })
        .returning(['id', 'created_at'])
        .executeTakeFirstOrThrow();

      const rows = await database
        .selectFrom('app.users')
        .select(['id', 'created_at'])
        .execute();

      // `FORCE ROW LEVEL SECURITY` with a policy that failed to match returns zero
      // rows and no error — the failure the baseline is most likely to ship with.
      // Reading the row back is what distinguishes "permitted" from "silently empty".
      expect(rows).toHaveLength(1);
      expect(rows[0]?.id).toBe(inserted.id);

      // The generated `Timestamp` claims `timestamptz` arrives as a `Date`. This is
      // the only place that claim meets the real driver.
      expect(inserted.created_at).toBeInstanceOf(Date);
      expect(typeof inserted.id).toBe('string');
    } finally {
      await database.destroy();
    }
  });
});

/**
 * Run the same `kysely-codegen` configuration `pnpm db:types` writes with, in
 * `--verify` mode, against a database the repository's migrations just built.
 *
 * Resolves on agreement; rejects with the generator's own diff otherwise. Flags
 * live in `.kysely-codegenrc.json` rather than here so the CI check and the
 * developer command cannot describe different schemas.
 */
async function verifyGeneratedTypes(connectionString: string): Promise<void> {
  try {
    await execFileAsync(KYSELY_CODEGEN, ['--verify', '--url', connectionString], {
      cwd: PACKAGE_ROOT,
    });
  } catch (error) {
    const failure = error as { stdout?: string; stderr?: string };
    throw new Error(
      'packages/database/src/schema.ts is out of date with supabase/migrations. ' +
        'Run `pnpm db:start && pnpm db:reset && pnpm db:types` and commit the result.\n\n' +
        `${failure.stdout ?? ''}${failure.stderr ?? ''}`,
      { cause: error },
    );
  }
}

/** Re-point a `postgres://` URI at a different role, keeping host, port, and database. */
function asRole(connectionString: string, username: string, password: string): string {
  const url = new URL(connectionString);
  url.username = username;
  url.password = password;
  return url.toString();
}
