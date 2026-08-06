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
// None of these exist yet — legible failure at this seam until the coder writes them.
import { createCreateBulletinService } from '../../application/create-bulletin.service';
import { createGetBulletinQuery } from '../../application/get-bulletin.query';
import { createListBoardQuery } from '../../application/list-board.query';
import { createBulletinsModule, type BulletinsModule } from '../../bulletins.module';
import { BulletinGoneError } from '../../domain/bulletin.errors';
import { createPostgresBulletinRepository } from '../../persistence/postgres-bulletin.repository';

/**
 * `specs/features/board-visibility-query.feature` — two `@e2e` (API-level) plus two
 * `@integration` scenarios out of the file's eight; the four `@unit` grammar
 * scenarios live in `modules/views/tests/unit/board-query-grammar.unit.test.ts`
 * instead, per the lane brief's "grammar scenarios are @unit — pure parser/compiler
 * tests".
 *
 * **`app.visible_bulletins` is the whole authorization surface here.** No TS import
 * of `modules/graph`'s exported `visiblePeople` read model — the lane brief's "must
 * not touch `modules/graph/persistence`" plus ADR-0004:75-77's "one definition of
 * who can this viewer reach" means the §6a author-identity projection (name/handle/
 * avatar visibility) happens *inside* `app.visible_bulletins`, composing
 * `app.visible_people`, not by this module re-joining `app.users` in TypeScript.
 * Recorded as an AC ambiguity: the coder/reviewer owns confirming `visible_bulletins`
 * returns the projected author fields directly rather than requiring a second,
 * cross-module read.
 */
