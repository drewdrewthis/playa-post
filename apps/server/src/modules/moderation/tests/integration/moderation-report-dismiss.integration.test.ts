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

import type { AuthenticationOutcome } from '../../../../shared/auth/authenticate-request';
import { authenticateRequest } from '../../../../shared/auth/authenticate-request';
import { createSupabaseJwtVerifier } from '../../../../shared/auth/supabase-jwt-verifier';
import type { RequestContext } from '../../../../shared/trpc/request-context';
import { createCallerFactory, router } from '../../../../shared/trpc/trpc';
// L3a's router — the only sanctioned cross-module surface for this lane. The brief's
// "must not touch `modules/bulletins/persistence`" line, plus `no-cross-module-
// persistence` (which the fitness suite enforces over *this test file too*, not just
// production code — `apps/server/src/modules/([^/]+)/` matches everything under a
// module, tests included), means moderation cannot construct a `BulletinRepository`
// or `VisibleBulletinsRepository` itself. Every bulletin fixture this suite needs is
// created and read through `bulletinsModule.router`.
import { createBulletinsModule, type BulletinsModule } from '../../../bulletins/bulletins.module';
// L1's public module factory — never identity's persistence, per the same rule.
import { createIdentityModule } from '../../../identity/identity.module';
// None of these exist yet — legible failure at this seam until the coder writes them.
// `DismissBulletinService` has no direct-call scenario here (the one dismiss scenario
// is @e2e, via `callerV.moderation.dismiss` below) so it is not imported.
import { createReportBulletinService } from '../../application/report-bulletin.service';
import { CannotReportOwnBulletinError, ModerationTargetUnavailableError } from '../../domain/moderation.errors';
import { createModerationModule, type ModerationModule } from '../../moderation.module';
import { createPostgresModerationRepository } from '../../persistence/postgres-moderation.repository';

/**
 * `specs/features/moderation-report-dismiss.feature` — 7 scenarios: 2 `@e2e`
 * (API-level, real router + real JWT verification) and 5 `@integration` (moderation's
 * own application services called directly against real repositories; bulletin
 * fixtures still go through `bulletinsModule.router`, authenticated with a
 * hand-built, non-JWT context — proving moderation's business logic does not need a
 * second, slower proof of the JWT stack `bulletin-request-lifecycle.integration.test.ts`
 * already carries for `bulletins.create`).
 *
 * **Interface assumption #1, recorded here as an AC ambiguity** (mirrors the
 * discipline `bulletin-request-lifecycle.integration.test.ts` and `board-visibility-
 * query.integration.test.ts` already establish): `moderation.report` /
 * `moderation.dismiss` need to make `bulletins.board` exclude the target bulletin for
 * the acting viewer afterwards, and `bulletins.board` is the *only* board endpoint —
 * there is no moderation-owned board read. This suite does not prescribe the wiring (a
 * port `list-board.query.ts` composes, a decorator moderation applies over the query
 * result, or something else); it only asserts the observable behaviour through
 * `createBulletinsModule({ database })` and `createModerationModule({ database,
 * findVisibleBulletin })` mounted together. If satisfying it requires widening either
 * module's constructor dependencies, the coder/reviewer owns updating this test's
 * construction calls in the same PR — the failing-test contract fixes the *behaviour*
 * asserted below, not these two call sites' exact shape (ratified decision (c) sets
 * this same precedent for L3a's first consumer of L2's projection).
 *
 * **Interface assumption #2**: `ReportBulletinService`/`DismissBulletinService` take a
 * `findVisibleBulletin: (actorId: string, bulletinId: string) => Promise<{ authorId:
 * string } | null>` dependency and use it before doing anything else — `null` throws
 * {@link ModerationTargetUnavailableError} uniformly for "never existed" and "not
 * authorized to see", the same "one error, several situations" discipline `bulletins/
 * domain/bulletin.errors.ts`'s `BulletinGoneError` already establishes, and it is what
 * makes M2-AC14's indistinguishability requirement hold by construction here too. A
 * plain function rather than a `VisibleBulletinsRepository`-shaped port: moderation
 * cannot import that type's real implementation (persistence, cross-module) any more
 * than it can the repository, and a narrower function is the smallest thing that lets
 * a test supply a working implementation without one. This test's own implementation
 * (`findVisibleBulletinViaRouter`, below) calls `bulletinsModule.router`'s `getById` —
 * the coder/reviewer owns whether production composition wires the same adapter or a
 * more direct one (e.g. built once in `composition/container.ts`, which is exempt from
 * `no-cross-module-persistence`).
 *
 * **Interface assumption #3**: M2-AC10's "notifications" clause is proven by a
 * zero-`outbox_events`-rows assertion rather than by reading a notifications
 * response — `modules/notifications` is L3b-notify's, parallel to this lane, and the
 * lane brief's "must not touch `modules/notifications`" line means this suite cannot
 * import it. Reporting emitting no outbox row at all is the minimal, lane-local
 * guarantee that no future notifications consumer can be handed the reporter's
 * identity: there is nothing here for one to read.
 */
