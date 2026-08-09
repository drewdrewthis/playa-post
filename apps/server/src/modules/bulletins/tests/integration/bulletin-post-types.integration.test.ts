import { randomUUID } from 'node:crypto';

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { createDatabaseConnection, type DatabaseConnection } from '@playa-post/database';
import { createLogger } from '@playa-post/observability';
import {
  generateSupabaseSigningKeyPair,
  mintSupabaseAsymmetricUserToken,
  startPostgresTestDatabase,
  type PostgresTestDatabase,
  type SupabaseSigningKeyPair,
} from '@playa-post/testing';

import { authenticateRequest } from '../../../../shared/auth/authenticate-request';
import { createSupabaseJwtVerifier } from '../../../../shared/auth/supabase-jwt-verifier';
import type { RequestContext } from '../../../../shared/trpc/request-context';
import { createCallerFactory, router } from '../../../../shared/trpc/trpc';
import { createIdentityModule } from '../../../identity/identity.module';
import { createBulletinsModule, type BulletinsModule } from '../../bulletins.module';
import { BULLETIN_TYPE } from '../../domain/bulletin';

/**
 * `specs/features/bulletin-post-types.feature` (issue #87) — the postable vocabulary
 * is the comp's compose set, six of the grammar's seven types.
 *
 * The last scenario is the one that keeps the two lists honestly different:
 * `update` is *filterable* (`BOARD_BULLETIN_TYPES`) but must never be *postable* —
 * a network update is something the system writes, not something a person composes —
 * and `note` is never a value at all (decision D2). Asserting the refusal here means
 * a future "just share the two lists" refactor fails this suite instead of silently
 * widening the write surface.
 */
