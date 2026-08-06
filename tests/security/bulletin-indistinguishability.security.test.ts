import { randomUUID } from 'node:crypto';

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { createDatabaseConnection, type DatabaseConnection } from '@playa-post/database';
import { startPostgresTestDatabase, type PostgresTestDatabase } from '@playa-post/testing';

// None of these exist yet — legible failure at this seam until the coder writes them.
import { createCreateBulletinService } from '../../apps/server/src/modules/bulletins/application/create-bulletin.service';
import { createGetBulletinQuery } from '../../apps/server/src/modules/bulletins/application/get-bulletin.query';
import { BulletinGoneError } from '../../apps/server/src/modules/bulletins/domain/bulletin.errors';
import { createPostgresBulletinRepository } from '../../apps/server/src/modules/bulletins/persistence/postgres-bulletin.repository';

/**
 * ADR-0002 **B17** — "Unauthorized is indistinguishable from non-existent":
 * "Unauthorized and non-existent produce identical status, error code, and
 * byte-identical bodies across single-entity fetch, `from:` resolution,
 * intro-connector resolution, and report/dismiss of an invisible bulletin."
 *
 * This lane's slice is the single-entity-fetch case (`bulletins.getById`,
 * M2-AC14) — `from:` resolution and intro-connector resolution are M5. Duplicated
 * from `board-visibility-query.integration.test.ts`'s identical scenario per
 * `visibility-matrix.security.test.ts`'s own discipline: a B-row must be provable
 * from `tests/security/` alone, without cross-referencing a module's own test tree.
 */
describe('B17 — unauthorized bulletin ID is indistinguishable from a never-existent one', () => {
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

  it('answers identical status, code, and byte-identical bodies for both cases', async () => {
    const userA = await seedOnboardedUser('b17_bulletin_a');
    const viewerC = await seedOnboardedUser('b17_bulletin_c');

    const bulletins = createPostgresBulletinRepository({ database });
    const createBulletin = createCreateBulletinService({ bulletins });
    const getBulletin = createGetBulletinQuery({ bulletins });

    const created = await createBulletin.create({
      authorId: userA,
      type: 'request',
      title: 'Unauthorized to viewer C',
      body: 'Viewer C has no relationship to user A.',
    });

    const unauthorized: unknown = await getBulletin
      .getById({ actorId: viewerC, bulletinId: created.id })
      .catch((error: unknown) => error);
    const nonExistent: unknown = await getBulletin
      .getById({ actorId: viewerC, bulletinId: randomUUID() })
      .catch((error: unknown) => error);

    expect(unauthorized).toBeInstanceOf(BulletinGoneError);
    expect(nonExistent).toBeInstanceOf(BulletinGoneError);
    expect(JSON.stringify(unauthorized)).toBe(JSON.stringify(nonExistent));
  });
});

/** Mirrors `packages/database/src/database-schema.integration.test.ts`'s helper. */
function asRole(connectionString: string, username: string, password: string): string {
  const url = new URL(connectionString);
  url.username = username;
  url.password = password;
  return url.toString();
}
