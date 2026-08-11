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
import { createPostgresNotificationSeenWatermarkRepository } from '../../persistence/postgres-notification-seen-watermark.repository';

/**
 * `notifications.markSeen` and the `seen` flag it drives — issue #178's bell badge, made
 * durable.
 *
 * The rule is one durable moment and a comparison against it: `seen` is
 * `occurredAt <= last_seen_at`. This suite is about what only a real database can prove —
 * that the moment survives a new caller, that the primary key is what makes a second open
 * *replace* rather than accumulate, that the upsert's `where` really does refuse to move
 * the watermark backwards, and that it is scoped to one recipient. The rule's boundary
 * cases (the inclusive comparison, the four seen/unread combinations) are
 * `list-notifications-seen.unit.test.ts`'s, against fakes.
 *
 * ⚠ **Every scenario asserts `unread` alongside `seen`.** The regression this feature is
 * most likely to ship is one flag quietly implying the other, and a suite that read only
 * `seen` would stay green while opening the panel silently dismissed everything in it.
 *
 * Seeding mirrors `notification-dismissal.integration.test.ts` exactly, including its
 * sanctioned direct writes to `app.outbox_events`: that table is L2's shared envelope, so
 * a notifications suite writes to it rather than reaching into
 * `modules/bulletins/persistence`.
 */