describe('bulletin post types (bulletin-post-types.feature, #87)', () => {
  let testDatabase: PostgresTestDatabase;
  let database: DatabaseConnection;
  let signingKey: SupabaseSigningKeyPair;

  beforeAll(async () => {
    testDatabase = await startPostgresTestDatabase();
    await testDatabase.client.query(`alter role app_rw with password 'app_rw_in_a_throwaway_container'`);
    database = createDatabaseConnection({
      connectionString: asRole(testDatabase.connectionString, 'app_rw', 'app_rw_in_a_throwaway_container'),
    });
    signingKey = await generateSupabaseSigningKeyPair();
  }, 300_000);

  afterEach(async () => {
    await testDatabase.truncateAllTables();
  });

  afterAll(async () => {
    await database?.destroy();
    await testDatabase?.stop();
  });

  async function seedOnboardedUser(handle: string): Promise<{ userId: string; authUserId: string }> {
    const authUserId = randomUUID();
    const { rows } = await testDatabase.client.query<{ id: string }>(
      `insert into app.users (auth_user_id, handle, display_name, created_at)
       values ($1, $2, $3, now()) returning id`,
      [authUserId, handle, handle],
    );
    const userId = rows[0]?.id;
    if (userId === undefined) {
      throw new Error('seedOnboardedUser: insert returned no row');
    }
    return { userId, authUserId };
  }

  async function seedAcceptedConnection(userAId: string, userBId: string): Promise<void> {
    await testDatabase.client.query(
      `insert into app.connections
         (user_a_id, user_b_id, status, a_discloses_to_b_level, b_discloses_to_a_level, created_at)
       values ($1, $2, 'accepted', 'full', 'full', now())`,
      [userAId, userBId],
    );
  }

  async function bulletinsRowCount(): Promise<number> {
    const { rows } = await testDatabase.client.query<{ count: string }>(
      'select count(*)::text as count from app.bulletins',
    );
    return Number(rows[0]?.count ?? '0');
  }

  // No explicit return annotation: `ReturnType<typeof createCaller>` is the callers'
  // whole type, and writing it out through `createCallerFactory` erases the router's
  // procedure map (the board-visibility harness types its callers the same way).
  function makeCallers() {
    const module: BulletinsModule = createBulletinsModule({ database });
    const createCaller = createCallerFactory(router({ bulletins: module.router }));
    const { actorResolver } = createIdentityModule({ database });
    const dependencies = {
      accessTokenVerifier: createSupabaseJwtVerifier({ keySource: signingKey.publicKey }),
      actorResolver,
    };
    return {
      callerFor: async (authUserId: string) => {
        const token = await mintSupabaseAsymmetricUserToken({
          signingKey,
          role: 'authenticated',
          subject: authUserId,
        });
        return createCaller(contextFor(`Bearer ${token}`, dependencies));
      },
    };
  }

  describe('Scenario: Each of the six postable types round-trips through create and the board (@e2e, API-level, #87)', () => {
    it("echoes each type at create and carries all six on user B's board", async () => {
      const userA = await seedOnboardedUser('dusty_types_a');
      const userB = await seedOnboardedUser('dusty_types_b');
      await seedAcceptedConnection(userA.userId, userB.userId);

      const { callerFor } = makeCallers();
      const callerA = await callerFor(userA.authUserId);
      const callerB = await callerFor(userB.authUserId);

      const postableTypes = Object.values(BULLETIN_TYPE);
      expect(postableTypes).toEqual(['offer', 'request', 'event', 'collab', 'thanks', 'intro']);

      for (const type of postableTypes) {
        const created = await callerA.bulletins.create({
          type,
          title: `A ${type} on the board`,
          body: `Body of the ${type} bulletin.`,
        });
        expect(created.type).toBe(type);
      }

      const board = await callerB.bulletins.board({});
      const typesOnBoard = board.items.map((item) => item.type).sort();
      expect(typesOnBoard).toEqual([...postableTypes].sort());
    });
  });

  describe('Scenario: The type: filter narrows a mixed board to the asked-for types (@e2e, API-level, #87)', () => {
    it('returns exactly the offer and the thanks bulletins for "type:offer|thanks"', async () => {
      const userA = await seedOnboardedUser('dusty_types_filter_a');
      const userB = await seedOnboardedUser('dusty_types_filter_b');
      await seedAcceptedConnection(userA.userId, userB.userId);

      const { callerFor } = makeCallers();
      const callerA = await callerFor(userA.authUserId);
      const callerB = await callerFor(userB.authUserId);

      for (const type of Object.values(BULLETIN_TYPE)) {
        await callerA.bulletins.create({
          type,
          title: `A ${type} on the board`,
          body: `Body of the ${type} bulletin.`,
        });
      }

      const board = await callerB.bulletins.board({ query: 'type:offer|thanks' });
      const typesOnBoard = board.items.map((item) => item.type).sort();
      expect(typesOnBoard).toEqual(['offer', 'thanks']);
    });
  });

  describe('Scenario: The two non-postable vocabulary members are refused at create (@e2e, API-level, #87)', () => {
    it('refuses type "update" and type "note" with a validation error and writes no row', async () => {
      const userA = await seedOnboardedUser('dusty_types_refused_a');

      const { callerFor } = makeCallers();
      const callerA = await callerFor(userA.authUserId);

      for (const refused of ['update', 'note']) {
        await expect(
          callerA.bulletins.create({
            // The cast reaches past the compile-time contract on purpose: this is the
            // wire-level attacker, not a well-typed client.
            type: refused as never,
            title: 'This must never land',
            body: 'A type the create surface does not accept.',
          }),
        ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
      }

      expect(await bulletinsRowCount()).toBe(0);
    });
  });
});

function contextFor(
  authorizationHeader: string | undefined,
  dependencies: Parameters<typeof authenticateRequest>[1],
): RequestContext {
  let outcome: ReturnType<typeof authenticateRequest> | undefined;
  return {
    correlationId: 'correlation-id-for-test',
    logger: createLogger({ level: 'silent' }),
    authentication: () => (outcome ??= authenticateRequest(authorizationHeader, dependencies)),
  };
}

/** Mirrors `packages/database/src/database-schema.integration.test.ts`'s helper. */
function asRole(connectionString: string, username: string, password: string): string {
  const url = new URL(connectionString);
  url.username = username;
  url.password = password;
  return url.toString();
}
