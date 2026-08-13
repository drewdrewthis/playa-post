import { randomUUID } from 'node:crypto';

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { createDatabaseConnection, type DatabaseConnection } from '@playa-post/database';
import { startPostgresTestDatabase, type PostgresTestDatabase } from '@playa-post/testing';

// None of these exist yet — legible failure at this seam until the coder writes them.
import { createCreateBulletinService } from '../../apps/server/src/modules/bulletins/application/create-bulletin.service';
import { createListBoardQuery } from '../../apps/server/src/modules/bulletins/application/list-board.query';
import { createPostgresBulletinRepository } from '../../apps/server/src/modules/bulletins/persistence/postgres-bulletin.repository';

/**
 * ADR-0002 **B10** — "A filter can narrow but never widen": "A Notify Me query or
 * board query crafted to reference a non-authorized author, tag, or bulletin returns 0
 * rows rather than an error-free leak."
 *
 * M2 ships only `type:` and bare text (ADR-0007's full grammar — `from:`, `tag:`,
 * `deg:`, `trust:` — is M5), so this suite proves the M2-scoped version of the same
 * property the strongest way M2's grammar allows: a **well-formed, accepted** query
 * (`type:request`) that would match a bulletin *if the authorized-set boundary did
 * not apply* still returns zero rows for a viewer outside that boundary. The filter
 * is applied strictly after `app.visible_bulletins`, per ADR-0007's `WITH authorized
 * AS (...) SELECT ... WHERE <compiled filter>` shape — there is no seam through
 * which a term inside `<compiled filter>` could reach a row `authorized` never
 * produced, and that is exactly what this test exercises: the query is accepted (it
 * is not a rejection test — `board-query-grammar.unit.test.ts` covers rejection),
 * and it still yields nothing outside the viewer's authorized set.
 */
describe('B10 — a board filter narrows the authorized set but never widens it', () => {
  let testDatabase: PostgresTestDatabase;
  let database: DatabaseConnection;

  beforeAll(async () => {
    testDatabase = await startPostgresTestDatabase();
    await testDatabase.client.query(`alter role app_rw with password 'app_rw_in_a_throwaway_container'`);
    database = createDatabaseConnection({
      connectionString: asRole(testDatabase.connectionString, 'app_rw', 'app_rw_in_a_throwaway_container'),
    });
  }, 300_000);

  afterEach(async () => {
    await testDatabase.truncateAllTables();
  });

  afterAll(async () => {
    await database?.destroy();
    await testDatabase?.stop();
  });

  async function seedOnboardedUser(handle: string): Promise<string> {
    const { rows } = await testDatabase.client.query<{ id: string }>(
      `insert into app.users (auth_user_id, handle, display_name, created_at)
       values ($1, $2, $3, now()) returning id`,
      [randomUUID(), handle, handle],
    );
    const id = rows[0]?.id;
    if (id === undefined) {
      throw new Error('seedOnboardedUser: insert returned no row');
    }
    return id;
  }

  it('gives an unrelated viewer 0 rows for "type:request" even though a matching Request bulletin exists', async () => {
    const userA = await seedOnboardedUser('b10_board_a');
    const userC = await seedOnboardedUser('b10_board_c');

    const bulletins = createPostgresBulletinRepository({ database });
    const createBulletin = createCreateBulletinService({ bulletins });
    const listBoard = createListBoardQuery({ bulletins });

    await createBulletin.create({
      authorId: userA,
      type: 'request',
      title: "User A's Request bulletin",
      body: 'A well-formed type:request query would match this if the boundary leaked.',
    });

    const board = await listBoard.list({ viewerId: userC, query: 'type:request' });

    expect(board.items).toEqual([]);
  });
});

/** Mirrors `packages/database/src/database-schema.integration.test.ts`'s helper. */
function asRole(connectionString: string, username: string, password: string): string {
  const url = new URL(connectionString);
  url.username = username;
  url.password = password;
  return url.toString();
}