describe('notifications.markSeen (issue #178)', () => {
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

  /**
   * A connected author/recipient pair, ready to have bulletins flushed into the
   * recipient's notifications by {@link flushNotification}.
   */
  async function seedPair(options: {
    readonly authorHandle: string;
    readonly recipientHandle: string;
  }): Promise<{
    author: { userId: string; authUserId: string };
    recipient: { userId: string; authUserId: string };
    notifications: NotificationsModule;
  }> {
    const author = await seedOnboardedUser(options.authorHandle);
    const recipient = await seedOnboardedUser(options.recipientHandle);
    await seedAcceptedConnection(author.userId, recipient.userId);
    await seedNotifyMeQuery(recipient.userId);
    await seedPushSubscription(recipient.userId);

    return { author, recipient, notifications: buildNotificationsModule() };
  }

  /**
   * Puts exactly one flushed notification, stamped `occurredAt`, into the recipient's
   * list.
   *
   * ⚠ The flush clock is 180 s past `occurredAt` — the grouping window (M2-AC7) has to
   * have fully elapsed before a window may be delivered, and this suite is about the
   * watermark rather than about the window.
   */
  async function flushNotification(
    notifications: NotificationsModule,
    author: { userId: string },
    title: string,
    occurredAt: Date,
  ): Promise<void> {
    const bulletinId = await seedBulletin(author.userId, title, occurredAt);
    await notifications.evaluateNotifyMe.handle(
      await insertBulletinCreatedEvent({ bulletinId, authorId: author.userId, occurredAt }),
    );
    await notifications.sendGroupedPush.flush({ now: new Date(occurredAt.getTime() + 180_000) });
  }

  async function watermarkRowCount(): Promise<number> {
    const { rows } = await testDatabase.client.query<{ count: string }>(
      'select count(*)::text as count from app.notification_seen_watermarks',
    );
    return Number(rows[0]?.count ?? '0');
  }

  describe('Scenario: A recipient opens their notifications panel', () => {
    it('marks the notifications already on the list seen, and dismisses NOTHING', async () => {
      // The whole point of issue #178, and the whole risk of it: the badge has to fall
      // without the panel emptying.
      const { author, recipient, notifications } = await seedPair({
        authorHandle: 'dusty_seen_a',
        recipientHandle: 'dusty_seen_b',
      });
      await flushNotification(notifications, author, 'Bulletin 0', new Date('2026-08-01T12:00:00.000Z'));
      await flushNotification(notifications, author, 'Bulletin 1', new Date('2026-08-01T12:02:00.000Z'));

      const caller = callerFor(notifications, await bearerFor(recipient.authUserId));
      const before = await caller.notifications.list();
      expect(before).toHaveLength(2);
      expect(before.every((item) => !item.seen && item.unread)).toBe(true);

      const mark = await caller.notifications.markSeen();
      expect(mark.seenAt).toEqual(expect.any(String));

      const after = await caller.notifications.list();

      // Still two, still unread, and now seen: the panel is untouched and the badge is
      // empty. Any implementation that let `markSeen` write a dismissal fails here.
      expect(after).toHaveLength(2);
      expect(after.every((item) => item.seen)).toBe(true);
      expect(after.every((item) => item.unread)).toBe(true);
    });
  });

  describe('Scenario: The watermark is durable', () => {
    it('survives a fresh caller and a freshly-wired module', async () => {
      // The point of a table rather than client state: a second device, or the same one
      // after a reload, must not see a cleared badge come back.
      const { author, recipient, notifications } = await seedPair({
        authorHandle: 'dusty_seen_durable_a',
        recipientHandle: 'dusty_seen_durable_b',
      });
      await flushNotification(notifications, author, 'Bulletin', new Date('2026-08-01T12:00:00.000Z'));

      const caller = callerFor(notifications, await bearerFor(recipient.authUserId));
      await caller.notifications.markSeen();

      const secondDevice = callerFor(
        buildNotificationsModule(),
        await bearerFor(recipient.authUserId),
      );

      await expect(secondDevice.notifications.list()).resolves.toEqual([
        expect.objectContaining({ seen: true, unread: true }),
      ]);
    });
  });

  describe('Scenario: Something arrives after the panel was last opened', () => {
    it('comes back unseen, keeping the badge up, while the earlier one stays seen', async () => {
      const { author, recipient, notifications } = await seedPair({
        authorHandle: 'dusty_seen_after_a',
        recipientHandle: 'dusty_seen_after_b',
      });
      await flushNotification(notifications, author, 'Earlier', new Date('2026-08-01T12:00:00.000Z'));

      const caller = callerFor(notifications, await bearerFor(recipient.authUserId));
      const mark = await caller.notifications.markSeen();

      // Stamped one second past the watermark the server just wrote, derived from the
      // answer rather than from this process's clock: the two must be comparable, and
      // reading `new Date()` here would be a second clock racing the first.
      const afterTheOpen = new Date(new Date(mark.seenAt).getTime() + 1_000);
      await flushNotification(notifications, author, 'Later', afterTheOpen);

      const listed = await caller.notifications.list();

      expect(listed).toHaveLength(2);
      expect(new Map(listed.map((item) => [item.occurredAt, item.seen]))).toEqual(
        new Map([
          [new Date('2026-08-01T12:00:00.000Z').toISOString(), true],
          [afterTheOpen.toISOString(), false],
        ]),
      );
    });

    it('is covered by the NEXT open, which is what makes the badge clearable again', async () => {
      // ⚠ The first open is written through the repository at a pinned moment rather than
      // through the procedure. The procedure reads the wall clock, so proving "a later
      // open covers a notification an earlier one did not" through it twice would need
      // the notification stamped between two real instants a few milliseconds apart — a
      // race, not a test. Pinning the first watermark puts both notifications and the
      // first open safely in the past, and leaves the *second* open the real procedure,
      // which is the half this suite exists to exercise.
      const { author, recipient, notifications } = await seedPair({
        authorHandle: 'dusty_seen_second_open_a',
        recipientHandle: 'dusty_seen_second_open_b',
      });
      const earlier = new Date('2026-08-01T12:00:00.000Z');
      const later = new Date('2026-08-01T12:05:00.000Z');
      await flushNotification(notifications, author, 'Earlier', earlier);
      await flushNotification(notifications, author, 'Later', later);

      const watermarks = createPostgresNotificationSeenWatermarkRepository({ database });
      await watermarks.markSeen({
        recipientId: recipient.userId,
        occurredAt: new Date('2026-08-01T12:01:00.000Z'),
      });

      const caller = callerFor(notifications, await bearerFor(recipient.authUserId));
      await expect(caller.notifications.list()).resolves.toEqual([
        // Newest first, so `later` leads.
        expect.objectContaining({ occurredAt: later.toISOString(), seen: false, unread: true }),
        expect.objectContaining({ occurredAt: earlier.toISOString(), seen: true, unread: true }),
      ]);

      // The real procedure, on the real clock — which is necessarily past both fixtures.
      await caller.notifications.markSeen();

      await expect(caller.notifications.list()).resolves.toEqual([
        expect.objectContaining({ seen: true, unread: true }),
        expect.objectContaining({ seen: true, unread: true }),
      ]);
      expect(await watermarkRowCount()).toBe(1);
    });
  });

  describe('Scenario: Opening twice', () => {
    it('ADVANCES the watermark and keeps exactly one row', async () => {
      // The opposite contract to `notifications.dismiss`, which converges on its first
      // timestamp. A watermark that converged would freeze at the first open and never
      // clear a badge again.
      const { recipient, notifications } = await seedPair({
        authorHandle: 'dusty_seen_twice_a',
        recipientHandle: 'dusty_seen_twice_b',
      });

      const caller = callerFor(notifications, await bearerFor(recipient.authUserId));
      const first = await caller.notifications.markSeen();
      const second = await caller.notifications.markSeen();

      expect(new Date(second.seenAt).getTime()).toBeGreaterThanOrEqual(
        new Date(first.seenAt).getTime(),
      );
      expect(await watermarkRowCount()).toBe(1);
    });
  });

  describe('Scenario: A stale write arrives late', () => {
    it('never moves the watermark backwards, and answers the moment that stands', async () => {
      // Two devices, disagreeing clocks, or a retry out of order. Un-seeing notifications
      // somebody has already been shown is the one failure a monotonic upsert exists to
      // prevent — asserted against the repository directly, because the procedure reads
      // the wall clock and cannot be made to travel back in time.
      const { recipient } = await seedPair({
        authorHandle: 'dusty_seen_stale_a',
        recipientHandle: 'dusty_seen_stale_b',
      });
      const watermarks = createPostgresNotificationSeenWatermarkRepository({ database });

      const later = new Date('2026-08-05T12:00:00.000Z');
      const earlier = new Date('2026-08-01T12:00:00.000Z');

      await watermarks.markSeen({ recipientId: recipient.userId, occurredAt: later });
      const stale = await watermarks.markSeen({ recipientId: recipient.userId, occurredAt: earlier });

      expect(stale.seenAt).toEqual(later);
      await expect(watermarks.findSeenWatermarkFor(recipient.userId)).resolves.toEqual(later);
      expect(await watermarkRowCount()).toBe(1);
    });
  });

  describe("Scenario: A watermark is one person's", () => {
    it("does not change another recipient's badge for the same bulletin", async () => {
      const author = await seedOnboardedUser('dusty_seen_scope_author');
      const first = await seedOnboardedUser('dusty_seen_scope_first');
      const second = await seedOnboardedUser('dusty_seen_scope_second');
      await seedAcceptedConnection(author.userId, first.userId);
      await seedAcceptedConnection(author.userId, second.userId);
      await seedNotifyMeQuery(first.userId);
      await seedNotifyMeQuery(second.userId);
      await seedPushSubscription(first.userId);
      await seedPushSubscription(second.userId);

      const notifications = buildNotificationsModule();
      await flushNotification(notifications, author, 'Shared bulletin', new Date('2026-08-01T12:00:00.000Z'));

      const firstCaller = callerFor(notifications, await bearerFor(first.authUserId));
      const secondCaller = callerFor(notifications, await bearerFor(second.authUserId));

      await firstCaller.notifications.markSeen();

      await expect(firstCaller.notifications.list()).resolves.toEqual([
        expect.objectContaining({ seen: true }),
      ]);
      await expect(secondCaller.notifications.list()).resolves.toEqual([
        expect.objectContaining({ seen: false }),
      ]);
      expect(await watermarkRowCount()).toBe(1);
    });
  });

  describe('Scenario: Seen and dismissed are different acts', () => {
    it('reports both independently for the same notification', async () => {
      const { author, recipient, notifications } = await seedPair({
        authorHandle: 'dusty_seen_vs_dismiss_a',
        recipientHandle: 'dusty_seen_vs_dismiss_b',
      });
      await flushNotification(notifications, author, 'Bulletin', new Date('2026-08-01T12:00:00.000Z'));

      const caller = callerFor(notifications, await bearerFor(recipient.authUserId));
      const target = (await caller.notifications.list())[0];
      if (target === undefined) {
        throw new Error('expected a notification');
      }

      // Dismiss first, with no watermark at all: dealt with, but never looked at through
      // the panel. Both flags have to be able to say that.
      await caller.notifications.dismiss({ notificationId: target.notificationId });
      await expect(caller.notifications.list()).resolves.toEqual([
        expect.objectContaining({ unread: false, seen: false }),
      ]);

      // Then open the panel. The dismissal is untouched by it.
      await caller.notifications.markSeen();
      await expect(caller.notifications.list()).resolves.toEqual([
        expect.objectContaining({ unread: false, seen: true }),
      ]);
    });
  });

  describe('Scenario: Marking seen is not an event', () => {
    it('writes zero outbox rows, so nothing downstream ever learns somebody looked', async () => {
      // Opening a panel has no consumer, and an audit entry would durably record every
      // time a person glanced at their own bell.
      const { author, recipient, notifications } = await seedPair({
        authorHandle: 'dusty_seen_noevent_a',
        recipientHandle: 'dusty_seen_noevent_b',
      });
      await flushNotification(notifications, author, 'Bulletin', new Date('2026-08-01T12:00:00.000Z'));

      const caller = callerFor(notifications, await bearerFor(recipient.authUserId));

      const { rows: before } = await testDatabase.client.query<{ count: string }>(
        'select count(*)::text as count from app.outbox_events',
      );
      await caller.notifications.markSeen();
      const { rows: after } = await testDatabase.client.query<{ count: string }>(
        'select count(*)::text as count from app.outbox_events',
      );

      expect(after[0]?.count).toBe(before[0]?.count);
    });
  });

  describe('Scenario: The markSeen procedure refuses an unauthenticated caller', () => {
    it('answers 401 UNAUTHORIZED and writes no row', async () => {
      const caller = callerFor(buildNotificationsModule(), undefined);

      await expect(caller.notifications.markSeen()).rejects.toMatchObject({
        code: 'UNAUTHORIZED',
      });
      expect(await watermarkRowCount()).toBe(0);
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
