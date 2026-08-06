import { randomUUID } from 'node:crypto';

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { createDatabaseConnection, type DatabaseConnection } from '@playa-post/database';
import { startPostgresTestDatabase, type PostgresTestDatabase } from '@playa-post/testing';

// None of these exist yet — legible failure at this seam until the coder writes them.
import { createArchiveBulletinService } from '../../apps/server/src/modules/bulletins/application/archive-bulletin.service';
import { createCreateBulletinService } from '../../apps/server/src/modules/bulletins/application/create-bulletin.service';
import { createPostgresBulletinRepository } from '../../apps/server/src/modules/bulletins/persistence/postgres-bulletin.repository';

/**
 * ADR-0002 **B13** — "Write-path IDOR matrix": "For every mutation type in
 * ADR-0005's conflict matrix, an unrelated actor gets a structured failure with zero
 * state change and zero outbox rows."
 *
 * **This is the `bulletin.create` / `bulletin.archive` half only**, mirroring
 * `visibility-matrix.security.test.ts`'s own precedent for B5: the manifest flips
 * B13 to `live` in this PR because the row cannot be sharded across two states in
 * its schema, with the partial-coverage caveat recorded here rather than in the
 * manifest text (same discipline that file's header comment establishes for B5).
 * The full seven-mutation-type matrix (M2-AC19: `bulletin.create`, `bulletin.
 * archive`, `bulletin.report`, `bulletin.dismiss`, `connection.accept`, `trust.set`,
 * `notifyMe.update`) completes once every M2 lane lands; L5's confirmation pass
 * (m2-lane-briefs.md:789) is the natural place to assert the whole set together, per
 * the AC ambiguity `visibility-matrix.security.test.ts` already recorded for B5.
 *
 * `bulletin.create` has no unrelated-actor case to construct: `CreateBulletinCommand`
 * takes `authorId` only from the resolved `Actor` (never request input, per B14 / the
 * `ViewerId` provenance discipline `shared/auth/viewer-id.ts` documents), so there is
 * no subject for an unrelated actor to be unrelated *to* until the bulletin exists —
 * `bulletin.create` is fail-closed by construction, not by a runtime check this test
 * could exercise. Duplicated from `bulletin-request-lifecycle.integration.test.ts`'s
 * identical scenario.
 */
describe('B13 (bulletins half) — bulletin.archive fails closed for an unrelated actor', () => {
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

  async function outboxRowCount(): Promise<number> {
    const { rows } = await testDatabase.client.query<{ count: string }>(
      'select count(*)::text as count from app.outbox_events',
    );
    return Number(rows[0]?.count ?? '0');
  }

  it('rejects actor C with zero state change and zero outbox rows on bulletin.archive', async () => {
    const userA = await seedOnboardedUser('b13_bulletins_a');
    const actorC = await seedOnboardedUser('b13_bulletins_c');

    const bulletins = createPostgresBulletinRepository({ database });
    const createBulletin = createCreateBulletinService({ bulletins });
    const archiveBulletin = createArchiveBulletinService({ bulletins });

    const created = await createBulletin.create({
      authorId: userA,
      type: 'request',
      title: "User A's bulletin",
      body: 'Actor C has no relationship to this at all.',
    });
    const outboxAfterCreate = await outboxRowCount();

    await expect(
      archiveBulletin.archive({ actorId: actorC, bulletinId: created.id }),
    ).rejects.toBeInstanceOf(Error);

    const { rows } = await testDatabase.client.query<{ archived_at: Date | null }>(
      `select archived_at from app.bulletins where id = $1`,
      [created.id],
    );
    expect(rows[0]?.archived_at).toBeNull();
    expect(await outboxRowCount()).toBe(outboxAfterCreate);
  });
});

/** Mirrors `packages/database/src/database-schema.integration.test.ts`'s helper. */
function asRole(connectionString: string, username: string, password: string): string {
  const url = new URL(connectionString);
  url.username = username;
  url.password = password;
  return url.toString();
}
