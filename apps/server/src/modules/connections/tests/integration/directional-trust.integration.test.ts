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
import { createGetConnectionQuery } from '../../application/get-connection.query';
import { createSetConnectionTrustService } from '../../application/set-connection-trust.service';
import { createConnectionsModule, type ConnectionsModule } from '../../connections.module';
import { NotConnectedError } from '../../domain/connection.errors';
import { createPostgresConnectionTrustRepository } from '../../persistence/postgres-connection-trust.repository';
import { createPostgresConnectionRepository } from '../../persistence/postgres-connection.repository';

/**
 * `specs/features/directional-trust.feature` — one `@e2e` (API-level, M2-AC1's
 * "Directional trust changes" critical-flow item) plus six `@integration` scenarios,
 * M2-AC3 / M2-AC4 / M2-AC18 / M2-AC19.
 *
 * **Trust model this suite bakes in (ratified, m2-lane-briefs.md:488-494):** "unset"
 * trust is the ABSENCE of an `app.connection_trust` row, surfaced by a LEFT JOIN —
 * not a row with `trust = NULL`. `connection.accept` inserts no trust row at all;
 * `trust.set` upserts one; `SELECT trust` for a never-touched connection returns zero
 * rows, and a deliberately-set `0` is a real row with `trust = 0`. This is the same
 * decision `connections-schema-migration.integration.test.ts`'s
 * `app.connection_trust` describe block already pins at the schema level (nullable,
 * no default) — this file exercises the LEFT-JOIN-absence half through the
 * application layer.
 *
 * **M2-AC3's "reachable by the other party" surface, scoped to what this lane owns.**
 * The AC's evidence clause names six surfaces: graph read, board read, person sheet,
 * sync response, error envelope, conflict envelope. `modules/bulletins` (board) and
 * `modules/sync` do not exist yet — L2 must not touch them, and L3a/L4 build them
 * later. This suite proves the two surfaces L2 owns today — the connections read and
 * the graph module's person projection — plus the error-envelope clause. The
 * board/sync surfaces are M2-AC3's remaining evidence and are owed to L5's
 * "B5-B9/B13/B17 confirmed as a suite" pass (m2-lane-briefs.md:789), which is the
 * first point in the plan where every surface exists to inspect. Recorded as an AC
 * scoping note in this lane's test-writing report, not resolved unilaterally.
 *
 * **The conflict-envelope clause.** `directional-trust.feature`'s own header notes
 * "expectedVersion / conflict handling for trust.set is cut to M5 (ADR-0005 full
 * matrix)" — so M2 has no `trust.set` conflict envelope to inspect literally. This
 * suite instead proves the adjacent, buildable half of the same guarantee: ANY error
 * response for that connection (a validation failure on `trust.set` itself) carries
 * no trust field, and — per ADR-0005:69-75, "actorship is checked before version
 * comparison" — an actor with no relationship to the connection gets a plain
 * structured error, never a conflict envelope with `currentState`, because the
 * precedence gate never reaches version comparison for them. Recorded as an
 * AC-interpretation note.
 */
