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

/**
 * Location and expiry on a bulletin — the two fields compose collects ("Where — e.g.
 * 7:30 & E, Center Camp"; the `EXPIRES` chip group) and the card's `◦ {loc} · {author}`
 * meta line renders.
 *
 * **The load-bearing assertion is where expiry is enforced, not that it is.** It lives
 * as a predicate in `app.visible_bulletins`, beside `archived_at`, so every read that
 * composes that function inherits it in one place. This suite proves that by asking two
 * different composing surfaces — `bulletins.board` and `bulletins.getById` — about the
 * same expired bulletin and requiring them to agree, and by requiring the author's own
 * `listMine` (which reads `app.bulletins` directly, and is the one sanctioned read that
 * does not compose the function) to *keep* it. A design that filtered expiry in the
 * board's compiled query would pass a board-only test and fail these.
 *
 * Expiry is compared against the database clock (`pg_catalog.now()`), so the fixtures
 * are stated as generous offsets from real time rather than as pinned instants: an hour
 * either side is unambiguous on any runner, and pinning the clock would mean either
 * mocking it out of the one layer that owns it or making the assertion about the mock.
 */
describe('bulletin location and expiry (compose #48, card meta #46)', () => {
  let testDatabase: PostgresTestDatabase;
  let database: DatabaseConnection;
  let signingKey: SupabaseSigningKeyPair;

  const anHour = 60 * 60 * 1000;

  beforeAll(async () => {
    testDatabase = await startPostgresTestDatabase();
    await testDatabase.client.query(
      `alter role app_rw with password 'app_rw_in_a_throwaway_container'`,
    );
    database = createDatabaseConnection({
      connectionString: asRole(
        testDatabase.connectionString,
        'app_rw',
        'app_rw_in_a_throwaway_container',
      ),
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

  /**
   * Set an expiry the create policy would refuse.
   *
   * Direct SQL on purpose: `validateBulletinExpiry` will not let a service write an
   * already-elapsed expiry, and a suite that could only produce one by waiting would be
   * asserting against the wall clock. The column is the input to the visibility rule
   * under test; how it got there is not.
   */
  async function expireBulletin(bulletinId: string, at: Date): Promise<void> {
    await testDatabase.client.query('update app.bulletins set expires_at = $2 where id = $1', [
      bulletinId,
      at,
    ]);
  }

  function callerFor(module: BulletinsModule, authorizationHeader: string | undefined) {
    const { actorResolver } = createIdentityModule({ database });
    return createCallerFactory(router({ bulletins: module.router }))(
      contextFor(authorizationHeader, {
        accessTokenVerifier: createSupabaseJwtVerifier({ keySource: signingKey.publicKey }),
        actorResolver,
      }),
    );
  }

  async function bearerFor(authUserId: string): Promise<string> {
    return `Bearer ${await mintSupabaseAsymmetricUserToken({
      signingKey,
      role: 'authenticated',
      subject: authUserId,
    })}`;
  }

  describe('Scenario: An author posts a bulletin with a place and an expiry', () => {
    it('round-trips both to the author and to a connected viewer', async () => {
      const module = createBulletinsModule({ database });
      const author = await seedOnboardedUser('dusty_loc_author');
      const viewer = await seedOnboardedUser('dusty_loc_viewer');
      await seedAcceptedConnection(author.userId, viewer.userId);

      const expiresAt = new Date(Date.now() + 72 * anHour);
      const authorCaller = callerFor(module, await bearerFor(author.authUserId));

      const created = await authorCaller.bulletins.create({
        type: 'request',
        title: 'Need a bike pump',
        body: 'Any time before Thursday.',
        loc: '7:30 & E',
        expiresAt: expiresAt.toISOString(),
      });

      expect(created.loc).toBe('7:30 & E');
      expect(created.expiresAt).toBe(expiresAt.toISOString());

      const viewerCaller = callerFor(module, await bearerFor(viewer.authUserId));
      const board = await viewerCaller.bulletins.board({});

      expect(board.items).toHaveLength(1);
      expect(board.items[0]?.loc).toBe('7:30 & E');
      expect(board.items[0]?.expiresAt).toBe(expiresAt.toISOString());

      const fetched = await viewerCaller.bulletins.getById({ bulletinId: created.id });
      expect(fetched.loc).toBe('7:30 & E');
      expect(fetched.expiresAt).toBe(expiresAt.toISOString());
    });
  });

  describe('Scenario: An author posts without either field', () => {
    it('answers null for both rather than an empty string or a sentinel date', async () => {
      const module = createBulletinsModule({ database });
      const author = await seedOnboardedUser('dusty_loc_none');

      const caller = callerFor(module, await bearerFor(author.authUserId));
      const created = await caller.bulletins.create({
        type: 'request',
        title: 'Need a bike pump',
        body: '',
      });

      expect(created.loc).toBeNull();
      expect(created.expiresAt).toBeNull();
    });
  });

  describe('Scenario: A location longer than the bound is refused', () => {
    it('answers BAD_REQUEST with the stable BULLETIN_CONTENT_INVALID code', async () => {
      const module = createBulletinsModule({ database });
      const author = await seedOnboardedUser('dusty_loc_long');

      const caller = callerFor(module, await bearerFor(author.authUserId));

      await expect(
        caller.bulletins.create({
          type: 'request',
          title: 'Need a bike pump',
          body: '',
          loc: 'x'.repeat(121),
        }),
      ).rejects.toMatchObject({
        code: 'BAD_REQUEST',
        cause: expect.objectContaining({ code: 'BULLETIN_CONTENT_INVALID' }),
      });
    });
  });

  describe('Scenario: An expiry that has already passed is refused at creation', () => {
    it('answers BAD_REQUEST with BULLETIN_EXPIRY_INVALID and writes nothing', async () => {
      const module = createBulletinsModule({ database });
      const author = await seedOnboardedUser('dusty_expiry_past');

      const caller = callerFor(module, await bearerFor(author.authUserId));

      await expect(
        caller.bulletins.create({
          type: 'request',
          title: 'Already stale',
          body: '',
          expiresAt: new Date(Date.now() - anHour).toISOString(),
        }),
      ).rejects.toMatchObject({
        code: 'BAD_REQUEST',
        cause: expect.objectContaining({ code: 'BULLETIN_EXPIRY_INVALID' }),
      });

      const { rows } = await testDatabase.client.query<{ count: string }>(
        'select count(*)::text as count from app.bulletins',
      );
      expect(rows[0]?.count, 'a refused create must leave no row behind').toBe('0');
    });
  });

  describe('Scenario: An expired bulletin leaves every viewer-scoped read at once', () => {
    it('is absent from the board and 404s on getById, while an unexpired sibling stays', async () => {
      const module = createBulletinsModule({ database });
      const author = await seedOnboardedUser('dusty_expiry_gone_a');
      const viewer = await seedOnboardedUser('dusty_expiry_gone_b');
      await seedAcceptedConnection(author.userId, viewer.userId);

      const authorCaller = callerFor(module, await bearerFor(author.authUserId));
      const expiring = await authorCaller.bulletins.create({
        type: 'request',
        title: 'Ride to the airport',
        body: 'Leaving Sunday.',
        expiresAt: new Date(Date.now() + anHour).toISOString(),
      });
      const enduring = await authorCaller.bulletins.create({
        type: 'request',
        title: 'Spare goggles',
        body: 'All week.',
      });

      const viewerCaller = callerFor(module, await bearerFor(viewer.authUserId));
      expect((await viewerCaller.bulletins.board({})).items).toHaveLength(2);

      await expireBulletin(expiring.id, new Date(Date.now() - anHour));

      const board = await viewerCaller.bulletins.board({});
      expect(board.items.map((item) => item.id)).toEqual([enduring.id]);

      // The second composing surface. If expiry had been filtered in the board's
      // compiled query instead of in app.visible_bulletins, this call would still
      // answer the bulletin the board just hid.
      await expect(viewerCaller.bulletins.getById({ bulletinId: expiring.id })).rejects.toMatchObject(
        {
          code: 'NOT_FOUND',
          cause: expect.objectContaining({ code: 'BULLETIN_GONE' }),
        },
      );
    });

    it('is gone for its own author too, exactly as an archived one is', async () => {
      const module = createBulletinsModule({ database });
      const author = await seedOnboardedUser('dusty_expiry_self');

      const caller = callerFor(module, await bearerFor(author.authUserId));
      const created = await caller.bulletins.create({
        type: 'request',
        title: 'Ride to the airport',
        body: 'Leaving Sunday.',
        expiresAt: new Date(Date.now() + anHour).toISOString(),
      });

      await expireBulletin(created.id, new Date(Date.now() - anHour));

      // Authorship is not an exemption from visibility — the same statement
      // `archived_at` already makes inside the function.
      await expect(caller.bulletins.getById({ bulletinId: created.id })).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
    });
  });

  describe("Scenario: The author's own list keeps an expired bulletin", () => {
    it('returns it with its expiresAt, the way it keeps an archived one', async () => {
      const module = createBulletinsModule({ database });
      const author = await seedOnboardedUser('dusty_expiry_mine');

      const caller = callerFor(module, await bearerFor(author.authUserId));
      const created = await caller.bulletins.create({
        type: 'request',
        title: 'Ride to the airport',
        body: 'Leaving Sunday.',
        loc: 'Center Camp',
        expiresAt: new Date(Date.now() + anHour).toISOString(),
      });

      const expiredAt = new Date(Date.now() - anHour);
      await expireBulletin(created.id, expiredAt);

      const mine = await caller.bulletins.listMine();

      expect(mine).toHaveLength(1);
      expect(mine[0]?.id).toBe(created.id);
      expect(mine[0]?.loc).toBe('Center Camp');
      expect(mine[0]?.expiresAt).toBe(expiredAt.toISOString());
    });
  });

  describe('Scenario: A location is not a search term', () => {
    it('does not match a bare-word board query, so a place cannot become a people search', async () => {
      const module = createBulletinsModule({ database });
      const author = await seedOnboardedUser('dusty_loc_search_a');
      const viewer = await seedOnboardedUser('dusty_loc_search_b');
      await seedAcceptedConnection(author.userId, viewer.userId);

      const authorCaller = callerFor(module, await bearerFor(author.authUserId));
      await authorCaller.bulletins.create({
        type: 'request',
        title: 'Need a bike pump',
        body: 'Any time before Thursday.',
        loc: 'Esplanade',
      });

      const viewerCaller = callerFor(module, await bearerFor(viewer.authUserId));

      // Matching this would answer "who is camped on the Esplanade" through the text
      // channel — the people search PDF §3/§4 forbids, and the reason `loc` is absent
      // from `search_document`.
      await expect(viewerCaller.bulletins.board({ query: 'Esplanade' })).resolves.toEqual({
        items: [],
      });
      // The haystack still works, so the assertion above is about `loc` and not about a
      // query that matches nothing.
      await expect(viewerCaller.bulletins.board({ query: 'pump' })).resolves.toMatchObject({
        items: [expect.objectContaining({ loc: 'Esplanade' })],
      });
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
