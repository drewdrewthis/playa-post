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
// L1's public module factory — never identity's persistence, per `no-cross-module-
// persistence` (no test exemption). Mirrors every L2 integration suite's seam.
import { createIdentityModule } from '../../../identity/identity.module';
// None of these exist yet — legible failure at this seam until the coder writes them.
import { createArchiveBulletinService } from '../../application/archive-bulletin.service';
import { createCreateBulletinService } from '../../application/create-bulletin.service';
import { createGetBulletinQuery } from '../../application/get-bulletin.query';
import { createListMyBulletinsQuery } from '../../application/list-my-bulletins.query';
import { createBulletinsModule, type BulletinsModule } from '../../bulletins.module';
import { BulletinGoneError } from '../../domain/bulletin.errors';
import { createPostgresBulletinRepository } from '../../persistence/postgres-bulletin.repository';

/**
 * `specs/features/bulletin-request-lifecycle.feature` — one `@e2e` (API-level,
 * M2-AC1's flow) plus five `@integration` scenarios (M2-AC6, M2-AC12, M2-AC18,
 * M2-AC19). Same split discipline as `connections.integration.test.ts`: the `@e2e`
 * scenario drives the real router and real JWT verification; the `@integration`
 * scenarios call the application services directly against real repositories —
 * atomicity, authorization, and lifecycle state are what they prove, and none of
 * them need a JWT to prove it.
 *
 * **Design assumption recorded here as an AC ambiguity** (mirrors L2's own recorded
 * assumptions in `connections.integration.test.ts` and `visibility-matrix.security.
 * test.ts`): `BulletinGoneError` / `BULLETIN_GONE` is used uniformly for "archived",
 * "not authorized", and "does not exist" at `getById`. This is a deliberate design
 * choice, not an accident — the same "one answer for two situations" discipline
 * `connections/domain/connection.errors.ts`'s `NotConnectedError` and `invitation.
 * errors.ts`'s `InvitationUnavailableError` already establish, and it is what makes
 * M2-AC14's indistinguishability requirement true *by construction* rather than by a
 * second thing the coder has to remember to keep in sync. The coder/reviewer owns
 * ratifying this in the same PR that adds `bulletin.errors.ts`.
 */
