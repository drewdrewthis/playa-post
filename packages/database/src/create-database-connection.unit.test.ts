import { Kysely } from 'kysely';
import { afterEach, describe, expect, it } from 'vitest';

import { createDatabaseConnection } from './create-database-connection';

/**
 * These run in the `unit` project because they need no database: `pg.Pool` opens
 * no socket until a query executes, and Kysely compiles SQL synchronously and
 * offline. Port 1 is unbound on purpose — if any assertion here ever starts
 * needing a live server, it fails loudly instead of quietly becoming an
 * integration test.
 */
const NO_DATABASE_LISTENS_HERE = 'postgres://app_rw@127.0.0.1:1/playa_post_unit_test';

let connections: ReturnType<typeof createDatabaseConnection>[] = [];

function connect(): ReturnType<typeof createDatabaseConnection> {
  const database = createDatabaseConnection({ connectionString: NO_DATABASE_LISTENS_HERE });
  connections.push(database);
  return database;
}

afterEach(async () => {
  await Promise.all(connections.map((database) => database.destroy()));
  connections = [];
});

describe('createDatabaseConnection', () => {
  it('builds a Kysely handle without connecting', () => {
    expect(connect()).toBeInstanceOf(Kysely);
  });

  it('splits the schema off the table key instead of quoting it whole', () => {
    // `"app.security_baseline_canary"` as a single identifier would resolve to a
    // table of that literal name in the search path — a silently wrong table
    // rather than an error. The dot must land outside the quotes.
    const { sql } = connect().selectFrom('app.security_baseline_canary').selectAll().compile();

    expect(sql).toBe('select * from "app"."security_baseline_canary"');
  });

  it('binds values as parameters rather than interpolating them into the SQL', () => {
    // ADR-0007: "no string interpolation of user input anywhere". The board filter
    // compiler is built on this being true of the builder underneath it.
    const injection = "'; drop table app.security_baseline_canary; --";

    const { sql, parameters } = connect()
      .selectFrom('app.security_baseline_canary')
      .selectAll()
      .where('id', '=', injection)
      .compile();

    expect(sql).toBe('select * from "app"."security_baseline_canary" where "id" = $1');
    expect(parameters).toEqual([injection]);
  });

  it('rejects a table the generated schema does not declare', () => {
    // The assertion is the directive below, checked by `pnpm typecheck`, not by
    // anything at runtime: were `Database` ever to degrade to `any`, this line
    // would stop erroring and `@ts-expect-error` would fail the build here rather
    // than let an untyped query layer ship.
    connect()
      // @ts-expect-error — no such table in the generated schema
      .selectFrom('app.table_that_does_not_exist');
  });
});
