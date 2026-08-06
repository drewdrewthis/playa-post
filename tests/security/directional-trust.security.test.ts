import { randomUUID } from 'node:crypto';

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { createDatabaseConnection, type DatabaseConnection } from '@playa-post/database';
import { startPostgresTestDatabase, type PostgresTestDatabase } from '@playa-post/testing';

// None of these exist yet — legible failure at this seam until the coder writes them.
import { createGetConnectionQuery } from '../../apps/server/src/modules/connections/application/get-connection.query';
import { createSetConnectionTrustService } from '../../apps/server/src/modules/connections/application/set-connection-trust.service';
import { createPostgresConnectionTrustRepository } from '../../apps/server/src/modules/connections/persistence/postgres-connection-trust.repository';
import { createPostgresConnectionRepository } from '../../apps/server/src/modules/connections/persistence/postgres-connection.repository';

/**
 * ADR-0002 **B6** — "Directional trust never leaves the holder": "A trust value and
 * its field name appear nowhere in any payload returned to the other party or a
 * third party, at any nesting depth, across success, error, and conflict envelopes."
 *
 * Same discipline as `visibility-matrix.security.test.ts`: this file must stand
 * alone as `tests/security/`'s proof of the row, even though
 * `directional-trust.integration.test.ts` carries the identical scenarios read off
 * the feature file. That test's header comment records the scoping and
 * conflict-envelope AC-interpretation notes this file inherits without repeating.
 */
describe('B6 — directional trust never leaves the holder', () => {
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

  async function seedAcceptedConnection(userAId: string, userBId: string): Promise<void> {
    await testDatabase.client.query(
      `insert into app.connections (user_a_id, user_b_id, status, created_at)
       values ($1, $2, 'accepted', now())`,
      [userAId, userBId],
    );
  }

  it("keeps A's trust value out of B's own connection read, at any nesting depth", async () => {
    const userA = await seedOnboardedUser('b6_trust_a');
    const userB = await seedOnboardedUser('b6_trust_b');
    await seedAcceptedConnection(userA, userB);

    const connections = createPostgresConnectionRepository({ database });
    const trust = createPostgresConnectionTrustRepository({ database });
    const setTrust = createSetConnectionTrustService({ connections, trust });
    const getConnection = createGetConnectionQuery({ connections, trust });

    await setTrust.set({ actorId: userA, subjectUserId: userB, trust: 85 });

    const bRead = await getConnection.get({ actorId: userB, otherUserId: userA });

    expect(JSON.stringify(bRead)).not.toContain('85');
  });

  it('keeps the trust value and field name out of a third party error envelope for that connection', async () => {
    const userA = await seedOnboardedUser('b6_trust_third_a');
    const userB = await seedOnboardedUser('b6_trust_third_b');
    const actorC = await seedOnboardedUser('b6_trust_third_c');
    await seedAcceptedConnection(userA, userB);

    const connections = createPostgresConnectionRepository({ database });
    const trust = createPostgresConnectionTrustRepository({ database });
    const setTrust = createSetConnectionTrustService({ connections, trust });
    const getConnection = createGetConnectionQuery({ connections, trust });

    await setTrust.set({ actorId: userA, subjectUserId: userB, trust: 85 });

    const attempt = await getConnection
      .get({ actorId: actorC, otherUserId: userA })
      .catch((error: unknown) => error);

    expect(attempt).toBeInstanceOf(Error);
    const serialized = JSON.stringify(attempt, Object.getOwnPropertyNames(attempt as object));
    expect(serialized).not.toMatch(/"trust"/);
    expect(serialized).not.toContain('85');
  });

  it('gives an actor unrelated to the connection a plain error, never a conflict envelope carrying currentState (ADR-0005:69-75)', async () => {
    const userA = await seedOnboardedUser('b6_trust_conflict_a');
    const userB = await seedOnboardedUser('b6_trust_conflict_b');
    const actorC = await seedOnboardedUser('b6_trust_conflict_c');
    await seedAcceptedConnection(userA, userB);

    const connections = createPostgresConnectionRepository({ database });
    const trust = createPostgresConnectionTrustRepository({ database });
    const setTrust = createSetConnectionTrustService({ connections, trust });

    const rejection = await setTrust
      .set({ actorId: actorC, subjectUserId: userA, trust: 50 })
      .catch((error: unknown) => error);

    expect(rejection).toBeInstanceOf(Error);
    const serialized = JSON.stringify(rejection, Object.getOwnPropertyNames(rejection as object));
    expect(serialized).not.toMatch(/currentState/);
    expect(serialized).not.toMatch(/"trust"/);
  });
});

/** Mirrors `packages/database/src/database-schema.integration.test.ts`'s helper. */
function asRole(connectionString: string, username: string, password: string): string {
  const url = new URL(connectionString);
  url.username = username;
  url.password = password;
  return url.toString();
}
