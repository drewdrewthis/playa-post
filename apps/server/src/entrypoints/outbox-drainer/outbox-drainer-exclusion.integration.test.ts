import { randomUUID } from 'node:crypto';

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { createDatabaseConnection, type DatabaseConnection } from '@playa-post/database';
import { startPostgresTestDatabase, type PostgresTestDatabase } from '@playa-post/testing';

import { createGraphModule } from '../../modules/graph/graph.module';
import type { PushPayload, PushSubscription, PushTransport } from '../../modules/notifications/domain/push-transport';
import { createNotificationsModule } from '../../modules/notifications/notifications.module';

import { createOutboxDrainer } from './outbox-drainer';

/**
 * Lane-only coverage for the seam L3b-infra left and L3b-notify filled: the outbox
 * drainer's `excludedEventTypes` option (`outbox-drainer.ts`'s `$if`-guarded `not in`
 * predicate) and the module-level starvation guard it exists to prevent
 * (`SELF_DRAINED_EVENT_TYPES` beside `NOTIFY_ME_MATCHED`,
 * `modules/notifications/domain/notification.events.ts`).
 *
 * A new lane-only file rather than an edit to the merged
 * `start-outbox-drainer-poller.unit.test.ts` or the not-yet-arrived
 * `outbox-drainer.integration.test.ts`, both will-conflict on rebase.
 */
