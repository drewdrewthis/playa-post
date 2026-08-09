import { randomUUID } from 'node:crypto';

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { createDatabaseConnection, type DatabaseConnection } from '@playa-post/database';
import { startPostgresTestDatabase, type PostgresTestDatabase } from '@playa-post/testing';

import { createVisibilitySettingService } from '../../application/visibility-setting.service';
import { createPostgresUserRepository } from '../../persistence/postgres-user.repository';

/**
 * The "who can see you at all" setting, end to end against real Postgres: the
 * `visible_to_distance` column added by 20260809140000, the repository write behind
 * `identity.visibility.set`, and the effect of both on `app.visible_people` —
 * multi-hop reach now that the M2 depth clamp is deleted, and absence (not an
 * unnamed node) once a person's own limit puts the viewer too far away.
 *
 * `app.visible_people` is queried with raw SQL here rather than through the graph
 * module: this suite is about the *column identity owns* and the function's contract
 * with it, and `no-cross-module-persistence` forbids reaching into graph's
 * persistence. Tests are outside `no-sql-outside-persistence`'s scope by design.
 */
describe('visible_to_distance (who can see you at all)', () => {
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

  async function seedUser(handle: string): Promise<string> {
    const { rows } = await testDatabase.client.query<{ id: string }>(
      `insert into app.users (auth_user_id, handle, display_name, created_at)
       values ($1, $2, $3, now()) returning id`,
      [randomUUID(), handle, handle],
    );
    const id = rows[0]?.id;
    if (id === undefined) {
      throw new Error('seedUser: insert returned no row');
    }
    return id;
  }

  async function connect(userAId: string, userBId: string): Promise<void> {
    await testDatabase.client.query(
      `insert into app.connections
         (user_a_id, user_b_id, status, a_discloses_to_b_level, b_discloses_to_a_level, created_at)
       values ($1, $2, 'accepted', 'full', 'full', now())`,
      [userAId, userBId],
    );
  }

  async function visibleTo(viewerId: string): Promise<ReadonlyArray<{ user_id: string; degree: number }>> {
    const { rows } = await testDatabase.client.query<{ user_id: string; degree: number }>(
      `select user_id, degree from app.visible_people($1)`,
      [viewerId],
    );
    return rows;
  }

  it('reaches beyond the first degree now that the M2 clamp is gone (ADR-0004 decision 2)', async () => {
    const a = await seedUser('dusty_dist_a');
    const b = await seedUser('dusty_dist_b');
    const c = await seedUser('dusty_dist_c');
    await connect(a, b);
    await connect(b, c);

    const visible = await visibleTo(a);

    expect(visible.find((row) => row.user_id === c)?.degree).toBe(2);
  });

  it('omits a person entirely — no row, not an unnamed one — beyond their own limit', async () => {
    const a = await seedUser('dusty_dist_hide_a');
    const b = await seedUser('dusty_dist_hide_b');
    const c = await seedUser('dusty_dist_hide_c');
    await connect(a, b);
    await connect(b, c);

    const users = createPostgresUserRepository({ database });
    await users.setVisibleToDistance(c, 'first');

    const visible = await visibleTo(a);

    expect(visible.some((row) => row.user_id === c)).toBe(false);
    // ...while B, standing at degree 1 from C, still sees them: the limit is C's own
    // radius, never a change to anybody's traversal.
    expect((await visibleTo(b)).some((row) => row.user_id === c)).toBe(true);
  });

  it('round-trips through the service: defaults to anyone, stores what is set', async () => {
    const userId = await seedUser('dusty_dist_dial');
    const service = createVisibilitySettingService({
      users: createPostgresUserRepository({ database }),
    });

    expect(await service.get(userId)).toBe('anyone');
    expect(await service.set(userId, 'second')).toBe('second');
    expect(await service.get(userId)).toBe('second');
  });
});

/** Mirrors `packages/database/src/database-schema.integration.test.ts`'s helper. */
function asRole(connectionString: string, username: string, password: string): string {
  const url = new URL(connectionString);
  url.username = username;
  url.password = password;
  return url.toString();
}
