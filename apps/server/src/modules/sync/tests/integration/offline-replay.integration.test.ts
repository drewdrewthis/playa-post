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
// L3a's router — the only sanctioned cross-module surface for this lane. Same
// `no-cross-module-persistence` reasoning as `modules/moderation/tests/integration/
// moderation-report-dismiss.integration.test.ts`'s doc comment: the fitness suite
// enforces the rule over this test file too, so sync cannot construct a
// `BulletinRepository` itself. Every bulletin fixture and read this suite needs goes
// through `bulletinsModule.router`.
import { createBulletinsModule, type BulletinsModule } from '../../../bulletins/bulletins.module';
import { createIdentityModule } from '../../../identity/identity.module';
// None of these exist yet — legible failure at this seam until the coder writes them.
import { createSubmitMutationsService } from '../../application/submit-mutations.service';
import type { MutationHandler } from '../../domain/mutation-handler';
import { MutationActorshipError, UnsupportedMutationTypeError } from '../../domain/sync.errors';
import { createPostgresMutationResultRepository } from '../../persistence/postgres-mutation-result.repository';
import { createSyncModule, type SyncModule } from '../../sync.module';

/**
 * `specs/features/offline-replay.feature` — 3 scenarios: 1 `@e2e` (API-level, real
 * router) and 2 `@integration` (`createSubmitMutationsService` called directly).
 *
 * **Interface assumption, recorded here as an AC ambiguity**: M2 wires exactly one
 * *replayable* handler — `bulletin.create` — into `handlers`, adapting `modules/
 * bulletins`'s router (its public application interface; never its persistence — see
 * `no-cross-module-persistence`, which this test file is itself subject to) into a
 * {@link MutationHandler}. This suite writes that adapter inline, authenticated with a
 * hand-built, non-JWT context per the acting actor, because the adapter is sync's own
 * concern (ADR-0005: "sync depends on modules' public application interfaces and
 * never on their internals") — the coder decides whether production composition
 * reuses this exact shape or builds a more direct one once in `composition/`, which is
 * exempt from the cross-module rule.
 *
 * **B-2 finding, applied**: the third scenario below is the one place this lane must
 * prove the pre-dispatch actorship gate runs *before* type-dispatch. `bulletin.archive`
 * has no M2 sync handler, so if the gate ran after dispatch the response would be
 * `rejected` / `UNSUPPORTED_MUTATION_TYPE` — a green test proving "M2 doesn't
 * implement this type" instead of "an unrelated actor is refused", exactly the
 * vacuous-B13 failure the lane brief's "sync half of B13 is not vacuously green"
 * section names. The assertion below is on the error *code*, not merely on rejection,
 * for that reason. The `actorshipChecks` map is this suite's own read-only adapter
 * (calls `bulletins.listMine` through the router, mutates nothing) — only
 * `bulletin.archive` is wired because it is the only non-replayable type this feature
 * file names.
 */
