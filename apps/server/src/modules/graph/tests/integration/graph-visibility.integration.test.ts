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
import { viewerIdFromActor, type ViewerId } from '../../../../shared/auth/viewer-id';
import type { RequestContext } from '../../../../shared/trpc/request-context';
import { createCallerFactory, router } from '../../../../shared/trpc/trpc';
// L1's public module factory, which is identity's whole public surface — never its
// persistence, domain, or an application service assembled by hand. `ActorResolver` is
// the one port identity exports (`identity.module.ts`), and `createIdentityModule` is
// the only sanctioned way to reach it: `no-cross-module-persistence` has no test
// exemption, so importing `postgres-user.repository` here would fail `pnpm boundaries`.
import { createIdentityModule } from '../../../identity/identity.module';
// None of these exist yet — legible failure at this seam until the coder writes them.
import { createListVisibleGraphQuery } from '../../application/list-visible-graph.query';
import { createGraphModule, type GraphModule } from '../../graph.module';
import { createPostgresVisibleEdgesRepository } from '../../persistence/postgres-visible-edges.repository';
import { createPostgresVisiblePeopleRepository } from '../../persistence/postgres-visible-people.repository';

/**
 * `specs/features/graph-visibility.feature` — one `@e2e` (API-level, M2-AC1's
 * "Graph visibility" critical-flow item) plus two `@integration` scenarios,
 * M2-AC5 (the graph half of B5).
 *
 * Drives `app.visible_people` (ADR-0004:25-42, M2.7) through
 * `ListVisibleGraphQuery` — the same seam
 * `visible-people-migration.integration.test.ts` proves the function's catalog shape
 * for. This suite proves the *behavior*: who the function returns and what it
 * withholds, per the §6a projection rule.
 *
 * **`app.connections`' disclosure column is not ADR-pinned in this lane** (see
 * `connections-schema-migration.integration.test.ts`'s and
 * `directional-trust.integration.test.ts`'s header comments on the same gap). This
 * file's seeding helper assumes two columns, `a_discloses_to_b_level` and
 * `b_discloses_to_a_level`, each `'full' | 'limited'` — i.e. each party's disclosure
 * level *toward* the other, independently settable. This is this file's own working
 * assumption, recorded as an AC ambiguity in the L2 test-writing report; the coder's
 * migration and `app.visible_people` must match it or this seed needs updating in
 * the same PR.
 */
describe('graph visibility (graph-visibility.feature, M2-AC1/AC5)', () => {
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

  describe("Scenario: The graph renders the viewer's accepted connection (@e2e, API-level)", () => {
    it("shows user B in user A's graph as a first-degree connection", async () => {
      const module: GraphModule = createGraphModule({ database });
      const createCaller = createCallerFactory(router({ graph: module.router }));

      const userA = await seedOnboardedUser('dusty_graph_a');
      const userB = await seedOnboardedUser('dusty_graph_b');
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

      const graph = await callerA.graph.list();

      expect(graph.people.some((person) => person.userId === userB.userId)).toBe(true);
    });
  });

  describe('Scenario: A viewer with no relationship to either party gets zero graph rows', () => {
    it("returns zero rows referencing user A or user B in user C's graph", async () => {
      const userA = await seedOnboardedUser('dusty_graph_zero_a');
      const userB = await seedOnboardedUser('dusty_graph_zero_b');
      const userC = await seedOnboardedUser('dusty_graph_zero_c');
      await seedAcceptedConnection(userA.userId, userB.userId);

      const visiblePeople = createPostgresVisiblePeopleRepository({ database });
      const visibleEdges = createPostgresVisibleEdgesRepository({ database });
      const listVisibleGraph = createListVisibleGraphQuery({ visiblePeople, visibleEdges });

      const graph = await listVisibleGraph.list({ viewerId: asViewer(userC.userId, 'dusty_graph_zero_c') });

      expect(graph.people.some((person) => person.userId === userA.userId)).toBe(false);
      expect(graph.people.some((person) => person.userId === userB.userId)).toBe(false);
    });
  });

  describe('Scenario: A connection below full disclosure renders with no identifying fields', () => {
    it("shows user B's node with no name, handle, or avatar in user A's graph", async () => {
      const userA = await seedOnboardedUser('dusty_graph_below_a');
      const userB = await seedOnboardedUser('dusty_graph_below_b');
      await seedAcceptedConnection(userA.userId, userB.userId, { bTowardA: 'limited' });

      const visiblePeople = createPostgresVisiblePeopleRepository({ database });
      const visibleEdges = createPostgresVisibleEdgesRepository({ database });
      const listVisibleGraph = createListVisibleGraphQuery({ visiblePeople, visibleEdges });

      const graph = await listVisibleGraph.list({
        viewerId: asViewer(userA.userId, 'dusty_graph_below_a'),
      });
      const bNode = graph.people.find((person) => person.userId === userB.userId);

      expect(bNode).toBeDefined();
      expect(bNode?.displayName).toBeUndefined();
      expect(bNode?.handle).toBeUndefined();
      expect(bNode?.avatarUrl).toBeUndefined();
      expect(JSON.stringify(bNode)).not.toContain('dusty_graph_below_b');
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

/**
 * A seeded user as a {@link ViewerId}.
 *
 * `ListVisibleGraphQuery` takes the branded `ViewerId`, never a `string`: ADR-0002 §5a
 * names a viewer identifier arriving from request input as the catastrophic bug in
 * this architecture, and the brand is the only thing standing in its way now that RLS
 * is not the enforcement mechanism. `viewerIdFromActor` is the single sanctioned
 * constructor and it takes an `Actor`, so a test builds the actor it just seeded
 * rather than casting a string — adding a second constructor "for tests" is precisely
 * what `shared/auth/viewer-id.ts` tells the next reader not to do.
 */
function asViewer(userId: string, handle: string): ViewerId {
  return viewerIdFromActor({ userId, handle });
}

/** Mirrors `packages/database/src/database-schema.integration.test.ts`'s helper. */
function asRole(connectionString: string, username: string, password: string): string {
  const url = new URL(connectionString);
  url.username = username;
  url.password = password;
  return url.toString();
}