describe('bulletin lifecycle (bulletin-request-lifecycle.feature, M2-AC1/AC6/AC12/AC18/AC19)', () => {
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

  async function bulletinsRowCount(): Promise<number> {
    const { rows } = await testDatabase.client.query<{ count: string }>(
      'select count(*)::text as count from app.bulletins',
    );
    return Number(rows[0]?.count ?? '0');
  }

  async function outboxRowCount(): Promise<number> {
    const { rows } = await testDatabase.client.query<{ count: string }>(
      'select count(*)::text as count from app.outbox_events',
    );
    return Number(rows[0]?.count ?? '0');
  }

  describe('Scenario: A user creates a Request bulletin and later archives it (@e2e, API-level)', () => {
    it("sets the bulletin's archivedAt timestamp", async () => {
      const module: BulletinsModule = createBulletinsModule({ database });
      const createCaller = createCallerFactory(router({ bulletins: module.router }));

      const userA = await seedOnboardedUser('dusty_bulletins_a');

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

      const created = await callerA.bulletins.create({
        type: 'request',
        title: 'Need a ride to the airport',
        body: 'Leaving Sunday morning, happy to chip in for gas.',
      });
      expect(created.archivedAt).toBeNull();

      const archived = await callerA.bulletins.archive({ bulletinId: created.id });
      expect(archived.archivedAt).not.toBeNull();
    });
  });

  /**
   * M2-AC6's evidence clause: "two `SELECT count(*)` outputs".
   *
   * **Fault-injection design decision, recorded as an AC ambiguity**: neither ADR-0005
   * nor ADR-0006 specifies a mechanism for injecting a fault mid-transaction, and no
   * production seam exists (or should exist) purely for a test to hook into. This
   * suite injects a *real* Postgres-level fault — revoking `app_rw`'s INSERT
   * privilege on `app.outbox_events` immediately before the call, so the second write
   * inside `CreateBulletinService`'s single transaction genuinely fails after the
   * first (`app.bulletins`) has already executed within that same, uncommitted
   * transaction. This proves real transactional atomicity rather than a mocked one.
   * The coder/reviewer owns confirming this is an acceptable fault-injection strategy
   * for M2-AC6, or replacing it with another equally real mechanism in the same PR.
   */
  describe('Scenario: A fault after insert and before commit leaves no partial state (@integration, M2-AC6)', () => {
    it('leaves zero new rows in both app.bulletins and app.outbox_events', async () => {
      const userA = await seedOnboardedUser('dusty_bulletins_fault_a');
      const bulletins = createPostgresBulletinRepository({ database });
      const createBulletin = createCreateBulletinService({ bulletins });

      await testDatabase.client.query(`revoke insert on app.outbox_events from app_rw`);
      try {
        await expect(
          createBulletin.create({
            authorId: userA.userId,
            type: 'request',
            title: 'This must never land',
            body: 'The outbox write is broken on purpose.',
          }),
        ).rejects.toBeInstanceOf(Error);
      } finally {
        await testDatabase.client.query(`grant insert on app.outbox_events to app_rw`);
      }

      expect(await bulletinsRowCount()).toBe(0);
      expect(await outboxRowCount()).toBe(0);
    });
  });

  describe('Scenario: Archived bulletin is gone for non-authors but retained for the author (@integration, M2-AC12)', () => {
    it('answers BULLETIN_GONE for a non-author and keeps it with archivedAt for the author', async () => {
      const userA = await seedOnboardedUser('dusty_bulletins_archived_a');
      const userB = await seedOnboardedUser('dusty_bulletins_archived_b');
      const bulletins = createPostgresBulletinRepository({ database });
      const createBulletin = createCreateBulletinService({ bulletins });
      const archiveBulletin = createArchiveBulletinService({ bulletins });
      const getBulletin = createGetBulletinQuery({ bulletins });
      const listMyBulletins = createListMyBulletinsQuery({ bulletins });

      const created = await createBulletin.create({
        authorId: userA.userId,
        type: 'request',
        title: 'Looking for a hammock',
        body: 'Overnight loan, will return.',
      });
      await archiveBulletin.archive({ actorId: userA.userId, bulletinId: created.id });

      await expect(
        getBulletin.getById({ actorId: userB.userId, bulletinId: created.id }),
      ).rejects.toMatchObject({ constructor: BulletinGoneError, code: 'BULLETIN_GONE' });

      const mine = await listMyBulletins.list({ actorId: userA.userId });
      const own = mine.find((bulletin) => bulletin.id === created.id);
      expect(own).toBeDefined();
      expect(own?.archivedAt).not.toBeNull();
    });
  });

  describe('Scenario: Archiving an already-archived bulletin is idempotent (@integration, M2-AC12)', () => {
    it('leaves archivedAt unchanged on a second archive call', async () => {
      const userA = await seedOnboardedUser('dusty_bulletins_idem_a');
      const bulletins = createPostgresBulletinRepository({ database });
      const createBulletin = createCreateBulletinService({ bulletins });
      const archiveBulletin = createArchiveBulletinService({ bulletins });

      const created = await createBulletin.create({
        authorId: userA.userId,
        type: 'request',
        title: 'Need a bike pump',
        body: 'Just for the morning.',
      });

      const firstArchive = await archiveBulletin.archive({
        actorId: userA.userId,
        bulletinId: created.id,
      });
      const secondArchive = await archiveBulletin.archive({
        actorId: userA.userId,
        bulletinId: created.id,
      });

      expect(secondArchive.archivedAt).toEqual(firstArchive.archivedAt);
    });
  });

  describe("Scenario: Archiving another user's bulletin is rejected (@integration, M2-AC18)", () => {
    it('answers a structured error with a stable code', async () => {
      const userA = await seedOnboardedUser('dusty_bulletins_reject_a');
      const userB = await seedOnboardedUser('dusty_bulletins_reject_b');
      const bulletins = createPostgresBulletinRepository({ database });
      const createBulletin = createCreateBulletinService({ bulletins });
      const archiveBulletin = createArchiveBulletinService({ bulletins });

      const created = await createBulletin.create({
        authorId: userA.userId,
        type: 'request',
        title: "User A's bulletin",
        body: 'User B has no business archiving this.',
      });

      await expect(
        archiveBulletin.archive({ actorId: userB.userId, bulletinId: created.id }),
      ).rejects.toMatchObject({ code: expect.any(String) });
    });
  });

  /**
   * M2-AC19's evidence clause: "a quoted error response plus `SELECT count(*)`
   * unchanged on both the entity table and `outbox_events`" — the row-count
   * assertions here are what distinguish this scenario from the M2-AC18 scenario
   * immediately above, which only requires the structured-error half.
   */
  describe('Scenario: bulletin.create and bulletin.archive fail closed for an unrelated actor (@integration, M2-AC19)', () => {
    it('rejects actor C with zero state change and zero outbox rows on bulletin.archive', async () => {
      const userA = await seedOnboardedUser('dusty_bulletins_unrelated_a');
      const actorC = await seedOnboardedUser('dusty_bulletins_unrelated_c');
      const bulletins = createPostgresBulletinRepository({ database });
      const createBulletin = createCreateBulletinService({ bulletins });
      const archiveBulletin = createArchiveBulletinService({ bulletins });

      const created = await createBulletin.create({
        authorId: userA.userId,
        type: 'request',
        title: "User A's bulletin",
        body: 'Actor C has no relationship to this at all.',
      });
      const outboxAfterCreate = await outboxRowCount();

      await expect(
        archiveBulletin.archive({ actorId: actorC.userId, bulletinId: created.id }),
      ).rejects.toBeInstanceOf(Error);

      const { rows } = await testDatabase.client.query<{ archived_at: Date | null }>(
        `select archived_at from app.bulletins where id = $1`,
        [created.id],
      );
      expect(rows[0]?.archived_at).toBeNull();
      expect(await outboxRowCount()).toBe(outboxAfterCreate);
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
