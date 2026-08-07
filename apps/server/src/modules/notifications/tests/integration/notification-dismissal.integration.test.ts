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
import { createGraphModule } from '../../../graph/graph.module';
import { createIdentityModule } from '../../../identity/identity.module';
import type { PushPayload, PushTransport } from '../../domain/push-transport';
import { createNotificationsModule, type NotificationsModule } from '../../notifications.module';

/**
 * `notifications.dismiss` and the `unread` flag it drives — issue #50's per-item `✕`,
 * made durable.
 *
 * The rule under test is one durable fact and its negation: a dismissal exists or it
 * does not, and `unread` is `!dismissed`. This suite is about what only a real database
 * can prove — that the fact survives a new caller, that the primary key is what makes a
 * second dismissal converge, and that it is scoped to one recipient. The rule's boundary
 * cases (which id a group is keyed on, what a refusal writes) are
 * `list-notifications-unread.unit.test.ts`'s, against fakes.
 *
 * Seeding mirrors `notifications-list.integration.test.ts` exactly, including its
 * sanctioned direct writes to `app.outbox_events`: that table is L2's shared envelope,
 * so a notifications suite writes to it rather than reaching into
 * `modules/bulletins/persistence`.
 */
describe('notifications.dismiss (issue #50)', () => {
  let testDatabase: PostgresTestDatabase;
  let database: DatabaseConnection;
  let signingKey: SupabaseSigningKeyPair;

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

  async function seedAcceptedConnection(userAId: string, userBId: string): Promise<void> {
    await testDatabase.client.query(
      `insert into app.connections
         (user_a_id, user_b_id, status, a_discloses_to_b_level, b_discloses_to_a_level, created_at)
       values ($1, $2, 'accepted', 'full', 'full', now())`,
      [userAId, userBId],
    );
  }

  async function seedNotifyMeQuery(ownerId: string): Promise<void> {
    await testDatabase.client.query(
      `insert into app.notify_me_queries (owner_id, source_text, ast, ast_version, version, updated_at)
       values ($1, 'type:request', $2::jsonb, 1, 1, now())`,
      [ownerId, JSON.stringify({ types: ['request'], text: [] })],
    );
  }

  async function seedPushSubscription(ownerId: string): Promise<void> {
    await testDatabase.client.query(
      `insert into app.push_subscriptions (owner_id, endpoint, p256dh_key, auth_key, created_at)
       values ($1, $2, 'p256dh-key', 'auth-key', now())`,
      [ownerId, `https://push.example/${ownerId}`],
    );
  }

  async function seedBulletin(authorId: string, title: string, createdAt: Date): Promise<string> {
    const { rows } = await testDatabase.client.query<{ id: string }>(
      `insert into app.bulletins (author_id, type, title, body, created_at)
       values ($1, 'request', $2, 'Body text.', $3) returning id`,
      [authorId, title, createdAt],
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
  }): Promise<OutboxEventRowForTest> {
    const eventId = randomUUID();
    const payload = {
      bulletinId: options.bulletinId,
      authorId: options.authorId,
      bulletinType: 'request',
    };
    await testDatabase.client.query(
      `insert into app.outbox_events
         (event_id, event_type, occurred_at, actor_id, aggregate_id, payload)
       values ($1, 'BulletinCreated', $2, $3, $4, $5::jsonb)`,
      [eventId, options.occurredAt, options.authorId, options.bulletinId, JSON.stringify(payload)],
    );
    return {
      eventId,
      eventType: 'BulletinCreated',
      occurredAt: options.occurredAt,
      actorId: options.authorId,
      aggregateId: options.bulletinId,
      payload,
    };
  }

  function createFakePushTransport(): PushTransport & { readonly calls: PushPayload[] } {
    const calls: PushPayload[] = [];
    return {
      calls,
      async send(_subscription, payload): Promise<void> {
        calls.push(payload);
      },
    };
  }

  function buildNotificationsModule(): NotificationsModule {
    const { visiblePeople } = createGraphModule({ database });
    return createNotificationsModule({
      database,
      visiblePeople,
      pushTransport: createFakePushTransport(),
    });
  }

  function callerFor(notifications: NotificationsModule, authorizationHeader: string | undefined) {
    const { actorResolver } = createIdentityModule({ database });
    return createCallerFactory(router({ notifications: notifications.router }))(
      contextFor(authorizationHeader, {
        accessTokenVerifier: createSupabaseJwtVerifier({ keySource: signingKey.publicKey }),
        actorResolver,
      }),
    );
  }

  async function bearerFor(authUserId: string): Promise<string> {
    return `Bearer ${await mintSupabaseAsymmetricUserToken({
      signingKey,
      role: 'authenticated',
      subject: authUserId,
    })}`;
  }

  /** One recipient with `count` flushed notifications, 61 s apart so each is its own. */
  async function seedFlushedNotifications(options: {
    readonly authorHandle: string;
    readonly recipientHandle: string;
    readonly count: number;
  }): Promise<{
    recipient: { userId: string; authUserId: string };
    notifications: NotificationsModule;
  }> {
    const author = await seedOnboardedUser(options.authorHandle);
    const recipient = await seedOnboardedUser(options.recipientHandle);
    await seedAcceptedConnection(author.userId, recipient.userId);
    await seedNotifyMeQuery(recipient.userId);
    await seedPushSubscription(recipient.userId);

    const notifications = buildNotificationsModule();
    const start = new Date('2026-08-01T12:00:00.000Z');

    for (let index = 0; index < options.count; index += 1) {
      const occurredAt = new Date(start.getTime() + index * 61_000);
      const bulletinId = await seedBulletin(author.userId, `Bulletin ${String(index)}`, occurredAt);
      await notifications.evaluateNotifyMe.handle(
        await insertBulletinCreatedEvent({ bulletinId, authorId: author.userId, occurredAt }),
      );
    }

    await notifications.sendGroupedPush.flush({
      now: new Date(start.getTime() + options.count * 61_000 + 180_000),
    });

    return { recipient, notifications };
  }

  async function dismissalRowCount(): Promise<number> {
    const { rows } = await testDatabase.client.query<{ count: string }>(
      'select count(*)::text as count from app.notification_dismissals',
    );
    return Number(rows[0]?.count ?? '0');
  }

  describe('Scenario: A recipient dismisses one notification', () => {
    it('marks it read and leaves it listed, while its sibling stays unread', async () => {
      const { recipient, notifications } = await seedFlushedNotifications({
        authorHandle: 'dusty_dismiss_a',
        recipientHandle: 'dusty_dismiss_b',
        count: 2,
      });

      const caller = callerFor(notifications, await bearerFor(recipient.authUserId));
      const before = await caller.notifications.list();
      expect(before).toHaveLength(2);
      expect(before.every((item) => item.unread)).toBe(true);

      const target = before[0];
      if (target === undefined) {
        throw new Error('expected a notification to dismiss');
      }
      const dismissed = await caller.notifications.dismiss({
        notificationId: target.notificationId,
      });
      expect(dismissed.notificationId).toBe(target.notificationId);
      expect(dismissed.dismissedAt).toEqual(expect.any(String));

      const after = await caller.notifications.list();

      // Still two, because a dismissal marks rather than subtracts — the client keeps
      // history and the badge counts `unread`.
      expect(after).toHaveLength(2);
      expect(new Map(after.map((item) => [item.notificationId, item.unread]))).toEqual(
        new Map(
          before.map((item) => [item.notificationId, item.notificationId !== target.notificationId]),
        ),
      );
    });
  });

  describe('Scenario: The dismissal is durable', () => {
    it('survives a fresh caller and a freshly-wired module', async () => {
      // The point of a table rather than client state: a second device, or the same one
      // after a reload, must not see a cleared notification come back.
      const { recipient, notifications } = await seedFlushedNotifications({
        authorHandle: 'dusty_durable_a',
        recipientHandle: 'dusty_durable_b',
        count: 1,
      });

      const caller = callerFor(notifications, await bearerFor(recipient.authUserId));
      const listed = await caller.notifications.list();
      const target = listed[0];
      if (target === undefined) {
        throw new Error('expected a notification to dismiss');
      }
      await caller.notifications.dismiss({ notificationId: target.notificationId });

      const secondDevice = callerFor(
        buildNotificationsModule(),
        await bearerFor(recipient.authUserId),
      );

      await expect(secondDevice.notifications.list()).resolves.toEqual([
        expect.objectContaining({ notificationId: target.notificationId, unread: false }),
      ]);
    });
  });

  describe('Scenario: Dismissing twice converges', () => {
    it('answers the first dismissedAt and writes exactly one row', async () => {
      const { recipient, notifications } = await seedFlushedNotifications({
        authorHandle: 'dusty_twice_a',
        recipientHandle: 'dusty_twice_b',
        count: 1,
      });

      const caller = callerFor(notifications, await bearerFor(recipient.authUserId));
      const target = (await caller.notifications.list())[0];
      if (target === undefined) {
        throw new Error('expected a notification to dismiss');
      }

      const first = await caller.notifications.dismiss({ notificationId: target.notificationId });
      const second = await caller.notifications.dismiss({ notificationId: target.notificationId });

      expect(second).toEqual(first);
      expect(await dismissalRowCount()).toBe(1);
    });
  });

  describe('Scenario: A dismissal is one person\'s', () => {
    it("does not change another recipient's unread state for the same bulletin", async () => {
      const author = await seedOnboardedUser('dusty_scope_author');
      const first = await seedOnboardedUser('dusty_scope_first');
      const second = await seedOnboardedUser('dusty_scope_second');
      await seedAcceptedConnection(author.userId, first.userId);
      await seedAcceptedConnection(author.userId, second.userId);
      await seedNotifyMeQuery(first.userId);
      await seedNotifyMeQuery(second.userId);
      await seedPushSubscription(first.userId);
      await seedPushSubscription(second.userId);

      const notifications = buildNotificationsModule();
      const occurredAt = new Date('2026-08-01T12:00:00.000Z');
      const bulletinId = await seedBulletin(author.userId, 'Shared bulletin', occurredAt);
      await notifications.evaluateNotifyMe.handle(
        await insertBulletinCreatedEvent({ bulletinId, authorId: author.userId, occurredAt }),
      );
      await notifications.sendGroupedPush.flush({
        now: new Date(occurredAt.getTime() + 180_000),
      });

      const firstCaller = callerFor(notifications, await bearerFor(first.authUserId));
      const secondCaller = callerFor(notifications, await bearerFor(second.authUserId));

      const target = (await firstCaller.notifications.list())[0];
      if (target === undefined) {
        throw new Error('expected a notification to dismiss');
      }
      await firstCaller.notifications.dismiss({ notificationId: target.notificationId });

      await expect(firstCaller.notifications.list()).resolves.toEqual([
        expect.objectContaining({ unread: false }),
      ]);
      await expect(secondCaller.notifications.list()).resolves.toEqual([
        expect.objectContaining({ unread: true }),
      ]);
    });

    it("refuses another recipient's notification with 404 NOTIFICATION_UNAVAILABLE, writing nothing", async () => {
      // Byte-identical to the answer an invented id gets, so dismissing is not an oracle
      // for whose notification a guessed identifier names (ADR-0002 §10).
      const { recipient, notifications } = await seedFlushedNotifications({
        authorHandle: 'dusty_other_a',
        recipientHandle: 'dusty_other_b',
        count: 1,
      });
      const stranger = await seedOnboardedUser('dusty_other_c');

      const owner = callerFor(notifications, await bearerFor(recipient.authUserId));
      const target = (await owner.notifications.list())[0];
      if (target === undefined) {
        throw new Error('expected a notification to dismiss');
      }

      const strangerCaller = callerFor(notifications, await bearerFor(stranger.authUserId));

      await expect(
        strangerCaller.notifications.dismiss({ notificationId: target.notificationId }),
      ).rejects.toMatchObject({
        code: 'NOT_FOUND',
        cause: expect.objectContaining({ code: 'NOTIFICATION_UNAVAILABLE' }),
      });
      expect(await dismissalRowCount()).toBe(0);
    });
  });

  describe('Scenario: An invented identifier is refused', () => {
    it('answers 404 and writes no row, so the table cannot be filled with guesses', async () => {
      const { recipient, notifications } = await seedFlushedNotifications({
        authorHandle: 'dusty_invented_a',
        recipientHandle: 'dusty_invented_b',
        count: 1,
      });

      const caller = callerFor(notifications, await bearerFor(recipient.authUserId));

      await expect(
        caller.notifications.dismiss({ notificationId: randomUUID() }),
      ).rejects.toMatchObject({
        code: 'NOT_FOUND',
        cause: expect.objectContaining({ code: 'NOTIFICATION_UNAVAILABLE' }),
      });
      expect(await dismissalRowCount()).toBe(0);
    });
  });

  describe('Scenario: Dismissing is not an event', () => {
    it('writes zero outbox rows, so nothing downstream ever learns about it', async () => {
      // A dismissal has no consumer: nothing re-reads it, no push is sent, and the audit
      // consumer would otherwise durably record a person tidying their own panel.
      const { recipient, notifications } = await seedFlushedNotifications({
        authorHandle: 'dusty_noevent_a',
        recipientHandle: 'dusty_noevent_b',
        count: 1,
      });

      const caller = callerFor(notifications, await bearerFor(recipient.authUserId));
      const target = (await caller.notifications.list())[0];
      if (target === undefined) {
        throw new Error('expected a notification to dismiss');
      }

      const { rows: before } = await testDatabase.client.query<{ count: string }>(
        'select count(*)::text as count from app.outbox_events',
      );
      await caller.notifications.dismiss({ notificationId: target.notificationId });
      const { rows: after } = await testDatabase.client.query<{ count: string }>(
        'select count(*)::text as count from app.outbox_events',
      );

      expect(after[0]?.count).toBe(before[0]?.count);
    });
  });

  describe('Scenario: The dismiss procedure refuses an unauthenticated caller', () => {
    it('answers 401 UNAUTHORIZED', async () => {
      const caller = callerFor(buildNotificationsModule(), undefined);

      await expect(
        caller.notifications.dismiss({ notificationId: randomUUID() }),
      ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    });
  });
});

interface OutboxEventRowForTest {
  readonly eventId: string;
  readonly eventType: string;
  readonly occurredAt: Date;
  readonly actorId: string;
  readonly aggregateId: string;
  readonly payload: Record<string, unknown>;
}

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
