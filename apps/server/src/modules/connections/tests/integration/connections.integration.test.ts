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
// L1's public module factory, which is identity's whole public surface — never its
// persistence, domain, or an application service assembled by hand. `ActorResolver` is
// the one port identity exports (`identity.module.ts`), and `createIdentityModule` is
// the only sanctioned way to reach it: `no-cross-module-persistence` has no test
// exemption, so importing `postgres-user.repository` here would fail `pnpm boundaries`.
import { createIdentityModule } from '../../../identity/identity.module';
// None of these exist yet — legible failure at this seam until the coder writes them.
import { createAcceptInviteService } from '../../application/accept-invite.service';
import { createCreateInviteService } from '../../application/create-invite.service';
import { createConnectionsModule, type ConnectionsModule } from '../../connections.module';
import { CannotAcceptOwnInviteError, InvitationUnavailableError } from '../../domain/invitation.errors';
import { createPostgresConnectionRepository } from '../../persistence/postgres-connection.repository';
import { createPostgresInvitationRepository } from '../../persistence/postgres-invitation.repository';

/**
 * `specs/features/connections.feature` — one `@e2e` (API-level, M2-AC1's "Invite and
 * connection acceptance" critical-flow item) plus four `@integration` scenarios,
 * M2-AC18 / M2-AC19.
 *
 * The `@e2e` scenario drives the full stack — real Postgres, the real
 * `connections.module.ts` router, real JWT verification via `authenticateRequest` —
 * exactly the shape `identity`'s `actor-resolution.integration.test.ts` uses for
 * M2-AC2, per m2-lane-briefs.md's "`@e2e` in L1-L4 is API-level" rule. The four
 * `@integration` scenarios call the application services directly against real
 * repositories: authorization, transactions, and SQL correctness are what they prove,
 * and none of them need a JWT to prove it.
 */
describe('connections (connections.feature, M2-AC1/AC18/AC19)', () => {
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

  async function outboxRowCount(): Promise<number> {
    const { rows } = await testDatabase.client.query<{ count: string }>(
      'select count(*)::text as count from app.outbox_events',
    );
    return Number(rows[0]?.count ?? '0');
  }

  async function connectionsRowCount(): Promise<number> {
    const { rows } = await testDatabase.client.query<{ count: string }>(
      'select count(*)::text as count from app.connections',
    );
    return Number(rows[0]?.count ?? '0');
  }

  describe('Scenario: Two users complete invite creation, opening, and acceptance (@e2e, API-level)', () => {
    it('creates an accepted connection between user A and user B through the real router and real auth', async () => {
      const module: ConnectionsModule = createConnectionsModule({ database });
      const createCaller = createCallerFactory(router({ connections: module.router }));

      const userA = await seedOnboardedUser('dusty_a');
      const userB = await seedOnboardedUser('dusty_b');

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

      const created = await callerA.connections.invitations.create();
      const opened = await callerB.connections.invitations.open({ token: created.token });
      expect(opened.inviterId).toBe(userA.userId);

      await callerB.connections.connection.accept({ token: created.token });

      const { rows } = await testDatabase.client.query<{
        user_a_id: string;
        user_b_id: string;
      }>(`select user_a_id, user_b_id from app.connections`);
      expect(rows).toHaveLength(1);
      expect([rows[0]?.user_a_id, rows[0]?.user_b_id].sort()).toEqual(
        [userA.userId, userB.userId].sort(),
      );
    });
  });

  describe('Scenario: Accepting your own invite is rejected', () => {
    it('answers a structured error with a stable code', async () => {
      const userA = await seedOnboardedUser('dusty_self_accept');
      const invitations = createPostgresInvitationRepository({ database });
      const connections = createPostgresConnectionRepository({ database });
      const createInvite = createCreateInviteService({ invitations });
      const acceptInvite = createAcceptInviteService({ invitations, connections });

      const { token } = await createInvite.create({ inviterId: userA.userId });

      await expect(
        acceptInvite.accept({ actorId: userA.userId, token }),
      ).rejects.toMatchObject({ constructor: CannotAcceptOwnInviteError, code: expect.any(String) });
    });
  });

  describe('Scenario: Accepting an already-accepted invite is idempotent', () => {
    it('answers success again and creates no second connection', async () => {
      const userA = await seedOnboardedUser('dusty_idem_a');
      const userB = await seedOnboardedUser('dusty_idem_b');
      const invitations = createPostgresInvitationRepository({ database });
      const connections = createPostgresConnectionRepository({ database });
      const createInvite = createCreateInviteService({ invitations });
      const acceptInvite = createAcceptInviteService({ invitations, connections });

      const { token } = await createInvite.create({ inviterId: userA.userId });
      await acceptInvite.accept({ actorId: userB.userId, token });
      expect(await connectionsRowCount()).toBe(1);

      await expect(acceptInvite.accept({ actorId: userB.userId, token })).resolves.toBeDefined();
      expect(await connectionsRowCount()).toBe(1);
    });
  });

  describe('Scenario: connection.accept from an unrelated actor fails closed', () => {
    /**
     * `connection.accept`'s input is the invite's opaque token (M2-AC17), not an
     * invitation ID a caller could assert ownership over — so this write path's
     * M2-AC19 IDOR surface is "does the actor hold a valid token for this invite",
     * not "does a submitted ID belong to the actor" as it would be for an ID-keyed
     * mutation. Actor C, who has never been handed A's token, is modeled here as
     * submitting a token they do not hold; the assertions (structured error, zero
     * `app.connections` rows, zero `app.outbox_events` rows) are M2-AC19's evidence
     * clause regardless of which shape the unrelated attempt takes. Recorded as an
     * AC-interpretation note in this lane's test-writing report.
     */
    it('rejects actor C with a structured error and zero state change', async () => {
      const userA = await seedOnboardedUser('dusty_unrelated_a');
      const actorC = await seedOnboardedUser('dusty_unrelated_c');
      const invitations = createPostgresInvitationRepository({ database });
      const connections = createPostgresConnectionRepository({ database });
      const createInvite = createCreateInviteService({ invitations });
      const acceptInvite = createAcceptInviteService({ invitations, connections });

      await createInvite.create({ inviterId: userA.userId });

      await expect(
        acceptInvite.accept({ actorId: actorC.userId, token: 'a-token-c-has-no-business-holding' }),
      ).rejects.toBeInstanceOf(Error);

      expect(await connectionsRowCount()).toBe(0);
      expect(await outboxRowCount()).toBe(0);
    });
  });

  describe('Scenario: Accepting a withdrawn invitation is refused', () => {
    it('answers INVITATION_UNAVAILABLE', async () => {
      const userA = await seedOnboardedUser('dusty_withdrawn_a');
      const userB = await seedOnboardedUser('dusty_withdrawn_b');

      const { rows } = await testDatabase.client.query<{ token: string }>(
        `insert into app.invitations (inviter_id, token, status, created_at)
         values ($1, $2, 'revoked', now()) returning token`,
        [userA.userId, randomUUID().replaceAll('-', '')],
      );
      const token = rows[0]?.token;
      if (token === undefined) {
        throw new Error('seed: insert returned no row');
      }

      const invitations = createPostgresInvitationRepository({ database });
      const connections = createPostgresConnectionRepository({ database });
      const acceptInvite = createAcceptInviteService({ invitations, connections });

      await expect(
        acceptInvite.accept({ actorId: userB.userId, token }),
      ).rejects.toMatchObject({ constructor: InvitationUnavailableError, code: 'INVITATION_UNAVAILABLE' });
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
