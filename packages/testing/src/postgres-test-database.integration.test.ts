import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startPostgresTestDatabase, type PostgresTestDatabase } from './postgres-test-database';

/**
 * The smoke test for the harness itself: if this fails, no repository integration
 * test in the repo can be trusted (addendum §21).
 *
 * One container is shared by both cases on purpose — proving the harness boots and
 * proving it applies migrations are two assertions about one startup, not two
 * startups.
 */
describe('startPostgresTestDatabase', () => {
  let migrationsDirectory: string;
  let database: PostgresTestDatabase;

  beforeAll(async () => {
    migrationsDirectory = await mkdtemp(join(tmpdir(), 'playa-post-migrations-'));
    await writeFile(
      join(migrationsDirectory, '0001_create_smoke_table.sql'),
      'create table smoke (id integer primary key);',
    );
    // Lexically second, and it depends on the first having run.
    await writeFile(
      join(migrationsDirectory, '0002_seed_smoke_table.sql'),
      'insert into smoke (id) values (1), (2);',
    );

    database = await startPostgresTestDatabase({ migrationsDirectory });
  });

  afterAll(async () => {
    await database?.stop();
    if (migrationsDirectory !== undefined) {
      await rm(migrationsDirectory, { recursive: true, force: true });
    }
  });

  it('boots Postgres 16 and yields a connection that answers queries', async () => {
    const { rows } = await database.client.query<{ version: string }>('select version() as version');

    expect(rows[0]?.version).toContain('PostgreSQL 16');
    expect(database.connectionString).toMatch(/^postgres(ql)?:\/\//);
  });

  it('applies every .sql file in the migrations directory, in lexical order', async () => {
    expect(database.appliedMigrations).toEqual([
      '0001_create_smoke_table.sql',
      '0002_seed_smoke_table.sql',
    ]);

    const { rows } = await database.client.query<{ count: string }>('select count(*) from smoke');
    expect(rows[0]?.count).toBe('2');
  });
});
