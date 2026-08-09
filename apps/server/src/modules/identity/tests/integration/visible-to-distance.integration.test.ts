import { randomUUID } from 'node:crypto';

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { createDatabaseConnection, sql, type DatabaseConnection } from '@playa-post/database';
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
    // Generated per run, never source-controlled: a literal here would trip secret
    // scanners and teach the wrong habit even though the container is throwaway. A
    // UUID is [0-9a-f-] only, so interpolating it into ALTER ROLE (which cannot take
    // a bind parameter) is safe.
    const appRwPassword = randomUUID();
    await testDatabase.client.query(`alter role app_rw with password '${appRwPassword}'`);
    database = createDatabaseConnection({
      connectionString: asRole(testDatabase.connectionString, 'app_rw', appRwPassword),
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

  async function visibleTo(
    viewerId: string,
    { maxDepth = 4, nodeBudget = 1500 }: { maxDepth?: number; nodeBudget?: number } = {},
  ): Promise<ReadonlyArray<{ user_id: string; degree: number }>> {
    // Through the `app_rw` connection, not the owner client: `app.visible_people` is
    // SECURITY INVOKER, so the privileges and row-level policies being exercised must
    // be the ones production runs under. Seeding stays on the owner client.
    const { rows } = await sql<{ user_id: string; degree: number }>`
      select user_id, degree from app.visible_people(${viewerId}, ${maxDepth}, ${nodeBudget})
    `.execute(database);
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

  it("caps the whole scale at six degrees — 'sixth' is a ceiling, not an 'anyone'", async () => {
    // A chain of eight people: the viewer at one end, someone at degree 6, someone at
    // degree 7. Everyone sits at the default 'sixth', and max_depth is deliberately
    // passed higher than the ceiling to prove the ceiling is the function's, not the
    // caller's: six degrees is the product's principle of reach (20260810090000).
    const chain: string[] = [];
    for (let i = 0; i < 8; i += 1) {
      chain.push(await seedUser(`dusty_chain_${i}`));
    }
    for (let i = 0; i < 7; i += 1) {
      await connect(chain[i]!, chain[i + 1]!);
    }

    const visible = await visibleTo(chain[0]!, { maxDepth: 10 });

    expect(visible.find((row) => row.user_id === chain[6])?.degree).toBe(6);
    expect(visible.some((row) => row.user_id === chain[7])).toBe(false);
  });

  it('does not let an inactive person spend node_budget and push an active one out', async () => {
    // v — i (deactivated) — b. With node_budget 2, the budget must go to v and b: if
    // the status filter ran only after the limit, i would take the second slot inside
    // `reachable`, be dropped by the final status filter, and b — reachable and
    // active — would silently vanish. The path still routes THROUGH i (pruning
    // traversal is a block's behaviour, ADR-0004 decision 1, not deactivation's).
    const v = await seedUser('dusty_budget_v');
    const i = await seedUser('dusty_budget_i');
    const b = await seedUser('dusty_budget_b');
    await connect(v, i);
    await connect(i, b);
    await testDatabase.client.query(
      `update app.users set status = 'deactivated', deactivated_at = now() where id = $1`,
      [i],
    );

    const visible = await visibleTo(v, { nodeBudget: 2 });

    expect(visible.some((row) => row.user_id === i)).toBe(false);
    expect(visible.find((row) => row.user_id === b)?.degree).toBe(2);
  });

  it('round-trips through the service: defaults to sixth, stores what is set', async () => {
    const userId = await seedUser('dusty_dist_dial');
    const service = createVisibilitySettingService({
      users: createPostgresUserRepository({ database }),
    });

    expect(await service.get(userId)).toBe('sixth');
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
