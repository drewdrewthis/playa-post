import { randomUUID } from 'node:crypto';

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { createDatabaseConnection, type DatabaseConnection } from '@playa-post/database';
import { startPostgresTestDatabase, type PostgresTestDatabase } from '@playa-post/testing';

// None of these exist yet — legible failure at this seam until the coder writes them.
import { createSubscribeToPushService } from '../../application/subscribe-to-push.service';
import { createPostgresPushSubscriptionRepository } from '../../persistence/postgres-push-subscription.repository';

/**
 * `specs/features/notify-me.feature` › "Subscribing to push twice is rejected"
 * (M2-AC18). Application service against a real repository, matching every other
 * lane's `@integration` discipline (`directional-trust.integration.test.ts`'s
 * `trust.set` rejection scenario, `bulletin-request-lifecycle.integration.test.ts`'s
 * archive rejection scenario) — no router, no JWT, because M2-AC18 needs only "a
 * structured error with a stable code", which the service layer already produces.
 *
 * **Design decision recorded here as an AC ambiguity** (see also this suite's
 * migration test, `push-subscriptions-schema-migration.integration.test.ts`):
 * `app.push_subscriptions` is keyed one row per owner in M2 (multi-device is M5), so
 * "subscribing twice" is a primary-key violation the repository maps onto a
 * structured `PushSubscriptionAlreadyExistsError` — the same "the constraint IS the
 * enforcement" shape ADR-0007:79 gives `app.notify_me_queries`.
 */
describe('push subscription (notify-me.feature, M2-AC18)', () => {
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

  async function seedOnboardedUser(handle: string): Promise<{ userId: string }> {
    const { rows } = await testDatabase.client.query<{ id: string }>(
      `insert into app.users (auth_user_id, handle, display_name, created_at)
       values ($1, $2, $3, now()) returning id`,
      [randomUUID(), handle, handle],
    );
    const userId = rows[0]?.id;
    if (userId === undefined) {
      throw new Error('seedOnboardedUser: insert returned no row');
    }
    return { userId };
  }

  async function pushSubscriptionRowCount(ownerId: string): Promise<number> {
    const { rows } = await testDatabase.client.query<{ count: string }>(
      `select count(*)::text as count from app.push_subscriptions where owner_id = $1`,
      [ownerId],
    );
    return Number(rows[0]?.count ?? '0');
  }

  describe('Scenario: Subscribing to push twice is rejected (@integration, M2-AC18)', () => {
    it('answers a structured error with a stable code on the second subscribe', async () => {
      const userA = await seedOnboardedUser('dusty_push_twice_a');
      const pushSubscriptions = createPostgresPushSubscriptionRepository({ database });
      const subscribeToPush = createSubscribeToPushService({ pushSubscriptions });

      await subscribeToPush.subscribe({
        actorId: userA.userId,
        endpoint: 'https://push.example/first',
        keys: { p256dh: 'p256dh-first', auth: 'auth-first' },
      });

      const rejection = await subscribeToPush
        .subscribe({
          actorId: userA.userId,
          endpoint: 'https://push.example/second',
          keys: { p256dh: 'p256dh-second', auth: 'auth-second' },
        })
        .catch((error: unknown) => error);

      expect(rejection).toBeInstanceOf(Error);
      expect(rejection).toMatchObject({ code: expect.any(String) });
      expect(await pushSubscriptionRowCount(userA.userId)).toBe(1);
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
