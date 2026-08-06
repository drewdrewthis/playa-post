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
// L3a's public module factory. Read-only use here (creating one real bulletin for
// the `@e2e` scenario's real router call) is not the "must not touch
// modules/bulletins/persistence" this lane's brief forbids — that names the TS
// persistence layer, not the module's own public factory every other lane imports.
import { createBulletinsModule } from '../../../bulletins/bulletins.module';
// L2's public module factory, exporting the §6a person projection (ratified decision
// (c), m2-lane-briefs.md §"Module ownership"). Recipient resolution and the
// delivery-time re-check compose this — never a direct `app.users` read.
import { createGraphModule } from '../../../graph/graph.module';
// L1's public module factory — never identity's persistence, per `no-cross-module-
// persistence`. Mirrors every L2/L3a integration suite's seam.
import { createIdentityModule } from '../../../identity/identity.module';
// None of these exist yet — legible failure at this seam until the coder writes them.
// Interface shapes are this suite's own design, disclosed in the lane's test-writing
// manifest (see the PR description / handoff note): `OutboxConsumer` /
// `OutboxEventRow` are assumed local to `modules/notifications` because
// L3b-infra's drainer (which will eventually call these same handlers) is being
// built on a sibling branch and is not on `main` yet — this lane must not depend on
// its unmerged shape. Reconciling the two is the coder's job when L3b-infra merges.
import type { PushPayload, PushTransport } from '../../domain/push-transport';
import { createNotificationsModule, type NotificationsModule } from '../../notifications.module';

/**
 * `specs/features/notify-me.feature` — the six push/matching scenarios owned by
 * this lane (M2-AC7 x3, M2-AC8, M2-AC21, M2-AC22). `notifyMe.update`'s M2-AC19
 * scenario lives in `modules/views/tests/integration/notify-me-query.integration.
 * test.ts` (views owns the Notify Me *query* half); push subscription's M2-AC18
 * scenario lives in `push-subscription.integration.test.ts` beside this file.
 *
 * **Design assumptions recorded here as AC ambiguities** (mirrors the discipline
 * every other lane's integration suite already uses for an open design question):
 *
 * 1. **Grouping window is tumbling from the first match, not sliding.** ADR-0006
 *    names "a 60 s window" and the feature file anchors both boundary scenarios to
 *    "opened the notification window at t = 0" — a fixed `[windowStart, windowStart
 *    + 60s)` interval that a later match either falls inside or starts a new window
 *    outside of, not a session window that resets on every new match. Both scenarios
 *    are satisfiable under either reading; tumbling is the simpler one and the one
 *    this suite is written against.
 * 2. **Matching happens by writing a `NotifyMeMatched` outbox event per
 *    (recipient, bulletin) pair**, inside the same transaction as
 *    `EvaluateNotifyMeHandler`'s own `consumer_receipts` row for the triggering
 *    `BulletinCreated` event — the mechanism that gives M2-AC8 its idempotency for
 *    free, the same way every other consumer in this codebase gets it (ADR-0006).
 *    `SendGroupedPushHandler.flush({ now })` is the scheduled "grouping window
 *    flush" cron job (ADR-0006 "Scheduled work"): it reads pending `NotifyMeMatched`
 *    rows, groups them per recipient by the tumbling window above, and for every
 *    window that has fully elapsed as of `now`, re-checks recipient authorization
 *    (ADR-0002 section 11) before sending one push and writing its own
 *    `consumer_receipts` row.
 * 3. **"The receipt records the suppression" (M2-AC22) means a `consumer_receipts`
 *    row for `SendGroupedPushHandler` exists for the flushed window even though no
 *    push was sent** — the row is what stops the drainer from retrying a delivery
 *    that was correctly refused, and its mere presence alongside a push-transport
 *    call count of zero *is* the suppression record. `app.consumer_receipts`
 *    carries no `outcome` column (ADR-0006's schema is `consumer_name, event_id,
 *    processed_at` only, and this lane does not migrate a new column onto a table
 *    it does not own), so this suite does not assert a distinct "suppressed" value
 *    anywhere in SQL — only receipt-present-but-push-not-sent.
 *
 * The coder/reviewer owns ratifying all three in the same PR that adds
 * `notifications.module.ts`, or replacing them with a better design — these are
 * this suite's own choices, not something m2-lane-briefs.md pins.
 */