describe('offline sync — envelope replay and idempotency (offline-replay.feature, M2-AC9/AC19)', () => {
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

  /** A real-JWT context, for the one `@e2e` scenario that proves the full auth stack. */
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

  /** The `bulletin.create` adapter every scenario below reuses, over the router. */
  function bulletinCreateHandler(bulletinsModule: BulletinsModule): MutationHandler {
    const createCaller = createCallerFactory(router({ bulletins: bulletinsModule.router }));
    return {
      async handle({ actorId, payload }) {
        const p = payload as { type: 'request'; title: string; body: string };
        const caller = createCaller(contextForActor({ userId: actorId, handle: 'unused-handle' }));
        const bulletin = await caller.bulletins.create({ type: p.type, title: p.title, body: p.body });
        return { result: bulletin };
      },
    };
  }

  /** The `bulletin.archive` pre-dispatch actorship check, over the router. */
  function bulletinArchiveActorshipCheck(
    bulletinsModule: BulletinsModule,
  ): (command: { actorId: string; payload: unknown }) => Promise<void> {
    const createCaller = createCallerFactory(router({ bulletins: bulletinsModule.router }));
    return async ({ actorId, payload }) => {
      const { bulletinId } = payload as { bulletinId: string };
      const caller = createCaller(contextForActor({ userId: actorId, handle: 'unused-handle' }));
      const owned = await caller.bulletins.listMine();
      if (!owned.some((row) => row.id === bulletinId)) {
        throw new MutationActorshipError();
      }
    };
  }

  describe('Scenario: The same bulletin.create envelope submitted twice produces one bulletin (@e2e, API-level, M2-AC9)', () => {
    it('applies once and replays with an identical result on the second submission', async () => {
      const bulletinsModule: BulletinsModule = createBulletinsModule({ database });
      const syncModule: SyncModule = createSyncModule({
        database,
        handlers: { 'bulletin.create': bulletinCreateHandler(bulletinsModule) },
        actorshipChecks: {},
      });
      const createCaller = createCallerFactory(router({ sync: syncModule.router }));

      const userA = await seedOnboardedUser('dusty_sync_replay_a');
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

      const envelope = {
        mutationId: randomUUID(),
        mutationType: 'bulletin.create',
        clientCreatedAt: new Date().toISOString(),
        payload: { type: 'request' as const, title: 'Need a tent stake', body: 'Lost mine in the wind.' },
      };

      const first = await callerA.sync.submitMutations({ mutations: [envelope] });
      const second = await callerA.sync.submitMutations({ mutations: [envelope] });

      expect(first.results[0]?.outcome).toBe('applied');
      expect(second.results[0]?.outcome).toBe('replayed');
      expect(second.results[0]?.result).toEqual(first.results[0]?.result);
      expect(await bulletinsRowCount()).toBe(1);
    });
  });

  describe('Scenario: Same mutationId with a different payload is rejected (@integration, M2-AC9)', () => {
    it('returns rejected / IDEMPOTENCY_KEY_REUSE and creates no second bulletin', async () => {
      const userA = await seedOnboardedUser('dusty_sync_reuse_a');
      const bulletinsModule: BulletinsModule = createBulletinsModule({ database });
      const mutationResults = createPostgresMutationResultRepository({ database });
      const submitMutations = createSubmitMutationsService({
        mutationResults,
        handlers: { 'bulletin.create': bulletinCreateHandler(bulletinsModule) },
        actorshipChecks: {},
      });

      const mutationId = randomUUID();
      const first = await submitMutations.submit({
        actorId: userA.userId,
        envelopes: [
          {
            mutationId,
            mutationType: 'bulletin.create',
            clientCreatedAt: new Date().toISOString(),
            payload: { type: 'request', title: 'Need a bungee cord', body: 'Just one.' },
          },
        ],
      });
      expect(first.results[0]?.outcome).toBe('applied');

      const second = await submitMutations.submit({
        actorId: userA.userId,
        envelopes: [
          {
            mutationId,
            mutationType: 'bulletin.create',
            clientCreatedAt: new Date().toISOString(),
            payload: {
              type: 'request',
              title: 'A completely different bulletin',
              body: 'Different payload, same mutationId.',
            },
          },
        ],
      });

      expect(second.results[0]?.outcome).toBe('rejected');
      expect(second.results[0]?.error?.code).toBe('IDEMPOTENCY_KEY_REUSE');
      expect(await bulletinsRowCount()).toBe(1);
    });
  });

  describe('Scenario: Actorship is checked before version comparison over the sync envelope (@integration, M2-AC19, B13, B-2 ordering)', () => {
    it('rejects actor C with the actorship code, not UNSUPPORTED_MUTATION_TYPE, no conflict, and zero state change', async () => {
      const userA = await seedOnboardedUser('dusty_sync_actorship_a');
      const actorC = await seedOnboardedUser('dusty_sync_actorship_c');
      const bulletinsModule: BulletinsModule = createBulletinsModule({ database });
      const authorCaller = createCallerFactory(router({ bulletins: bulletinsModule.router }))(
        contextForActor(userA),
      );
      const mutationResults = createPostgresMutationResultRepository({ database });

      const created = await authorCaller.bulletins.create({
        type: 'request',
        title: "User A's bulletin",
        body: 'Actor C has no relationship to this at all.',
      });
      const outboxBefore = await outboxRowCount();

      // Deliberately no 'bulletin.archive' entry in `handlers` — M2 implements
      // exactly one replayable handler (`bulletin.create`). Only the pre-dispatch
      // actorship gate is wired for this type, which is the whole point of the test.
      const submitMutations = createSubmitMutationsService({
        mutationResults,
        handlers: {},
        actorshipChecks: { 'bulletin.archive': bulletinArchiveActorshipCheck(bulletinsModule) },
      });

      const response = await submitMutations.submit({
        actorId: actorC.userId,
        envelopes: [
          {
            mutationId: randomUUID(),
            mutationType: 'bulletin.archive',
            clientCreatedAt: new Date().toISOString(),
            payload: { bulletinId: created.id },
          },
        ],
      });

      const outcome = response.results[0];
      expect(outcome?.outcome).toBe('rejected');
      expect(outcome?.error?.code).toBe(MutationActorshipError.code);
      expect(outcome?.error?.code).not.toBe(UnsupportedMutationTypeError.code);
      expect(outcome?.conflict).toBeUndefined();

      const { rows } = await testDatabase.client.query<{ archived_at: Date | null }>(
        `select archived_at from app.bulletins where id = $1`,
        [created.id],
      );
      expect(rows[0]?.archived_at).toBeNull();
      expect(await outboxRowCount()).toBe(outboxBefore);
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
