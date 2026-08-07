import { randomUUID } from 'node:crypto';

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { createDatabaseConnection, type DatabaseConnection } from '@playa-post/database';
import { startPostgresTestDatabase, type PostgresTestDatabase } from '@playa-post/testing';

// None of these exist yet — legible failure at this seam until the coder writes them.
import { createListVisibleGraphQuery } from '../../apps/server/src/modules/graph/application/list-visible-graph.query';
import { createPostgresVisibleEdgesRepository } from '../../apps/server/src/modules/graph/persistence/postgres-visible-edges.repository';
import { createPostgresVisiblePeopleRepository } from '../../apps/server/src/modules/graph/persistence/postgres-visible-people.repository';
import {
  viewerIdFromActor,
  type ViewerId,
} from '../../apps/server/src/shared/auth/viewer-id';

/**
 * ADR-0002 **B5**, graph half — "Visibility matrix, including the §6a
 * person-projection sub-case": "For each viewer-scoped query a viewer with no
 * relationship to the data gets 0 rows; an authorized bulletin whose author is
 * below `full` disclosure renders a Private author everywhere."
 *
 * `b-rows.manifest.json` flips B5 live in this PR **for the graph half only** — the
 * bulletin half of the same assertion needs `modules/bulletins`, which does not
 * exist until L3a, so it cannot be proven here. m2-lane-briefs.md:448-450 assigns
 * L2 exactly "B5 (visibility matrix, graph half incl. the §6a person-projection
 * sub-case)" and line 789 has L5 "confirming B5-B9/B13/B17 as a suite" once every
 * module exists. Recorded as an AC ambiguity in the L2 test-writing report: the
 * manifest's B5 `assertion` text still mentions "an authorized bulletin", which
 * this file's tests do not (and cannot yet) cover — the coder/reviewer should
 * confirm whether the manifest text needs a graph/bulletin split or whether L5's
 * confirmation pass is understood to complete it.
 *
 * This file is the behavioral proof; `graph-visibility.integration.test.ts` carries
 * the identical assertions as the feature-level scenarios. Duplication is
 * deliberate — a security-suite row must be provable by reading `tests/security/`
 * alone, without cross-referencing a module's own test tree, the same discipline
 * `baseline-catalog.security.test.ts` and `postgrest-schema-exposure.security.test.ts`
 * already follow.
 */
describe('B5 (graph half) — visibility matrix, §6a person-projection sub-case', () => {
  let testDatabase: PostgresTestDatabase;
  let database: DatabaseConnection;

  beforeAll(async () => {
    testDatabase = await startPostgresTestDatabase();
    await testDatabase.client.query(`alter role app_rw with password 'app_rw_in_a_throwaway_container'`);
    database = createDatabaseConnection({
      connectionString: asRole(testDatabase.connectionString, 'app_rw', 'app_rw_in_a_throwaway_container'),
    });
  }, 300_000);

  afterEach(async () => {
    await testDatabase.truncateAllTables();
  });

  afterAll(async () => {
    await database?.destroy();
    await testDatabase?.stop();
  });

  async function seedOnboardedUser(handle: string): Promise<string> {
    const { rows } = await testDatabase.client.query<{ id: string }>(
      `insert into app.users (auth_user_id, handle, display_name, created_at)
       values ($1, $2, $3, now()) returning id`,
      [randomUUID(), handle, handle],
    );
    const id = rows[0]?.id;
    if (id === undefined) {
      throw new Error('seedOnboardedUser: insert returned no row');
    }
    return id;
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

  it('gives an unrelated viewer 0 graph rows referencing either party of an accepted connection', async () => {
    const userA = await seedOnboardedUser('b5_graph_a');
    const userB = await seedOnboardedUser('b5_graph_b');
    const userC = await seedOnboardedUser('b5_graph_c');
    await seedAcceptedConnection(userA, userB);

    const visiblePeople = createPostgresVisiblePeopleRepository({ database });
    const visibleEdges = createPostgresVisibleEdgesRepository({ database });
    const listVisibleGraph = createListVisibleGraphQuery({ visiblePeople, visibleEdges });

    const graph = await listVisibleGraph.list({ viewerId: asViewer(userC, 'b5_graph_c') });

    expect(graph.people.some((person) => person.userId === userA || person.userId === userB)).toBe(
      false,
    );
    // The edge half of the same control. `graph.list` now also answers which of the
    // viewer's people know each other, and an edge is a second shape a relationship
    // could leak through — one that names two identifiers without naming a person. B5
    // is about the whole response, so it asserts over the whole response.
    expect(graph.edges).toEqual([]);
    expect(JSON.stringify(graph)).not.toContain(userA);
    expect(JSON.stringify(graph)).not.toContain(userB);
  });

  it('renders a below-full-disclosure connection with no name, handle, or avatar (§6a)', async () => {
    const userA = await seedOnboardedUser('b5_graph_below_a');
    const userB = await seedOnboardedUser('b5_graph_below_b');
    await seedAcceptedConnection(userA, userB, { bTowardA: 'limited' });

    const visiblePeople = createPostgresVisiblePeopleRepository({ database });
    const visibleEdges = createPostgresVisibleEdgesRepository({ database });
    const listVisibleGraph = createListVisibleGraphQuery({ visiblePeople, visibleEdges });

    const graph = await listVisibleGraph.list({ viewerId: asViewer(userA, 'b5_graph_below_a') });
    const bNode = graph.people.find((person) => person.userId === userB);

    expect(bNode).toBeDefined();
    expect(bNode?.displayName).toBeUndefined();
    expect(bNode?.handle).toBeUndefined();
    expect(bNode?.avatarUrl).toBeUndefined();
  });
});

/**
 * A seeded user as a {@link ViewerId}.
 *
 * `ListVisibleGraphQuery` takes the branded `ViewerId`, never a `string`: ADR-0002 §5a
 * names a viewer identifier arriving from request input as the catastrophic bug in
 * this architecture, and B14 is the row that guards it. `viewerIdFromActor` is the
 * single sanctioned constructor and it takes an `Actor`, so this builds the actor it
 * just seeded rather than casting a string — a security suite adding a second
 * constructor for its own convenience would be disarming the control it is here to
 * prove.
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
