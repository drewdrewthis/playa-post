import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  POSTGRES_TEST_IMAGE,
  REPOSITORY_MIGRATIONS_DIRECTORY,
  startPostgresTestDatabase,
  type PostgresTestDatabase,
} from './postgres-test-database';

/**
 * The smoke test for the harness itself: if this fails, no repository integration
 * test in the repo can be trusted (addendum §21).
 *
 * Two containers, because the two behaviours under test are genuinely different
 * startups — "what does it do when told nothing" cannot be observed on a container
 * that was told something.
 */
describe('startPostgresTestDatabase', () => {
  describe('with no options', () => {
    let database: PostgresTestDatabase;

    beforeAll(async () => {
      database = await startPostgresTestDatabase();
    });

    afterAll(async () => {
      await database?.stop();
    });

    it('boots the pinned Postgres major and yields a connection that answers queries', async () => {
      const { rows } = await database.client.query<{ version: string }>(
        'select version() as version',
      );

      // Derived from the constant rather than restating the number: a literal here is
      // a third place the major version has to be bumped, and the one most likely to
      // be missed because it only fails once a container has booted.
      const major = POSTGRES_TEST_IMAGE.split(':')[1];
      expect(rows[0]?.version).toContain(`PostgreSQL ${major}`);
      expect(database.connectionString).toMatch(/^postgres(ql)?:\/\//);
    });

    it("defaults to the repository's supabase/migrations without being told to", () => {
      expect(database.migrationsDirectory).toBe(REPOSITORY_MIGRATIONS_DIRECTORY);
      expect(database.migrationsDirectory).toContain(`supabase${sep}migrations`);
    });

    it('applies exactly the .sql files checked in there — no more, no fewer', async () => {
      const checkedIn = (await readdir(REPOSITORY_MIGRATIONS_DIRECTORY))
        .filter((entry) => entry.endsWith('.sql'))
        .sort();

      // Empty at M1 and non-empty from M2 — either way the harness must match the
      // directory, which is what stops integration tests drifting from `db reset`.
      expect(database.appliedMigrations).toEqual(checkedIn);
    });
  });

  describe('with an explicit migrations directory', () => {
    let migrationsDirectory: string;
    let database: PostgresTestDatabase;

    beforeAll(async () => {
      migrationsDirectory = await mkdtemp(join(tmpdir(), 'playa-post-migrations-'));
      await writeFile(
        join(migrationsDirectory, '0001_create_smoke_table.sql'),
        'create schema app; create table app.smoke (id integer primary key);',
      );
      // Lexically second, and it depends on the first having run.
      await writeFile(
        join(migrationsDirectory, '0002_seed_smoke_table.sql'),
        'insert into app.smoke (id) values (1), (2);',
      );

      database = await startPostgresTestDatabase({ migrationsDirectory });
    });

    afterAll(async () => {
      await database?.stop();
      if (migrationsDirectory !== undefined) {
        await rm(migrationsDirectory, { recursive: true, force: true });
      }
    });

    beforeEach(async () => {
      await database.truncateAllTables();
      await database.client.query('insert into app.smoke (id) values (1), (2)');
    });

    it('applies every .sql file in the directory, in lexical order', () => {
      expect(database.appliedMigrations).toEqual([
        '0001_create_smoke_table.sql',
        '0002_seed_smoke_table.sql',
      ]);
    });

    it('truncateAllTables empties the rows and keeps the schema', async () => {
      await database.truncateAllTables();

      const { rows } = await database.client.query<{ count: string }>(
        'select count(*) from app.smoke',
      );
      expect(rows[0]?.count).toBe('0');
    });

    it('names the tables it emptied, discovered from the catalog', async () => {
      await expect(database.truncateAllTables()).resolves.toEqual(['app.smoke']);
    });

    it('leaves each test the same starting state — the point of the reset API', async () => {
      // beforeEach truncated and re-seeded, so this test sees exactly the seed and
      // not whatever the previous test happened to leave behind.
      const { rows } = await database.client.query<{ count: string }>(
        'select count(*) from app.smoke',
      );
      expect(rows[0]?.count).toBe('2');
    });
  });
});
