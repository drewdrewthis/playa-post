import { randomUUID } from 'node:crypto';

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { createDatabaseConnection, type DatabaseConnection } from '@playa-post/database';
import { startPostgresTestDatabase, type PostgresTestDatabase } from '@playa-post/testing';

import { viewerIdFromActor, type ViewerId } from '../../../../shared/auth/viewer-id';
import { createGraphModule } from '../../graph.module';

/**
 * `graph.list`'s edges — the lines the cluster view draws between the nodes.
 *
 * **The scenarios are ordered by what they protect.** The first two are the feature
 * (your own edges, and two of your people who know each other); the rest are the
 * privacy invariant, which is the reason this read is safe to serve at all: an edge is
 * emitted only when *both* endpoints are already in `app.visible_people(viewer_id)`, so
 * it can reveal the shape of a network the viewer can already see and can never reveal
 * that somebody exists.
 *
 * Driven through `createGraphModule` rather than through a hand-assembled query, because
 * the wiring — two repositories over two SQL functions, answered as one snapshot — is
 * part of what is being asserted.
 */
describe('graph edges (#44 cluster view)', () => {
  let testDatabase: PostgresTestDatabase;
  let database: DatabaseConnection;

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

  async function seedConnection(
    userAId: string,
    userBId: string,
    status: 'accepted' | 'removed' = 'accepted',
  ): Promise<void> {
    await testDatabase.client.query(
      `insert into app.connections
         (user_a_id, user_b_id, status, a_discloses_to_b_level, b_discloses_to_a_level, created_at)
       values ($1, $2, $3, 'full', 'full', now())`,
      [userAId, userBId, status],
    );
  }

  /** The pair as the wire renders it: canonically ordered, so a test can compare sets. */
  function pair(left: string, right: string): { personAId: string; personBId: string } {
    return left < right
      ? { personAId: left, personBId: right }
      : { personAId: right, personBId: left };
  }

  async function edgesFor(userId: string, handle: string) {
    const { visiblePeople } = createGraphModule({ database });
    return (await visiblePeople.list({ viewerId: asViewer(userId, handle) })).edges;
  }

  describe("Scenario: The viewer's own connections are edges", () => {
    it('answers one edge between the viewer and each first-degree person', async () => {
      const viewer = await seedOnboardedUser('dusty_edge_self');
      const first = await seedOnboardedUser('dusty_edge_first');
      const second = await seedOnboardedUser('dusty_edge_second');
      await seedConnection(viewer.userId, first.userId);
      await seedConnection(second.userId, viewer.userId);

      const edges = await edgesFor(viewer.userId, 'dusty_edge_self');

      expect(new Set(edges)).toEqual(
        new Set([pair(viewer.userId, first.userId), pair(viewer.userId, second.userId)]),
      );
    });

    it('canonicalises the pair regardless of which column the connection was stored in', async () => {
      // The second connection above was seeded viewer-second, i.e. with the viewer in
      // `user_b_id`. Both come back in the same order, so a client keys a rendered line
      // by the pair without normalising.
      const viewer = await seedOnboardedUser('dusty_edge_order_v');
      const other = await seedOnboardedUser('dusty_edge_order_o');
      await seedConnection(other.userId, viewer.userId);

      const edges = await edgesFor(viewer.userId, 'dusty_edge_order_v');

      expect(edges).toEqual([pair(viewer.userId, other.userId)]);
      expect(edges[0]?.personAId.localeCompare(edges[0].personBId)).toBeLessThan(0);
    });
  });

  describe('Scenario: Two of the viewer\'s own people who know each other', () => {
    it('answers the edge between them — the cluster the graph screen draws', async () => {
      const viewer = await seedOnboardedUser('dusty_cluster_v');
      const left = await seedOnboardedUser('dusty_cluster_l');
      const right = await seedOnboardedUser('dusty_cluster_r');
      await seedConnection(viewer.userId, left.userId);
      await seedConnection(viewer.userId, right.userId);
      await seedConnection(left.userId, right.userId);

      const edges = await edgesFor(viewer.userId, 'dusty_cluster_v');

      expect(new Set(edges)).toEqual(
        new Set([
          pair(viewer.userId, left.userId),
          pair(viewer.userId, right.userId),
          pair(left.userId, right.userId),
        ]),
      );
    });
  });

  describe('Scenario: An edge never names somebody the viewer cannot see', () => {
    it("omits a first-degree person's connection to a stranger", async () => {
      // The privacy invariant, stated as the case that would break it: `left` is
      // visible, `stranger` is not, and the edge between them must not be emitted —
      // otherwise a cluster view becomes a way to enumerate people outside the network.
      const viewer = await seedOnboardedUser('dusty_stranger_v');
      const left = await seedOnboardedUser('dusty_stranger_l');
      const stranger = await seedOnboardedUser('dusty_stranger_s');
      await seedConnection(viewer.userId, left.userId);
      await seedConnection(left.userId, stranger.userId);

      const edges = await edgesFor(viewer.userId, 'dusty_stranger_v');

      expect(edges).toEqual([pair(viewer.userId, left.userId)]);
      expect(JSON.stringify(edges)).not.toContain(stranger.userId);
    });

    it('names nobody who is absent from the same response\'s people list', async () => {
      // The invariant as a property rather than as a case: whatever the network shape,
      // every identifier in `edges` also appears in `people`. A client may render a node
      // only from `people`, and this is what makes that safe.
      const viewer = await seedOnboardedUser('dusty_closed_v');
      const left = await seedOnboardedUser('dusty_closed_l');
      const right = await seedOnboardedUser('dusty_closed_r');
      const stranger = await seedOnboardedUser('dusty_closed_s');
      await seedConnection(viewer.userId, left.userId);
      await seedConnection(viewer.userId, right.userId);
      await seedConnection(left.userId, right.userId);
      await seedConnection(right.userId, stranger.userId);

      const { visiblePeople } = createGraphModule({ database });
      const graph = await visiblePeople.list({
        viewerId: asViewer(viewer.userId, 'dusty_closed_v'),
      });
      const known = new Set(graph.people.map((person) => person.userId));

      for (const edge of graph.edges) {
        expect(known.has(edge.personAId), `${edge.personAId} is an edge endpoint with no node`).toBe(
          true,
        );
        expect(known.has(edge.personBId), `${edge.personBId} is an edge endpoint with no node`).toBe(
          true,
        );
      }
      expect(graph.edges.length).toBeGreaterThan(0);
    });

    it('answers no edges at all to a viewer with no connections', async () => {
      const viewer = await seedOnboardedUser('dusty_lonely_v');
      const left = await seedOnboardedUser('dusty_lonely_l');
      const right = await seedOnboardedUser('dusty_lonely_r');
      await seedConnection(left.userId, right.userId);

      await expect(edgesFor(viewer.userId, 'dusty_lonely_v')).resolves.toEqual([]);
    });
  });

  describe('Scenario: A connection that is not accepted is not an edge', () => {
    it('omits it, so a removed connection stops drawing a line', async () => {
      const viewer = await seedOnboardedUser('dusty_removed_v');
      const other = await seedOnboardedUser('dusty_removed_o');
      await seedConnection(viewer.userId, other.userId, 'removed');

      await expect(edgesFor(viewer.userId, 'dusty_removed_v')).resolves.toEqual([]);
    });
  });

  describe('Scenario: An edge carries no weight (ADR-0004 decision 6, ADR-0002 B6)', () => {
    it('exposes exactly { personAId, personBId } even when trust is set on both sides', async () => {
      const viewer = await seedOnboardedUser('dusty_weight_v');
      const other = await seedOnboardedUser('dusty_weight_o');
      await seedConnection(viewer.userId, other.userId);
      await testDatabase.client.query(
        `insert into app.connection_trust (owner_id, subject_id, trust, updated_at)
         values ($1, $2, 87, now()), ($2, $1, 12, now())`,
        [viewer.userId, other.userId],
      );

      const edges = await edgesFor(viewer.userId, 'dusty_weight_v');

      // A full key-set equality rather than a subset match, so an accidentally-added
      // field fails this test rather than passing silently. The viewer's own trust is
      // still served, per person, on `people` — never on a line.
      expect(edges).toHaveLength(1);
      expect(Object.keys(edges[0] as object).sort()).toEqual(['personAId', 'personBId']);
      // Structural rather than a substring search for "87": identifiers are hex, so any
      // digit pair occurs in a UUID by chance and such an assertion would pass or fail
      // for reasons unrelated to what it claims to check. A weight would have to arrive
      // as a value that is not one of the two identifiers.
      expect(Object.values(edges[0] as object)).toEqual([
        expect.any(String),
        expect.any(String),
      ]);
    });
  });
});

/**
 * A seeded user as a {@link ViewerId}.
 *
 * `viewerIdFromActor` is the single sanctioned constructor and it takes an `Actor`, so a
 * test builds the actor it just seeded rather than casting a string — adding a second
 * constructor "for tests" is precisely what `shared/auth/viewer-id.ts` tells the next
 * reader not to do.
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
