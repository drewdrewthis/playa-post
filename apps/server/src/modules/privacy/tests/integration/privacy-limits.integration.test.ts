import { randomUUID } from 'node:crypto';

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { createDatabaseConnection, type DatabaseConnection } from '@playa-post/database';
import { startPostgresTestDatabase, type PostgresTestDatabase } from '@playa-post/testing';

import { createGetPrivacyLimitsQuery } from '../../application/get-privacy-limits.query';
import { createSetPrivacyLimitsService } from '../../application/set-privacy-limits.service';
import { PERMISSIVE_LIMITS } from '../../domain/privacy-limits';
import { PrivacyLimitOutOfRangeError } from '../../domain/privacy.errors';
import { createPostgresPrivacyLimitsRepository } from '../../persistence/postgres-privacy-limits.repository';

/**
 * `app.privacy_settings` and the two use cases over it (You screen, issue #49).
 *
 * The half of this lane that can be proven without the graph: the row round-trips, the
 * absent row reads as the permissive default, and the check constraints agree with
 * `domain/privacy-limits.policy.ts` about what is storable. The *enforcement* half —
 * what a tightened limit does to `app.visible_people` — is
 * `name-disclosure-limit.integration.test.ts`, because that one needs a second person.
 */
describe('privacy limits, stored (issue #49)', () => {
  const APP_RW_TEST_PASSWORD = 'app_rw_in_a_throwaway_container';

  let testDatabase: PostgresTestDatabase;
  let database: DatabaseConnection;

  beforeAll(async () => {
    testDatabase = await startPostgresTestDatabase();
    await testDatabase.client.query(
      `alter role app_rw with password '${APP_RW_TEST_PASSWORD}'`,
    );
    database = createDatabaseConnection({
      connectionString: asRole(testDatabase.connectionString, 'app_rw', APP_RW_TEST_PASSWORD),
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
    const userId = rows[0]?.id;
    if (userId === undefined) {
      throw new Error('seedUser: insert returned no row');
    }
    return userId;
  }

  function useCases() {
    const limits = createPostgresPrivacyLimitsRepository({ database });
    return {
      get: createGetPrivacyLimitsQuery({ limits }),
      set: createSetPrivacyLimitsService({ limits }),
    };
  }

  /**
   * ⚠ The assertion that makes this whole migration safe to ship. Every existing user
   * has no row, and if this read fell back to anything tighter than
   * {@link PERMISSIVE_LIMITS} the You screen would show — and `app.visible_people` would
   * enforce — a policy nobody chose.
   */
  it('reads the permissive default for somebody who has never touched the screen', async () => {
    const userId = await seedUser('dusty_privacy_untouched');

    await expect(useCases().get.get({ actorId: userId })).resolves.toEqual(PERMISSIVE_LIMITS);

    const { rows } = await testDatabase.client.query<{ count: string }>(
      `select count(*)::text as count from app.privacy_settings where user_id = $1`,
      [userId],
    );
    expect(rows[0]?.count, 'reading limits must not create a row').toBe('0');
  });

  it('round-trips both limits through storage', async () => {
    const userId = await seedUser('dusty_privacy_roundtrip');
    const { get, set } = useCases();

    const stored = await set.set({
      actorId: userId,
      limits: { name: { minTrust: 50, maxDegree: 2 }, note: { minTrust: 75, maxDegree: 1 } },
    });

    expect(stored).toEqual({
      name: { minTrust: 50, maxDegree: 2 },
      note: { minTrust: 75, maxDegree: 1 },
    });
    await expect(get.get({ actorId: userId })).resolves.toEqual(stored);
  });

  /**
   * `null` survives the round trip as `null` rather than arriving back as `0`. The two
   * are different rules (see the domain type), and a column that coerced one into the
   * other would silently hide the owner's name from everyone they had not rated.
   */
  it('keeps ANYONE as null through the database, not as 0', async () => {
    const userId = await seedUser('dusty_privacy_anyone');
    const { get, set } = useCases();

    await set.set({
      actorId: userId,
      limits: { name: { minTrust: null, maxDegree: 3 }, note: { minTrust: 0, maxDegree: 3 } },
    });

    const limits = await get.get({ actorId: userId });
    expect(limits.name.minTrust).toBeNull();
    expect(limits.note.minTrust).toBe(0);
  });

  it('upserts rather than accumulating rows — an owner has one current policy', async () => {
    const userId = await seedUser('dusty_privacy_upsert');
    const { get, set } = useCases();

    await set.set({
      actorId: userId,
      limits: { name: { minTrust: 50, maxDegree: 2 }, note: { minTrust: 50, maxDegree: 2 } },
    });
    await set.set({
      actorId: userId,
      limits: { name: { minTrust: null, maxDegree: 1 }, note: { minTrust: 75, maxDegree: 3 } },
    });

    const { rows } = await testDatabase.client.query<{ count: string }>(
      `select count(*)::text as count from app.privacy_settings where user_id = $1`,
      [userId],
    );
    expect(rows[0]?.count).toBe('1');
    await expect(get.get({ actorId: userId })).resolves.toEqual({
      name: { minTrust: null, maxDegree: 1 },
      note: { minTrust: 75, maxDegree: 3 },
    });
  });

  /**
   * The second write sends only a loosened name limit and a note limit it did not mean
   * to change — which is the shape a partial `doUpdateSet` would get wrong. Both columns
   * have to land, or "I set this screen the way I wanted" depends on write order.
   */
  it('writes every column on the update branch, not only the changed ones', async () => {
    const userId = await seedUser('dusty_privacy_partial');
    const { get, set } = useCases();

    await set.set({
      actorId: userId,
      limits: { name: { minTrust: 75, maxDegree: 1 }, note: { minTrust: 75, maxDegree: 1 } },
    });
    await set.set({
      actorId: userId,
      limits: { name: { minTrust: null, maxDegree: 3 }, note: { minTrust: null, maxDegree: 3 } },
    });

    await expect(get.get({ actorId: userId })).resolves.toEqual(PERMISSIVE_LIMITS);
  });

  it('keeps one policy per owner, so two people do not share a row', async () => {
    const alice = await seedUser('dusty_privacy_alice');
    const bob = await seedUser('dusty_privacy_bob');
    const { get, set } = useCases();

    await set.set({
      actorId: alice,
      limits: { name: { minTrust: 75, maxDegree: 1 }, note: { minTrust: null, maxDegree: 3 } },
    });

    await expect(get.get({ actorId: bob })).resolves.toEqual(PERMISSIVE_LIMITS);
  });

  /**
   * The refusal happens in the domain, so nothing reaches the column's check constraint
   * — which would surface as a driver-level 500 rather than the stable code M2-AC18 asks
   * for. Asserted by the absence of a row as well as by the error: a validator that threw
   * *after* writing would satisfy the first half alone.
   */
  it('refuses an out-of-range limit before it reaches the check constraint', async () => {
    const userId = await seedUser('dusty_privacy_range');
    const { set } = useCases();

    await expect(
      set.set({
        actorId: userId,
        limits: { name: { minTrust: 101, maxDegree: 3 }, note: { minTrust: null, maxDegree: 3 } },
      }),
    ).rejects.toBeInstanceOf(PrivacyLimitOutOfRangeError);

    const { rows } = await testDatabase.client.query<{ count: string }>(
      `select count(*)::text as count from app.privacy_settings where user_id = $1`,
      [userId],
    );
    expect(rows[0]?.count).toBe('0');
  });

  /**
   * The constraint and the policy have to agree, or one of them is decoration. Written
   * as a raw insert precisely because the repository cannot express the illegal value:
   * this is the belt behind the domain's braces (ADR-0002 §4's discipline applied to a
   * value rather than to a role).
   */
  it('backs the policy with check constraints the domain cannot bypass', async () => {
    const userId = await seedUser('dusty_privacy_constraint');

    await expect(
      testDatabase.client.query(
        `insert into app.privacy_settings
           (user_id, name_min_trust, name_max_degree, note_min_trust, note_max_degree, updated_at)
         values ($1, 101, 3, null, 3, now())`,
        [userId],
      ),
    ).rejects.toThrow(/privacy_settings_name_min_trust_range/);

    await expect(
      testDatabase.client.query(
        `insert into app.privacy_settings
           (user_id, name_min_trust, name_max_degree, note_min_trust, note_max_degree, updated_at)
         values ($1, null, 4, null, 3, now())`,
        [userId],
      ),
    ).rejects.toThrow(/privacy_settings_name_max_degree_range/);
  });
});

/** Re-point a `postgres://` URI at a different role, keeping host, port, and database. */
function asRole(connectionString: string, username: string, password: string): string {
  const url = new URL(connectionString);
  url.username = username;
  url.password = password;
  return url.toString();
}