describe('Notify Me push (notify-me.feature, M2-AC7/AC8/AC21/AC22)', () => {
  let testDatabase: PostgresTestDatabase;
  let database: DatabaseConnection;
  let signingKey: SupabaseSigningKeyPair;

  beforeAll(async () => {
    testDatabase = await startPostgresTestDatabase();
    await testDatabase.client.query(`alter role app_rw with password 'app_rw_in_a_throwaway_container'`);
    database = createDatabaseConnection({
      connectionString: asRole(testDatabase.connectionString, 'app_rw', 'app_rw_in_a_throwaway_container'),
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

  async function removeConnection(userAId: string, userBId: string): Promise<void> {
    // Direct SQL rather than the connections module's remove service: this suite
    // must not import `modules/connections/persistence`, and a status flip is the
    // one fact that matters to `app.visible_people` — the service's own event
    // bookkeeping is `modules/connections`' concern, already proven by its own
    // suite.
    await testDatabase.client.query(
      `update app.connections set status = 'removed'
        where (user_a_id = $1 and user_b_id = $2) or (user_a_id = $2 and user_b_id = $1)`,
      [userAId, userBId],
    );
  }

  async function seedNotifyMeQuery(ownerId: string, sourceText: string): Promise<void> {
    await testDatabase.client.query(
      `insert into app.notify_me_queries (owner_id, source_text, ast, ast_version, version, updated_at)
       values ($1, $2, $3::jsonb, 1, 1, now())`,
      [ownerId, sourceText, JSON.stringify({ types: ['request'], text: [] })],
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

  /**
   * A `BulletinCreated` outbox row, inserted directly rather than through
   * `bulletins.create` — this suite must not touch `modules/bulletins/persistence`,
   * and `app.outbox_events` is L2's shared table (m2-lane-briefs.md's ratified
   * decision (a)), so writing to it directly is the sanctioned seam.
   */
  async function insertBulletinCreatedEvent(options: {
    readonly bulletinId: string;
    readonly authorId: string;
    readonly occurredAt: Date;
  }): Promise<OutboxEventRowForTest> {
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
    return {
      eventId,
      eventType: 'BulletinCreated',
      occurredAt: options.occurredAt,
      actorId: options.authorId,
      aggregateId: options.bulletinId,
      payload: { bulletinId: options.bulletinId, authorId: options.authorId, bulletinType: 'request' },
    };
  }

  async function consumerReceiptCount(consumerName: string): Promise<number> {
    const { rows } = await testDatabase.client.query<{ count: string }>(
      `select count(*)::text as count from app.consumer_receipts where consumer_name = $1`,
      [consumerName],
    );
    return Number(rows[0]?.count ?? '0');
  }

  async function matchedOutboxCount(status?: string): Promise<number> {
    const { rows } = await testDatabase.client.query<{ count: string }>(
      status === undefined
        ? `select count(*)::text as count from app.outbox_events where event_type = 'NotifyMeMatched'`
        : `select count(*)::text as count from app.outbox_events
            where event_type = 'NotifyMeMatched' and status = $1`,
      status === undefined ? [] : [status],
    );
    return Number(rows[0]?.count ?? '0');
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

  function buildNotificationsModule(pushTransport: PushTransport): NotificationsModule {
    const { visiblePeople } = createGraphModule({ database });
    return createNotificationsModule({ database, visiblePeople, pushTransport });
  }

  describe('Scenario: A matching Request bulletin produces a grouped push notification (@e2e, API-level)', () => {
    it('delivers exactly one push and writes a matching consumer_receipts row', async () => {
      const userA = await seedOnboardedUser('dusty_notify_a');
      const userB = await seedOnboardedUser('dusty_notify_b');
      await seedAcceptedConnection(userA.userId, userB.userId);
      await seedNotifyMeQuery(userB.userId, 'type:request');
      await seedPushSubscription(userB.userId);

      // Real router, real JWT, real outbox — the `@e2e` API-level discipline every
      // other lane's suite already establishes for its one browser-less flow proof.
      const bulletinsModule = createBulletinsModule({ database });
      const createCaller = createCallerFactory(router({ bulletins: bulletinsModule.router }));
      const { actorResolver } = createIdentityModule({ database });
      const dependencies = {
        accessTokenVerifier: createSupabaseJwtVerifier({ keySource: signingKey.publicKey }),
        actorResolver,
      };
      const tokenForA = await mintSupabaseAsymmetricUserToken({
        signingKey,
        role: 'authenticated',
        subject: userA.authUserId,
      });
      const callerA = createCaller(contextFor(`Bearer ${tokenForA}`, dependencies));

      const created = await callerA.bulletins.create({
        type: 'request',
        title: 'Need a ride to the airport',
        body: 'Leaving Sunday morning.',
      });

      const { rows: eventRows } = await testDatabase.client.query<{
        event_id: string;
        occurred_at: Date;
        actor_id: string;
        aggregate_id: string;
        payload: Record<string, unknown>;
      }>(`select event_id, occurred_at, actor_id, aggregate_id, payload from app.outbox_events
           where event_type = 'BulletinCreated' and aggregate_id = $1`, [created.id]);
      const eventRow = eventRows[0];
      if (eventRow === undefined) {
        throw new Error('expected a BulletinCreated outbox row for the created bulletin');
      }

      const pushTransport = createFakePushTransport();
      const notifications = buildNotificationsModule(pushTransport);

      await notifications.evaluateNotifyMe.handle({
        eventId: eventRow.event_id,
        eventType: 'BulletinCreated',
        occurredAt: eventRow.occurred_at,
        actorId: eventRow.actor_id,
        aggregateId: eventRow.aggregate_id,
        payload: eventRow.payload,
      });

      // "When the notification window flushes" — a scheduled operation, not a
      // client-facing procedure, so there is no router call for this step.
      await notifications.sendGroupedPush.flush({ now: new Date(eventRow.occurred_at.getTime() + 120_000) });

      expect(pushTransport.calls).toHaveLength(1);
      expect(pushTransport.calls[0]?.recipientId).toBe(userB.userId);
      expect(await consumerReceiptCount('SendGroupedPushHandler')).toBe(1);
    });
  });

  describe('Scenario: A second matching bulletin at 59 seconds joins the same group (@integration, M2-AC7)', () => {
    it('delivers both bulletins as one notification', async () => {
      const userA = await seedOnboardedUser('dusty_window_59_a');
      const userB = await seedOnboardedUser('dusty_window_59_b');
      await seedAcceptedConnection(userA.userId, userB.userId);
      await seedNotifyMeQuery(userB.userId, 'type:request');
      await seedPushSubscription(userB.userId);

      const windowStart = new Date('2026-08-01T12:00:00.000Z');
      const bulletinOne = await seedBulletin(userA.userId, {
        title: 'Bulletin one',
        body: 'First match, opens the window.',
        createdAt: windowStart,
      });
      const eventOne = await insertBulletinCreatedEvent({
        bulletinId: bulletinOne,
        authorId: userA.userId,
        occurredAt: windowStart,
      });

      const secondAt = new Date(windowStart.getTime() + 59_000);
      const bulletinTwo = await seedBulletin(userA.userId, {
        title: 'Bulletin two',
        body: 'Second match, 59 seconds later.',
        createdAt: secondAt,
      });
      const eventTwo = await insertBulletinCreatedEvent({
        bulletinId: bulletinTwo,
        authorId: userA.userId,
        occurredAt: secondAt,
      });

      const pushTransport = createFakePushTransport();
      const notifications = buildNotificationsModule(pushTransport);

      await notifications.evaluateNotifyMe.handle(eventOne);
      await notifications.evaluateNotifyMe.handle(eventTwo);
      await notifications.sendGroupedPush.flush({ now: new Date(windowStart.getTime() + 180_000) });

      expect(pushTransport.calls).toHaveLength(1);
      expect(new Set(pushTransport.calls[0]?.bulletinIds)).toEqual(new Set([bulletinOne, bulletinTwo]));
    });
  });

  describe('Scenario: A matching bulletin at 61 seconds starts a new group (@integration, M2-AC7)', () => {
    it('produces a second, separate notification', async () => {
      const userA = await seedOnboardedUser('dusty_window_61_a');
      const userB = await seedOnboardedUser('dusty_window_61_b');
      await seedAcceptedConnection(userA.userId, userB.userId);
      await seedNotifyMeQuery(userB.userId, 'type:request');
      await seedPushSubscription(userB.userId);

      const windowStart = new Date('2026-08-01T12:00:00.000Z');
      const bulletinOne = await seedBulletin(userA.userId, {
        title: 'Bulletin one',
        body: 'First match, opens the window.',
        createdAt: windowStart,
      });
      const eventOne = await insertBulletinCreatedEvent({
        bulletinId: bulletinOne,
        authorId: userA.userId,
        occurredAt: windowStart,
      });

      const secondAt = new Date(windowStart.getTime() + 61_000);
      const bulletinTwo = await seedBulletin(userA.userId, {
        title: 'Bulletin two',
        body: 'Second match, 61 seconds later — outside the first window.',
        createdAt: secondAt,
      });
      const eventTwo = await insertBulletinCreatedEvent({
        bulletinId: bulletinTwo,
        authorId: userA.userId,
        occurredAt: secondAt,
      });

      const pushTransport = createFakePushTransport();
      const notifications = buildNotificationsModule(pushTransport);

      await notifications.evaluateNotifyMe.handle(eventOne);
      await notifications.evaluateNotifyMe.handle(eventTwo);
      await notifications.sendGroupedPush.flush({ now: new Date(secondAt.getTime() + 180_000) });

      expect(pushTransport.calls).toHaveLength(2);
      const allBulletinIds = pushTransport.calls.flatMap((call) => call.bulletinIds);
      expect(new Set(allBulletinIds)).toEqual(new Set([bulletinOne, bulletinTwo]));
    });
  });

  describe('Scenario: Delivering the same event twice produces one notification (@e2e, M2-AC8)', () => {
    it('writes exactly one NotifyMeMatched row and one consumer_receipts row', async () => {
      const userA = await seedOnboardedUser('dusty_dupe_a');
      const userB = await seedOnboardedUser('dusty_dupe_b');
      await seedAcceptedConnection(userA.userId, userB.userId);
      await seedNotifyMeQuery(userB.userId, 'type:request');
      await seedPushSubscription(userB.userId);

      const occurredAt = new Date('2026-08-01T12:00:00.000Z');
      const bulletinId = await seedBulletin(userA.userId, {
        title: 'Bulletin',
        body: 'Delivered twice by an at-least-once drainer.',
        createdAt: occurredAt,
      });
      const event = await insertBulletinCreatedEvent({ bulletinId, authorId: userA.userId, occurredAt });

      const pushTransport = createFakePushTransport();
      const notifications = buildNotificationsModule(pushTransport);

      await notifications.evaluateNotifyMe.handle(event);
      await notifications.evaluateNotifyMe.handle(event);

      expect(await matchedOutboxCount()).toBe(1);
      expect(await consumerReceiptCount('EvaluateNotifyMeHandler')).toBe(1);
    });
  });

  describe('Scenario: Push payload carries only identifiers and a generic string (@integration, M2-AC21)', () => {
    it('is exactly { recipientId, bulletinIds, message } with no bulletin content', async () => {
      const userA = await seedOnboardedUser('dusty_payload_a');
      const userB = await seedOnboardedUser('dusty_payload_b');
      await seedAcceptedConnection(userA.userId, userB.userId);
      await seedNotifyMeQuery(userB.userId, 'type:request');
      await seedPushSubscription(userB.userId);

      const occurredAt = new Date('2026-08-01T12:00:00.000Z');
      const bulletinId = await seedBulletin(userA.userId, {
        title: 'A sensitive headline nobody should see on a lock screen',
        body: 'Body text, an author name, or any contact detail must never reach the payload.',
        createdAt: occurredAt,
      });
      const event = await insertBulletinCreatedEvent({ bulletinId, authorId: userA.userId, occurredAt });

      const pushTransport = createFakePushTransport();
      const notifications = buildNotificationsModule(pushTransport);

      await notifications.evaluateNotifyMe.handle(event);
      await notifications.sendGroupedPush.flush({ now: new Date(occurredAt.getTime() + 120_000) });

      expect(pushTransport.calls).toHaveLength(1);
      const payload = pushTransport.calls[0];

      // "M2-AC21's evidence is the payload quoted in full" — a full-object equality,
      // not a subset match, so an accidentally-added field fails this test rather
      // than passing silently.
      expect(payload).toEqual({
        recipientId: userB.userId,
        bulletinIds: [bulletinId],
        message: expect.any(String),
      });
      expect(Object.keys(payload as object).sort()).toEqual(['bulletinIds', 'message', 'recipientId']);

      const serialized = JSON.stringify(payload);
      expect(serialized).not.toMatch(/sensitive headline/i);
      expect(serialized).not.toMatch(/Body text/i);
      expect(serialized).not.toMatch(new RegExp(userA.userId));
    });
  });

  describe('Scenario: A recipient made unauthorized before flush does not receive the push (@integration, M2-AC22)', () => {
    it('sends no push and still records a receipt for the flushed window', async () => {
      const userA = await seedOnboardedUser('dusty_revoke_a');
      const userB = await seedOnboardedUser('dusty_revoke_b');
      await seedAcceptedConnection(userA.userId, userB.userId);
      await seedNotifyMeQuery(userB.userId, 'type:request');
      await seedPushSubscription(userB.userId);

      const occurredAt = new Date('2026-08-01T12:00:00.000Z');
      const bulletinId = await seedBulletin(userA.userId, {
        title: 'Bulletin computed before the block',
        body: 'B is authorized when this is matched, not when it is flushed.',
        createdAt: occurredAt,
      });
      const event = await insertBulletinCreatedEvent({ bulletinId, authorId: userA.userId, occurredAt });

      const pushTransport = createFakePushTransport();
      const notifications = buildNotificationsModule(pushTransport);

      // Compute: B is still connected to A, so the match is legitimately produced.
      await notifications.evaluateNotifyMe.handle(event);

      // B's authorization is revoked between compute and the scheduled flush
      // (ADR-0002 section 11's exact race).
      await removeConnection(userA.userId, userB.userId);

      await notifications.sendGroupedPush.flush({ now: new Date(occurredAt.getTime() + 120_000) });

      expect(pushTransport.calls).toHaveLength(0);
      // The receipt still lands — its presence with zero pushes sent is what
      // "the receipt records the suppression" means for this schema (see this
      // file's docblock, assumption 3): it stops the drainer from retrying a
      // delivery that was correctly refused.
      expect(await consumerReceiptCount('SendGroupedPushHandler')).toBe(1);
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