describe('outbox drainer exclusion (M2.14, notification.events.ts SELF_DRAINED_EVENT_TYPES)', () => {
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

  async function seedAcceptedConnection(userAId: string, userBId: string): Promise<void> {
    await testDatabase.client.query(
      `insert into app.connections
         (user_a_id, user_b_id, status, a_discloses_to_b_level, b_discloses_to_a_level, created_at)
       values ($1, $2, 'accepted', 'full', 'full', now())`,
      [userAId, userBId],
    );
  }

  async function seedPushSubscription(ownerId: string): Promise<void> {
    await testDatabase.client.query(
      `insert into app.push_subscriptions (owner_id, endpoint, p256dh_key, auth_key, created_at)
       values ($1, $2, 'p256dh-key', 'auth-key', now())`,
      [ownerId, `https://push.example/${ownerId}`],
    );
  }

  async function seedBulletin(
    authorId: string,
    options: { readonly title: string; readonly body: string; readonly createdAt: Date },
  ): Promise<string> {
    const { rows } = await testDatabase.client.query<{ id: string }>(
      `insert into app.bulletins (author_id, type, title, body, created_at)
       values ($1, 'request', $2, $3, $4) returning id`,
      [authorId, options.title, options.body, options.createdAt],
    );
    const id = rows[0]?.id;
    if (id === undefined) {
      throw new Error('seedBulletin: insert returned no row');
    }
    return id;
  }

  async function insertBulletinCreatedEvent(options: {
    readonly bulletinId: string;
    readonly authorId: string;
    readonly occurredAt: Date;
  }): Promise<string> {
    const eventId = randomUUID();
    await testDatabase.client.query(
      `insert into app.outbox_events
         (event_id, event_type, occurred_at, actor_id, aggregate_id, payload)
       values ($1, 'BulletinCreated', $2, $3, $4, $5::jsonb)`,
      [
        eventId,
        options.occurredAt,
        options.authorId,
        options.bulletinId,
        JSON.stringify({ bulletinId: options.bulletinId, authorId: options.authorId, bulletinType: 'request' }),
      ],
    );
    return eventId;
  }

  /**
   * A `NotifyMeMatched` outbox row inserted directly, mirroring what
   * `postgres-notify-me-match.repository.ts`'s `recordMatches` writes — bypassing
   * `EvaluateNotifyMeHandler` on purpose, since this suite is about the *drainer's*
   * exclusion of the row, not about how it got there.
   */
  async function insertNotifyMeMatchedEvent(options: {
    readonly recipientId: string;
    readonly bulletinId: string;
    readonly authorId: string;
    readonly occurredAt: Date;
  }): Promise<string> {
    const eventId = randomUUID();
    await testDatabase.client.query(
      `insert into app.outbox_events
         (event_id, event_type, occurred_at, actor_id, aggregate_id, payload)
       values ($1, 'NotifyMeMatched', $2, $3, $4, $5::jsonb)`,
      [
        eventId,
        options.occurredAt,
        options.authorId,
        options.bulletinId,
        JSON.stringify({
          recipientId: options.recipientId,
          bulletinId: options.bulletinId,
          authorId: options.authorId,
        }),
      ],
    );
    return eventId;
  }

  async function outboxRow(
    eventId: string,
  ): Promise<{ readonly status: string; readonly attempts: number } | undefined> {
    const { rows } = await testDatabase.client.query<{ status: string; attempts: number }>(
      `select status, attempts from app.outbox_events where event_id = $1`,
      [eventId],
    );
    return rows[0];
  }

  function createFakePushTransport(): PushTransport & { readonly calls: PushPayload[] } {
    const calls: PushPayload[] = [];
    return {
      isConfigured: true,
      calls,
      async send(_subscription: PushSubscription, payload: PushPayload): Promise<void> {
        calls.push(payload);
      },
    };
  }

  describe('given a pending NotifyMeMatched row and a pending BulletinCreated row', () => {
    it('claims only the BulletinCreated row when NotifyMeMatched is excluded', async () => {
      const author = await seedOnboardedUser('dusty_exclusion_author');
      const recipient = await seedOnboardedUser('dusty_exclusion_recipient');
      const occurredAt = new Date('2026-08-01T12:00:00.000Z');
      const bulletinId = await seedBulletin(author.userId, {
        title: 'Bulletin',
        body: 'Body',
        createdAt: occurredAt,
      });

      const matchedEventId = await insertNotifyMeMatchedEvent({
        recipientId: recipient.userId,
        bulletinId,
        authorId: author.userId,
        occurredAt,
      });
      const bulletinEventId = await insertBulletinCreatedEvent({
        bulletinId,
        authorId: author.userId,
        occurredAt,
      });

      const drainer = createOutboxDrainer({
        database,
        consumers: [],
        drainerId: 'exclusion-test-drainer',
        excludedEventTypes: ['NotifyMeMatched'],
      });

      const result = await drainer.drainOnce();

      expect(result.claimedEventIds).toEqual([bulletinEventId]);
      expect(result.claimedEventIds).not.toContain(matchedEventId);

      // The other half of the coupling: the excluded row must be genuinely
      // untouched, not merely unreturned — a claim-then-release regression would
      // still leave `claimedEventIds` correct while bumping `attempts` and cycling
      // `status` through `'claimed'` and back.
      const excludedRow = await outboxRow(matchedEventId);
      expect(excludedRow?.status).toBe('pending');
      expect(excludedRow?.attempts).toBe(0);
    });
  });

  describe('given the same two rows and no excludedEventTypes', () => {
    it('claims both, regressing if the $if guard became an unconditional not-in-() predicate', async () => {
      const author = await seedOnboardedUser('dusty_default_author');
      const recipient = await seedOnboardedUser('dusty_default_recipient');
      const occurredAt = new Date('2026-08-01T12:00:00.000Z');
      const bulletinId = await seedBulletin(author.userId, {
        title: 'Bulletin',
        body: 'Body',
        createdAt: occurredAt,
      });

      const matchedEventId = await insertNotifyMeMatchedEvent({
        recipientId: recipient.userId,
        bulletinId,
        authorId: author.userId,
        occurredAt,
      });
      const bulletinEventId = await insertBulletinCreatedEvent({
        bulletinId,
        authorId: author.userId,
        occurredAt,
      });

      // No `excludedEventTypes` at all — the default the dependency interface
      // documents as "nothing excluded".
      const drainer = createOutboxDrainer({
        database,
        consumers: [],
        drainerId: 'default-empty-test-drainer',
      });

      const result = await drainer.drainOnce();

      expect(new Set(result.claimedEventIds)).toEqual(new Set([matchedEventId, bulletinEventId]));
    });
  });

  describe('given a pending NotifyMeMatched row, an excluding drainer, and a configured flush', () => {
    it('leaves the row for the flush to deliver, rather than starving it', async () => {
      const author = await seedOnboardedUser('dusty_starve_author');
      const recipient = await seedOnboardedUser('dusty_starve_recipient');
      await seedAcceptedConnection(author.userId, recipient.userId);
      await seedPushSubscription(recipient.userId);

      const occurredAt = new Date('2026-08-01T12:00:00.000Z');
      const bulletinId = await seedBulletin(author.userId, {
        title: 'Bulletin',
        body: 'Body',
        createdAt: occurredAt,
      });
      await insertNotifyMeMatchedEvent({
        recipientId: recipient.userId,
        bulletinId,
        authorId: author.userId,
        occurredAt,
      });

      const drainer = createOutboxDrainer({
        database,
        consumers: [],
        drainerId: 'starvation-guard-test-drainer',
        excludedEventTypes: ['NotifyMeMatched'],
      });
      const drainResult = await drainer.drainOnce();
      expect(drainResult.claimedEventIds).toEqual([]);

      const { visiblePeople } = createGraphModule({ database });
      const pushTransport = createFakePushTransport();
      const notifications = createNotificationsModule({ database, visiblePeople, pushTransport });

      await notifications.sendGroupedPush.flush({ now: new Date(occurredAt.getTime() + 120_000) });

      // Fails if either half of the exclusion coupling is dropped: an unexcluded
      // drainer would have claimed the row above (asserted already), and a drainer
      // that claimed it would starve this flush of anything to deliver.
      expect(pushTransport.calls).toHaveLength(1);
      expect(pushTransport.calls[0]?.recipientId).toBe(recipient.userId);
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