describe('board visibility (board-visibility-query.feature, M2-AC1/AC5/AC14)', () => {
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

  async function seedAcceptedConnection(
    userAId: string,
    userBId: string,
    disclosure: { aTowardB?: 'full' | 'limited'; bTowardA?: 'full' | 'limited' } = {},
  ): Promise<void> {
    await testDatabase.client.query(
      `insert into app.connections
         (user_a_id, user_b_id, status, a_discloses_to_b_level, b_discloses_to_a_level, created_at)
       values ($1, $2, 'accepted', $3, $4, now())`,
      [userAId, userBId, disclosure.aTowardB ?? 'full', disclosure.bTowardA ?? 'full'],
    );
  }

  describe('Scenario: An eligible viewer sees a Request bulletin on their board (@e2e, API-level)', () => {
    it("contains user A's bulletin on user B's board", async () => {
      const module: BulletinsModule = createBulletinsModule({ database });
      const createCaller = createCallerFactory(router({ bulletins: module.router }));

      const userA = await seedOnboardedUser('dusty_board_a');
      const userB = await seedOnboardedUser('dusty_board_b');
      await seedAcceptedConnection(userA.userId, userB.userId);

      const { actorResolver } = createIdentityModule({ database });
      const dependencies = {
        accessTokenVerifier: createSupabaseJwtVerifier({ keySource: signingKey.publicKey }),
        actorResolver,
      };
      const tokenFor = async (authUserId: string): Promise<string> =>
        mintSupabaseAsymmetricUserToken({ signingKey, role: 'authenticated', subject: authUserId });
      const callerFor = (authorizationHeader: string): ReturnType<typeof createCaller> =>
        createCaller(contextFor(authorizationHeader, dependencies));

      const callerA = callerFor(`Bearer ${await tokenFor(userA.authUserId)}`);
      const callerB = callerFor(`Bearer ${await tokenFor(userB.authUserId)}`);

      const created = await callerA.bulletins.create({
        type: 'request',
        title: 'Need a jump start',
        body: 'Battery is dead, parked at the plaza.',
      });

      const board = await callerB.bulletins.board({});

      expect(board.items.some((item) => item.id === created.id)).toBe(true);
    });
  });

  describe('Scenario: A viewer with no relationship to the author gets zero board rows (@integration, M2-AC5)', () => {
    it("gives user C zero board rows referencing user A's bulletin, and 404 on getById", async () => {
      const userA = await seedOnboardedUser('dusty_board_zero_a');
      const userC = await seedOnboardedUser('dusty_board_zero_c');

      const bulletins = createPostgresBulletinRepository({ database });
      const createBulletin = createCreateBulletinService({ bulletins });
      const listBoard = createListBoardQuery({ bulletins });
      const getBulletin = createGetBulletinQuery({ bulletins });

      const created = await createBulletin.create({
        authorId: userA.userId,
        type: 'request',
        title: "User A's bulletin",
        body: 'User C has no relationship to user A.',
      });

      const board = await listBoard.list({ viewerId: userC.userId });
      expect(board.items.some((item) => item.id === created.id)).toBe(false);

      await expect(
        getBulletin.getById({ actorId: userC.userId, bulletinId: created.id }),
      ).rejects.toMatchObject({ constructor: BulletinGoneError, code: 'BULLETIN_GONE' });
    });
  });

  describe('Scenario: A bulletin from an author below full disclosure hides the author\'s identity (@e2e, API-level, M2-AC5 §6a)', () => {
    it('renders the bulletin author with no name, handle, or avatar', async () => {
      const module: BulletinsModule = createBulletinsModule({ database });
      const createCaller = createCallerFactory(router({ bulletins: module.router }));

      const userA = await seedOnboardedUser('dusty_board_below_a');
      const userB = await seedOnboardedUser('dusty_board_below_b');
      await seedAcceptedConnection(userA.userId, userB.userId, { aTowardB: 'limited' });

      const { actorResolver } = createIdentityModule({ database });
      const dependencies = {
        accessTokenVerifier: createSupabaseJwtVerifier({ keySource: signingKey.publicKey }),
        actorResolver,
      };
      const tokenFor = async (authUserId: string): Promise<string> =>
        mintSupabaseAsymmetricUserToken({ signingKey, role: 'authenticated', subject: authUserId });
      const callerFor = (authorizationHeader: string): ReturnType<typeof createCaller> =>
        createCaller(contextFor(authorizationHeader, dependencies));

      const callerA = callerFor(`Bearer ${await tokenFor(userA.authUserId)}`);
      const callerB = callerFor(`Bearer ${await tokenFor(userB.authUserId)}`);

      const created = await callerA.bulletins.create({
        type: 'request',
        title: 'Below-full-disclosure bulletin',
        body: 'User A has not fully disclosed to user B.',
      });

      const board = await callerB.bulletins.board({});
      const item = board.items.find((row) => row.id === created.id);

      expect(item).toBeDefined();
      expect(item?.author.displayName).toBeUndefined();
      expect(item?.author.handle).toBeUndefined();
      expect(item?.author.avatarUrl).toBeUndefined();
      expect(JSON.stringify(item)).not.toContain('dusty_board_below_a');
    });
  });

  describe('Scenario: Unauthorized and non-existent bulletin IDs are indistinguishable (@integration, M2-AC14, B17)', () => {
    it('answers identical status codes and byte-identical bodies for both', async () => {
      const userA = await seedOnboardedUser('dusty_board_indist_a');
      const viewerC = await seedOnboardedUser('dusty_board_indist_c');

      const bulletins = createPostgresBulletinRepository({ database });
      const createBulletin = createCreateBulletinService({ bulletins });
      const getBulletin = createGetBulletinQuery({ bulletins });

      const created = await createBulletin.create({
        authorId: userA.userId,
        type: 'request',
        title: 'Unauthorized to viewer C',
        body: 'Viewer C is not connected to user A.',
      });

      const unauthorized: unknown = await getBulletin
        .getById({ actorId: viewerC.userId, bulletinId: created.id })
        .catch((error: unknown) => error);
      const nonExistent: unknown = await getBulletin
        .getById({ actorId: viewerC.userId, bulletinId: randomUUID() })
        .catch((error: unknown) => error);

      expect(unauthorized).toBeInstanceOf(BulletinGoneError);
      expect(nonExistent).toBeInstanceOf(BulletinGoneError);
      // "byte-identical bodies" — `ApplicationError.toJSON()` is exactly what a
      // transport serializes (`shared/errors/application-error.ts`'s documented wire
      // form), so comparing its JSON string is the empty-diff evidence M2-AC14 asks
      // for, without needing the real HTTP layer in an @integration-level suite.
      expect(JSON.stringify(unauthorized)).toBe(JSON.stringify(nonExistent));
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