describe('moderation report and dismiss (moderation-report-dismiss.feature, M2-AC1/AC10/AC11/AC14/AC18/AC19)', () => {
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

  async function seedOnboardedUser(handle: string): Promise<{ userId: string; authUserId: string; handle: string }> {
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
    return { userId, authUserId, handle };
  }

  async function seedAcceptedConnection(userAId: string, userBId: string): Promise<void> {
    await testDatabase.client.query(
      `insert into app.connections
         (user_a_id, user_b_id, status, a_discloses_to_b_level, b_discloses_to_a_level, created_at)
       values ($1, $2, 'accepted', 'full', 'full', now())`,
      [userAId, userBId],
    );
  }

  async function outboxRowCount(): Promise<number> {
    const { rows } = await testDatabase.client.query<{ count: string }>(
      'select count(*)::text as count from app.outbox_events',
    );
    return Number(rows[0]?.count ?? '0');
  }

  async function bulletinReportsRowCount(): Promise<number> {
    const { rows } = await testDatabase.client.query<{ count: string }>(
      'select count(*)::text as count from app.bulletin_reports',
    );
    return Number(rows[0]?.count ?? '0');
  }

  /** A context that skips JWT verification, for scenarios that only need an `Actor`. */
  function contextForActor(actor: { userId: string; handle: string }): RequestContext {
    const outcome: AuthenticationOutcome = {
      kind: 'authenticated',
      principal: { authUserId: 'unused-in-this-suite' },
      actor,
    };
    return {
      correlationId: 'correlation-id-for-test',
      logger: createLogger({ level: 'silent' }),
      authentication: () => Promise.resolve(outcome),
    };
  }

  /** A real-JWT context, for the two `@e2e` scenarios that prove the full auth stack. */
  function contextForAuthorizationHeader(
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

  /**
   * `findVisibleBulletin` implemented over `bulletinsModule.router` — see interface
   * assumption #2. Any error from `getById` (including `BulletinGoneError`, mapped to
   * `NOT_FOUND` by the router) means "not visible", which is exactly `null`.
   */
  function findVisibleBulletinViaRouter(
    bulletinsModule: BulletinsModule,
  ): (actorId: string, bulletinId: string) => Promise<{ authorId: string } | null> {
    const createCaller = createCallerFactory(router({ bulletins: bulletinsModule.router }));
    return async (actorId, bulletinId) => {
      const caller = createCaller(contextForActor({ userId: actorId, handle: 'unused-handle' }));
      try {
        const bulletin = await caller.bulletins.getById({ bulletinId });
        return { authorId: bulletin.author.userId };
      } catch {
        return null;
      }
    };
  }

  describe('Scenario: Reporting a bulletin immediately hides it from the reporter (@e2e, API-level, M2-AC1)', () => {
    it("is absent from the reporter's board immediately after reporting", async () => {
      const bulletinsModule: BulletinsModule = createBulletinsModule({
        database,
        hiddenBulletins: createPostgresModerationRepository({ database }),
      });
      const moderationModule: ModerationModule = createModerationModule({
        database,
        findVisibleBulletin: findVisibleBulletinViaRouter(bulletinsModule),
      });
      const createCaller = createCallerFactory(
        router({ bulletins: bulletinsModule.router, moderation: moderationModule.router }),
      );

      const userA = await seedOnboardedUser('dusty_mod_hide_a');
      const viewerV = await seedOnboardedUser('dusty_mod_hide_v');
      await seedAcceptedConnection(userA.userId, viewerV.userId);

      const { actorResolver } = createIdentityModule({ database });
      const dependencies = {
        accessTokenVerifier: createSupabaseJwtVerifier({ keySource: signingKey.publicKey }),
        actorResolver,
      };
      const tokenFor = async (authUserId: string): Promise<string> =>
        mintSupabaseAsymmetricUserToken({ signingKey, role: 'authenticated', subject: authUserId });
      const callerFor = (authorizationHeader: string): ReturnType<typeof createCaller> =>
        createCaller(contextForAuthorizationHeader(authorizationHeader, dependencies));

      const callerA = callerFor(`Bearer ${await tokenFor(userA.authUserId)}`);
      const callerV = callerFor(`Bearer ${await tokenFor(viewerV.authUserId)}`);

      const created = await callerA.bulletins.create({
        type: 'request',
        title: 'Need a lantern',
        body: 'Mine broke on the walk in.',
      });

      const beforeReport = await callerV.bulletins.board({});
      expect(beforeReport.items.some((item) => item.id === created.id)).toBe(true);

      await callerV.moderation.report({ bulletinId: created.id });

      const afterReport = await callerV.bulletins.board({});
      expect(afterReport.items.some((item) => item.id === created.id)).toBe(false);
    });
  });

  describe('Scenario: A reported bulletin remains visible to other eligible viewers (@integration, M2-AC10)', () => {
    it("stays on viewer W's board after viewer V reports it", async () => {
      const userA = await seedOnboardedUser('dusty_mod_others_a');
      const viewerV = await seedOnboardedUser('dusty_mod_others_v');
      const viewerW = await seedOnboardedUser('dusty_mod_others_w');
      await seedAcceptedConnection(userA.userId, viewerV.userId);
      await seedAcceptedConnection(userA.userId, viewerW.userId);

      const moderationRepo = createPostgresModerationRepository({ database });
      const bulletinsModule: BulletinsModule = createBulletinsModule({
        database,
        hiddenBulletins: moderationRepo,
      });
      const bulletinsCaller = createCallerFactory(router({ bulletins: bulletinsModule.router }))(
        contextForActor(userA),
      );
      const reportBulletin = createReportBulletinService({
        moderation: moderationRepo,
        findVisibleBulletin: findVisibleBulletinViaRouter(bulletinsModule),
      });

      const created = await bulletinsCaller.bulletins.create({
        type: 'request',
        title: "User A's bulletin",
        body: 'Reported by V, still fine for W.',
      });

      await reportBulletin.report({ actorId: viewerV.userId, bulletinId: created.id });

      const boardForW = await createCallerFactory(router({ bulletins: bulletinsModule.router }))(
        contextForActor(viewerW),
      ).bulletins.board({});
      expect(boardForW.items.some((item) => item.id === created.id)).toBe(true);
    });
  });

  describe("Scenario: The reporter's identity never reaches the author (@integration, M2-AC10, B9)", () => {
    it("keeps viewer V out of the bulletin read, the author's own list, and the outbox", async () => {
      const userA = await seedOnboardedUser('dusty_mod_privacy_a');
      const viewerV = await seedOnboardedUser('dusty_mod_privacy_v');
      await seedAcceptedConnection(userA.userId, viewerV.userId);

      const bulletinsModule: BulletinsModule = createBulletinsModule({ database });
      const authorCaller = createCallerFactory(router({ bulletins: bulletinsModule.router }))(
        contextForActor(userA),
      );
      const moderationRepo = createPostgresModerationRepository({ database });
      const reportBulletin = createReportBulletinService({
        moderation: moderationRepo,
        findVisibleBulletin: findVisibleBulletinViaRouter(bulletinsModule),
      });

      const created = await authorCaller.bulletins.create({
        type: 'request',
        title: "User A's bulletin",
        body: 'V is about to report this one.',
      });
      const outboxBeforeReport = await outboxRowCount();

      await reportBulletin.report({ actorId: viewerV.userId, bulletinId: created.id });

      const readAsAuthor = await authorCaller.bulletins.getById({ bulletinId: created.id });
      const ownList = await authorCaller.bulletins.listMine();

      const readJson = JSON.stringify(readAsAuthor);
      const ownListJson = JSON.stringify(ownList);
      expect(readJson).not.toContain(viewerV.userId);
      expect(readJson).not.toContain('dusty_mod_privacy_v');
      expect(ownListJson).not.toContain(viewerV.userId);
      expect(ownListJson).not.toContain('dusty_mod_privacy_v');

      // Notifications proxy — see the class-level doc comment's interface assumption
      // #3: reporting must write zero outbox rows, so there is nothing a future
      // notifications consumer could read the reporter's identity from.
      expect(await outboxRowCount()).toBe(outboxBeforeReport);
    });
  });

  describe('Scenario: Dismissing a bulletin removes it only for the dismissing viewer (@e2e, API-level, M2-AC11)', () => {
    it("is absent from viewer V's board and still present on viewer W's board", async () => {
      const bulletinsModule: BulletinsModule = createBulletinsModule({
        database,
        hiddenBulletins: createPostgresModerationRepository({ database }),
      });
      const moderationModule: ModerationModule = createModerationModule({
        database,
        findVisibleBulletin: findVisibleBulletinViaRouter(bulletinsModule),
      });
      const createCaller = createCallerFactory(
        router({ bulletins: bulletinsModule.router, moderation: moderationModule.router }),
      );

      const userA = await seedOnboardedUser('dusty_mod_dismiss_a');
      const viewerV = await seedOnboardedUser('dusty_mod_dismiss_v');
      const viewerW = await seedOnboardedUser('dusty_mod_dismiss_w');
      await seedAcceptedConnection(userA.userId, viewerV.userId);
      await seedAcceptedConnection(userA.userId, viewerW.userId);

      const { actorResolver } = createIdentityModule({ database });
      const dependencies = {
        accessTokenVerifier: createSupabaseJwtVerifier({ keySource: signingKey.publicKey }),
        actorResolver,
      };
      const tokenFor = async (authUserId: string): Promise<string> =>
        mintSupabaseAsymmetricUserToken({ signingKey, role: 'authenticated', subject: authUserId });
      const callerFor = (authorizationHeader: string): ReturnType<typeof createCaller> =>
        createCaller(contextForAuthorizationHeader(authorizationHeader, dependencies));

      const callerA = callerFor(`Bearer ${await tokenFor(userA.authUserId)}`);
      const callerV = callerFor(`Bearer ${await tokenFor(viewerV.authUserId)}`);
      const callerW = callerFor(`Bearer ${await tokenFor(viewerW.authUserId)}`);

      const created = await callerA.bulletins.create({
        type: 'request',
        title: 'Need two more tarps',
        body: 'Dust storm coming in tonight.',
      });

      await callerV.moderation.dismiss({ bulletinId: created.id });

      const boardForV = await callerV.bulletins.board({});
      const boardForW = await callerW.bulletins.board({});

      expect(boardForV.items.some((item) => item.id === created.id)).toBe(false);
      expect(boardForW.items.some((item) => item.id === created.id)).toBe(true);
    });
  });

  describe('Scenario: Reporting your own bulletin is rejected (@integration, M2-AC18)', () => {
    it('answers a structured error with a stable code', async () => {
      const userA = await seedOnboardedUser('dusty_mod_own_a');
      const bulletinsModule: BulletinsModule = createBulletinsModule({ database });
      const authorCaller = createCallerFactory(router({ bulletins: bulletinsModule.router }))(
        contextForActor(userA),
      );
      const moderationRepo = createPostgresModerationRepository({ database });
      const reportBulletin = createReportBulletinService({
        moderation: moderationRepo,
        findVisibleBulletin: findVisibleBulletinViaRouter(bulletinsModule),
      });

      const created = await authorCaller.bulletins.create({
        type: 'request',
        title: "User A's own bulletin",
        body: 'A tries to report their own thing.',
      });

      await expect(
        reportBulletin.report({ actorId: userA.userId, bulletinId: created.id }),
      ).rejects.toMatchObject({ code: CannotReportOwnBulletinError.code });
    });
  });

  /**
   * M2-AC19's evidence clause: "a quoted error response plus `SELECT count(*)`
   * unchanged on both the entity table and `outbox_events`" — the row-count
   * assertions are what distinguish this scenario from the M2-AC18 scenario above,
   * which only requires the structured-error half.
   */
  describe('Scenario: bulletin.report and bulletin.dismiss fail closed for an unrelated actor (@integration, M2-AC19, B13)', () => {
    it('rejects actor C on bulletin.report with zero report rows and zero outbox rows', async () => {
      const userA = await seedOnboardedUser('dusty_mod_unrelated_a');
      const actorC = await seedOnboardedUser('dusty_mod_unrelated_c');
      const bulletinsModule: BulletinsModule = createBulletinsModule({ database });
      const authorCaller = createCallerFactory(router({ bulletins: bulletinsModule.router }))(
        contextForActor(userA),
      );
      const moderationRepo = createPostgresModerationRepository({ database });
      const reportBulletin = createReportBulletinService({
        moderation: moderationRepo,
        findVisibleBulletin: findVisibleBulletinViaRouter(bulletinsModule),
      });

      const created = await authorCaller.bulletins.create({
        type: 'request',
        title: "User A's bulletin",
        body: 'Actor C has no relationship to this at all.',
      });
      const outboxBefore = await outboxRowCount();

      await expect(
        reportBulletin.report({ actorId: actorC.userId, bulletinId: created.id }),
      ).rejects.toBeInstanceOf(Error);

      expect(await bulletinReportsRowCount()).toBe(0);
      expect(await outboxRowCount()).toBe(outboxBefore);
    });
  });

  describe('Scenario: Reporting an invisible bulletin fails like reporting a non-existent one (@integration, M2-AC14, B17)', () => {
    it('answers identical status codes and byte-identical bodies for both', async () => {
      const userA = await seedOnboardedUser('dusty_mod_indist_a');
      const viewerC = await seedOnboardedUser('dusty_mod_indist_c');
      const bulletinsModule: BulletinsModule = createBulletinsModule({ database });
      const authorCaller = createCallerFactory(router({ bulletins: bulletinsModule.router }))(
        contextForActor(userA),
      );
      const moderationRepo = createPostgresModerationRepository({ database });
      const reportBulletin = createReportBulletinService({
        moderation: moderationRepo,
        findVisibleBulletin: findVisibleBulletinViaRouter(bulletinsModule),
      });

      const created = await authorCaller.bulletins.create({
        type: 'request',
        title: 'Invisible to viewer C',
        body: 'Viewer C is not connected to user A.',
      });

      const invisible: unknown = await reportBulletin
        .report({ actorId: viewerC.userId, bulletinId: created.id })
        .catch((error: unknown) => error);
      const nonExistent: unknown = await reportBulletin
        .report({ actorId: viewerC.userId, bulletinId: randomUUID() })
        .catch((error: unknown) => error);

      expect(invisible).toBeInstanceOf(ModerationTargetUnavailableError);
      expect(nonExistent).toBeInstanceOf(ModerationTargetUnavailableError);
      // "byte-identical bodies" — `ApplicationError.toJSON()` is exactly what a
      // transport serializes, so comparing its JSON string is the empty-diff evidence
      // M2-AC14 asks for, mirroring `board-visibility-query.integration.test.ts`'s own
      // indistinguishability assertion.
      expect(JSON.stringify(invisible)).toBe(JSON.stringify(nonExistent));
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