describe('directional trust (directional-trust.feature, M2-AC1/AC3/AC4/AC18/AC19)', () => {
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

  /**
   * Seeds an accepted connection directly, mirroring `invitations.integration.test.ts`'s
   * discipline of seeding through raw SQL rather than the invite flow when the fixture
   * under test is "an existing accepted connection" — going through accept for every
   * trust test would make trust assertions depend on a second, unrelated feature.
   *
   * `app.connections`' exact column shape is not ADR-pinned (see
   * `connections-schema-migration.integration.test.ts`'s header comment); this seed's
   * `(id, user_a_id, user_b_id, status, created_at)` shape is this file's own working
   * assumption, recorded as an AC ambiguity in the L2 test-writing report.
   */
  async function seedAcceptedConnection(userAId: string, userBId: string): Promise<string> {
    const { rows } = await testDatabase.client.query<{ id: string }>(
      `insert into app.connections (user_a_id, user_b_id, status, created_at)
       values ($1, $2, 'accepted', now()) returning id`,
      [userAId, userBId],
    );
    const id = rows[0]?.id;
    if (id === undefined) {
      throw new Error('seedAcceptedConnection: insert returned no row');
    }
    return id;
  }

  async function trustRowFor(ownerId: string, subjectId: string): Promise<{ trust: number | null }[]> {
    const { rows } = await testDatabase.client.query<{ trust: number | null }>(
      `select trust from app.connection_trust where owner_id = $1 and subject_id = $2`,
      [ownerId, subjectId],
    );
    return rows;
  }

  async function outboxRowCount(): Promise<number> {
    const { rows } = await testDatabase.client.query<{ count: string }>(
      'select count(*)::text as count from app.outbox_events',
    );
    return Number(rows[0]?.count ?? '0');
  }

  describe('Scenario: A user assigns private directional trust to an accepted connection (@e2e, API-level)', () => {
    it("shows trust 85 on user A's own read of the connection", async () => {
      const module: ConnectionsModule = createConnectionsModule({ database });
      const createCaller = createCallerFactory(router({ connections: module.router }));

      const userA = await seedOnboardedUser('dusty_trust_a');
      const userB = await seedOnboardedUser('dusty_trust_b');
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

      // `subjectUserId` / `otherUserId`, not `userId`: ADR-0002:180-181 forbids a
      // `userId` field on any procedure input and
      // `tests/fitness/viewer-id-provenance.fitness.test.ts` walks the built router to
      // fail the build on one. Naming the *subject* of an opinion is not the same act
      // as asserting who is holding it, and the field name has to say so.
      await callerA.connections.trust.set({ subjectUserId: userB.userId, trust: 85 });
      const own = await callerA.connections.connection.get({ otherUserId: userB.userId });

      expect(own.trust).toBe(85);
    });
  });

  describe('Scenario: Trust value is never present in a payload reachable by the other party', () => {
    it("keeps 85 and the trust field out of user B's own connection read and out of an error envelope for that connection", async () => {
      const userA = await seedOnboardedUser('dusty_trust_reach_a');
      const userB = await seedOnboardedUser('dusty_trust_reach_b');
      await seedAcceptedConnection(userA.userId, userB.userId);

      const connections = createPostgresConnectionRepository({ database });
      const trust = createPostgresConnectionTrustRepository({ database });
      const setTrust = createSetConnectionTrustService({ connections, trust });
      const getConnection = createGetConnectionQuery({ connections, trust });

      await setTrust.set({ actorId: userA.userId, subjectUserId: userB.userId, trust: 85 });

      // B's own read of the same connection carries only B's own directional trust
      // (unset), never A's 85 — trust is per-(owner, subject), not per-connection.
      const bRead = await getConnection.get({ actorId: userB.userId, otherUserId: userA.userId });
      expect(bRead.trust).toBeNull();
      expect(JSON.stringify(bRead)).not.toContain('85');

      // An error envelope for that connection, triggered by B: an out-of-range
      // trust value fails validation before any persistence write, and the
      // resulting error must carry no trust field at all — see this file's header
      // comment on the conflict-envelope clause.
      const errorEnvelope = await setTrust
        .set({ actorId: userB.userId, subjectUserId: userA.userId, trust: 101 })
        .catch((error: unknown) => error);

      expect(errorEnvelope).toBeInstanceOf(Error);
      const serialized = JSON.stringify(errorEnvelope, Object.getOwnPropertyNames(errorEnvelope as object));
      expect(serialized).not.toMatch(/"trust"/);
      expect(serialized).not.toContain('85');
    });
  });

  describe('Scenario: Trust value is never present in a payload reachable by a third party', () => {
    it('keeps no trust value or trust field in a third party attempt to read that connection', async () => {
      const userA = await seedOnboardedUser('dusty_trust_third_a');
      const userB = await seedOnboardedUser('dusty_trust_third_b');
      const actorC = await seedOnboardedUser('dusty_trust_third_c');
      await seedAcceptedConnection(userA.userId, userB.userId);

      const connections = createPostgresConnectionRepository({ database });
      const trust = createPostgresConnectionTrustRepository({ database });
      const setTrust = createSetConnectionTrustService({ connections, trust });
      const getConnection = createGetConnectionQuery({ connections, trust });

      await setTrust.set({ actorId: userA.userId, subjectUserId: userB.userId, trust: 85 });

      const attempt = await getConnection
        .get({ actorId: actorC.userId, otherUserId: userA.userId })
        .catch((error: unknown) => error);

      expect(attempt).toBeInstanceOf(Error);
      const serialized = JSON.stringify(attempt, Object.getOwnPropertyNames(attempt as object));
      expect(serialized).not.toMatch(/"trust"/);
      expect(serialized).not.toContain('85');
    });
  });

  describe('Scenario: A connection with no trust assigned serializes as null, not zero', () => {
    it("serializes trust as null and leaves the underlying column with zero rows, not a NULL row", async () => {
      const userA = await seedOnboardedUser('dusty_trust_unset_a');
      const userB = await seedOnboardedUser('dusty_trust_unset_b');
      await seedAcceptedConnection(userA.userId, userB.userId);

      const connections = createPostgresConnectionRepository({ database });
      const trust = createPostgresConnectionTrustRepository({ database });
      const getConnection = createGetConnectionQuery({ connections, trust });

      const read = await getConnection.get({ actorId: userA.userId, otherUserId: userB.userId });
      expect(read.trust).toBeNull();

      // The ratified LEFT-JOIN-absence model: unset is zero rows, never a NULL row.
      expect(await trustRowFor(userA.userId, userB.userId)).toEqual([]);
    });
  });

  describe('Scenario: A deliberately-set trust of zero serializes as zero, not null', () => {
    it('serializes trust as 0 and leaves the underlying column at 0, not NULL', async () => {
      const userA = await seedOnboardedUser('dusty_trust_zero_a');
      const userB = await seedOnboardedUser('dusty_trust_zero_b');
      await seedAcceptedConnection(userA.userId, userB.userId);

      const connections = createPostgresConnectionRepository({ database });
      const trust = createPostgresConnectionTrustRepository({ database });
      const setTrust = createSetConnectionTrustService({ connections, trust });
      const getConnection = createGetConnectionQuery({ connections, trust });

      await setTrust.set({ actorId: userA.userId, subjectUserId: userB.userId, trust: 0 });

      const read = await getConnection.get({ actorId: userA.userId, otherUserId: userB.userId });
      expect(read.trust).toBe(0);

      const rows = await trustRowFor(userA.userId, userB.userId);
      expect(rows).toEqual([{ trust: 0 }]);
      expect(rows[0]?.trust).not.toBeNull();
    });
  });

  describe('Scenario: Setting trust on a non-connection is rejected', () => {
    it('answers a structured error with a stable code', async () => {
      const userA = await seedOnboardedUser('dusty_trust_nonconn_a');
      const userC = await seedOnboardedUser('dusty_trust_nonconn_c');

      const connections = createPostgresConnectionRepository({ database });
      const trust = createPostgresConnectionTrustRepository({ database });
      const setTrust = createSetConnectionTrustService({ connections, trust });

      await expect(
        setTrust.set({ actorId: userA.userId, subjectUserId: userC.userId, trust: 50 }),
      ).rejects.toMatchObject({ constructor: NotConnectedError, code: expect.any(String) });
    });
  });

  describe('Scenario: trust.set from an actor unrelated to the connection fails closed', () => {
    it('rejects actor C with a structured error, zero trust-column rows changed, and zero outbox rows', async () => {
      const userA = await seedOnboardedUser('dusty_trust_unrelated_a');
      const userB = await seedOnboardedUser('dusty_trust_unrelated_b');
      const actorC = await seedOnboardedUser('dusty_trust_unrelated_c');
      await seedAcceptedConnection(userA.userId, userB.userId);

      const connections = createPostgresConnectionRepository({ database });
      const trust = createPostgresConnectionTrustRepository({ database });
      const setTrust = createSetConnectionTrustService({ connections, trust });

      // Actorship checked before version comparison (ADR-0005:69-75) means C, who
      // is party to neither side of the A-B connection, never reaches a conflict
      // envelope — just a plain structured error.
      const rejection = await setTrust
        .set({ actorId: actorC.userId, subjectUserId: userA.userId, trust: 50 })
        .catch((error: unknown) => error);

      expect(rejection).toBeInstanceOf(Error);
      const serialized = JSON.stringify(rejection, Object.getOwnPropertyNames(rejection as object));
      expect(serialized).not.toMatch(/currentState/);

      expect(await trustRowFor(actorC.userId, userA.userId)).toEqual([]);
      expect(await trustRowFor(userA.userId, userB.userId)).toEqual([]);
      expect(await outboxRowCount()).toBe(0);
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
