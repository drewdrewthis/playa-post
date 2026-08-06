import { randomUUID } from 'node:crypto';

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { createDatabaseConnection, type DatabaseConnection } from '@playa-post/database';
import { startPostgresTestDatabase, type PostgresTestDatabase } from '@playa-post/testing';

// None of these exist yet — legible failure at this seam until the coder writes them.
import { createUpdateNotifyMeQueryService } from '../../application/update-notify-me-query.service';
import { createPostgresNotifyMeQueryRepository } from '../../persistence/postgres-notify-me-query.repository';

/**
 * `specs/features/notify-me.feature` › "notifyMe.update fails closed for an actor
 * unrelated to the query" (M2-AC19). Lives beside `views`' Notify Me half per
 * m2-lane-briefs.md's module-ownership table ("`views` gets the Notify Me half";
 * `UpdateNotifyMeQuery` emits `NotifyMeQueryChanged`), not beside
 * `modules/notifications`' push/matching suite.
 *
 * **Design assumption recorded here as an AC ambiguity, and the largest one in this
 * lane's test-writing pass** (the coder/reviewer owns ratifying or replacing it in
 * the same PR that adds `update-notify-me-query.service.ts`):
 *
 * `app.notify_me_queries` has **no separate query id** — ADR-0007:79 pins the
 * primary key to `owner_id` alone, "exactly one Notify Me query per user". B14
 * forbids any tRPC input schema carrying an `ownerId`/`userId`/`actorId`/`viewerId`
 * field, so there is structurally no client-suppliable identifier through which an
 * actor could *name* another user's query — the same "no unrelated-actor case
 * exists" property `create-bulletin.service.ts`'s docstring already states for
 * `bulletin.create`. `UpdateNotifyMeQuery` is therefore modelled here with **no**
 * target-owner field at all: the command takes only `{ actorId, sourceText,
 * expectedVersion }`, and the write is unconditionally scoped `WHERE owner_id =
 * actorId`, mirroring `postgres-bulletin.repository.ts#archive`'s
 * `.where('author_id', '=', write.actorId)` pattern.
 *
 * Given that, "actor C submits notifyMe.update for [user A's] query" is realized
 * the one way the data model allows it: **C submits `expectedVersion` equal to A's
 * actual stored version** — an attacker who has somehow observed or guessed A's
 * version number, hoping it will be treated as a match. Because the write can only
 * ever target C's own row (never A's), and C has no existing row, any non-null
 * `expectedVersion` C supplies mismatches C's own absent state and the call fails
 * closed as a conflict — never touching, and never disclosing, A's row. This is
 * ADR-0005 rule 1 ("actorship is checked first ... never after [version
 * comparison]") holding *by construction* rather than by an explicit identifier
 * check, and the assertions below are written to prove exactly that: A's row is
 * untouched, no outbox event lands, and C's own rejection carries none of A's
 * `sourceText` or version.
 */
describe('notifyMe.update (notify-me.feature, M2-AC19)', () => {
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

  async function seedOnboardedUser(handle: string): Promise<{ userId: string }> {
    const { rows } = await testDatabase.client.query<{ id: string }>(
      `insert into app.users (auth_user_id, handle, display_name, created_at)
       values ($1, $2, $3, now()) returning id`,
      [randomUUID(), handle, handle],
    );
    const userId = rows[0]?.id;
    if (userId === undefined) {
      throw new Error('seedOnboardedUser: insert returned no row');
    }
    return { userId };
  }

  async function seedNotifyMeQuery(
    ownerId: string,
    options: { readonly sourceText: string; readonly version: number },
  ): Promise<void> {
    await testDatabase.client.query(
      `insert into app.notify_me_queries (owner_id, source_text, ast, ast_version, version, updated_at)
       values ($1, $2, $3::jsonb, 1, $4, now())`,
      [ownerId, options.sourceText, JSON.stringify({ types: ['request'], text: [] }), options.version],
    );
  }

  async function queryRowFor(
    ownerId: string,
  ): Promise<{ source_text: string; version: number } | undefined> {
    const { rows } = await testDatabase.client.query<{ source_text: string; version: number }>(
      `select source_text, version from app.notify_me_queries where owner_id = $1`,
      [ownerId],
    );
    return rows[0];
  }

  async function outboxRowCount(): Promise<number> {
    const { rows } = await testDatabase.client.query<{ count: string }>(
      `select count(*)::text as count from app.outbox_events`,
    );
    return Number(rows[0]?.count ?? '0');
  }

  describe('Scenario: notifyMe.update fails closed for an actor unrelated to the query (@integration, M2-AC19)', () => {
    it("leaves user A's query untouched, writes no outbox row, and leaks nothing of A's state", async () => {
      const userA = await seedOnboardedUser('dusty_notifyme_unrelated_a');
      const actorC = await seedOnboardedUser('dusty_notifyme_unrelated_c');

      await seedNotifyMeQuery(userA.userId, { sourceText: 'type:request tag:kitchen', version: 3 });

      const notifyMeQueries = createPostgresNotifyMeQueryRepository({ database });
      const updateNotifyMeQuery = createUpdateNotifyMeQueryService({ notifyMeQueries });

      // C has never saved a query of their own, and attempts to reach A's row the
      // only way the data model exposes: by supplying A's own current version.
      const rejection = await updateNotifyMeQuery
        .update({ actorId: actorC.userId, sourceText: 'type:request', expectedVersion: 3 })
        .catch((error: unknown) => error);

      expect(rejection).toBeInstanceOf(Error);

      const serialized = JSON.stringify(rejection, Object.getOwnPropertyNames(rejection as object));
      // ADR-0005: "the conflict envelope is a leak channel" — C's rejection must not
      // carry A's saved query text or reveal that a version 3 exists for anyone.
      expect(serialized).not.toMatch(/kitchen/);

      const aRow = await queryRowFor(userA.userId);
      expect(aRow).toEqual({ source_text: 'type:request tag:kitchen', version: 3 });

      const cRow = await queryRowFor(actorC.userId);
      expect(cRow).toBeUndefined();

      expect(await outboxRowCount()).toBe(0);
    });
  });
});

/** Mirrors `packages/database/src/database-schema.integration.test.ts`'s helper. */
function asRole(connectionString: string, username: string, password: string): string {
  const url = new URL(connectionString);
  url.username = username;
  url.password = password;
  return url.toString();
}
