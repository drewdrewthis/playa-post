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
// L2's public module factory, exporting the §6a person projection — never a direct
// `app.users` read, and never `modules/graph/persistence`.
import { createGraphModule } from '../../../graph/graph.module';
// L1's public module factory, for the actor resolution the auth middleware performs.
import { createIdentityModule } from '../../../identity/identity.module';
import { DELIVER_NOTE_PINNED_CONSUMER } from '../../application/deliver-note-pinned.handler';
import type { PushPayload, PushTransport } from '../../domain/push-transport';
import { createNotificationsModule, type NotificationsModule } from '../../notifications.module';
import type { PresentedNotification } from '../../transport/grouped-notification.presenter';

/**
 * `notifications.list` — the read half of `modules/notifications` (issue #31).
 *
 * **No feature-file scenario states this procedure**, and that is disclosed rather than
 * papered over: `notify-me.feature` covers *producing* a grouped notification and
 * `vertical-slice-e2e.feature` step 9 asserts one is produced for a matching viewer. The
 * panel that step drives needs a data source, and this suite is where the behaviour that
 * source must have is pinned. Each choice below is an AC ambiguity resolved here, the
 * same discipline `notify-me-push.integration.test.ts` uses for its three:
 *
 * 1. **A notification exists once the flush has claimed its window** — the grouped-push
 *    flush is the writer, so the read reports what the writer produced and nothing else.
 *    A `NotifyMeMatched` row still `pending` is a match whose window has not closed; it is
 *    not yet a notification and does not appear.
 * 2. **Grouping is the flush's grouping, not a second rule.** The read reuses
 *    `domain/notification-window.ts`, the one place "which bulletins arrive as one
 *    notification" is defined (M2-AC7). Both boundary cases the feature file states — 59 s
 *    joins, 61 s starts a second — are asserted here *through the read*, because a second
 *    grouping rule would be invisible to the write-side suite that already proves them.
 * 3. **Authorization is re-applied at read time, and it is a post-filter.** ADR-0002 §11
 *    re-evaluates authorization at the moment of disclosure; `app.visible_bulletins` is
 *    the one definition of what a viewer may see (ADR-0002 §6). Filtering happens *after*
 *    grouping so that losing access to one bulletin cannot silently re-shape the window
 *    boundaries the flush already committed to.
 * 4. **The payload carries identifiers only** — M2-AC5 ("no author name, handle, or avatar
 *    … in notifications") and M2-AC10 ("no response … contains V's ID … across bulletin
 *    read, notifications, and A's own bulletin list") are constraints on *this* response,
 *    and identifier-only satisfies both by construction rather than by redaction. The
 *    panel's follow-up read through `bulletins.*` is what applies §6a author projection.
 *
 * The coder/reviewer owns ratifying all four, or replacing them with a better design.
 *
 * **Issue #149 added a second kind to this read** — a note somebody pinned to the
 * viewer's board — and it obeys all four points above with one difference stated in its
 * own block: a note is **never grouped**, so its notification is the `NotePinned` event
 * itself and the third point's re-check is asked of `app.visible_notes`. That the
 * composed drainer is actually wired to the consumer whose receipt makes a note
 * notification exist is `composition/container-notification-wiring.integration.test.ts`'s
 * subject — this suite wires the module by hand, so it could not see that regression.
 */
describe('notifications.list (issue #31, vertical-slice step 9)', () => {
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

  async function seedOnboardedUser(
    handle: string,
  ): Promise<{ userId: string; authUserId: string }> {
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
    // Direct SQL rather than the connections module's service, for the reason
    // `notify-me-push.integration.test.ts` states: this suite must not import
    // `modules/connections/persistence`, and a status flip is the one fact
    // `app.visible_people` — and therefore `app.visible_bulletins` — reads.
    await testDatabase.client.query(
      `update app.connections set status = 'removed'
        where (user_a_id = $1 and user_b_id = $2) or (user_a_id = $2 and user_b_id = $1)`,
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
   * A note on somebody's board, inserted directly — `modules/notes/persistence` is
   * another module's and stays untouched, exactly as `seedBulletin` treats bulletins'.
   */
  async function seedNote(
    authorId: string,
    recipientId: string,
    options: { readonly body: string; readonly createdAt: Date },
  ): Promise<string> {
    const { rows } = await testDatabase.client.query<{ id: string }>(
      `insert into app.notes (author_id, recipient_id, body, created_at)
       values ($1, $2, $3, $4) returning id`,
      [authorId, recipientId, options.body, options.createdAt],
    );
    const id = rows[0]?.id;
    if (id === undefined) {
      throw new Error('seedNote: insert returned no row');
    }
    return id;
  }

  /** A `NotePinned` outbox row, inserted through the same sanctioned seam. */
  async function insertNotePinnedEvent(options: {
    readonly noteId: string;
    readonly authorId: string;
    readonly recipientId: string;
    readonly occurredAt: Date;
  }): Promise<OutboxEventRowForTest> {
    const eventId = randomUUID();
    // ⚠ Identifiers only, and no `body` — the shape `modules/notes` actually writes
    // (see its `appendOutboxEvent`). A payload carrying note text here would make this
    // suite prove the wrong thing.
    const payload = {
      noteId: options.noteId,
      authorId: options.authorId,
      recipientId: options.recipientId,
    };
    await testDatabase.client.query(
      `insert into app.outbox_events
         (event_id, event_type, occurred_at, actor_id, aggregate_id, payload)
       values ($1, 'NotePinned', $2, $3, $4, $5::jsonb)`,
      [eventId, options.occurredAt, options.authorId, options.noteId, JSON.stringify(payload)],
    );
    return {
      eventId,
      eventType: 'NotePinned',
      occurredAt: options.occurredAt,
      actorId: options.authorId,
      aggregateId: options.noteId,
      payload,
    };
  }

  /**
   * A `BulletinCreated` outbox row, inserted directly — `app.outbox_events` is L2's
   * shared table (ratified decision (a)), so writing to it is the sanctioned seam and
   * `modules/bulletins/persistence` stays untouched.
   */
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

  /** How many receipts the `NotePinned` consumer has written for one event. */
  async function receiptCountFor(eventId: string): Promise<number> {
    const { rows } = await testDatabase.client.query<{ count: string }>(
      `select count(*)::text as count
         from app.consumer_receipts
        where consumer_name = $1 and event_id = $2`,
      [DELIVER_NOTE_PINNED_CONSUMER, eventId],
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

  function buildNotificationsModule(): NotificationsModule {
    const { visiblePeople } = createGraphModule({ database });
    return createNotificationsModule({
      database,
      visiblePeople,
      pushTransport: createFakePushTransport(),
    });
  }

  /**
   * A caller over the **real** router and the **real** auth middleware.
   *
   * The whole point of this suite is the transport contract — who is refused, and what a
   * permitted caller is handed — so a caller that skipped `authenticatedProcedure` would
   * be asserting against the wrong thing.
   */
  function callerFor(notifications: NotificationsModule, authorizationHeader: string | undefined) {
    const { actorResolver } = createIdentityModule({ database });
    // One module's router rather than the whole `createAppRouter`, the idiom every
    // module suite uses: a notifications test must not have to satisfy seven other
    // modules' dependencies to call one procedure.
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
   * One recipient with one matching, flushed bulletin — the shape almost every scenario
   * below starts from.
   */
  async function seedFlushedNotification(options: {
    readonly authorHandle: string;
    readonly recipientHandle: string;
    readonly occurredAt: Date;
    readonly title?: string;
    readonly body?: string;
  }): Promise<{
    author: { userId: string; authUserId: string };
    recipient: { userId: string; authUserId: string };
    bulletinId: string;
    notifications: NotificationsModule;
  }> {
    const author = await seedOnboardedUser(options.authorHandle);
    const recipient = await seedOnboardedUser(options.recipientHandle);
    await seedAcceptedConnection(author.userId, recipient.userId);
    await seedNotifyMeQuery(recipient.userId);
    await seedPushSubscription(recipient.userId);

    const bulletinId = await seedBulletin(author.userId, {
      title: options.title ?? 'Need a ride to the airport',
      body: options.body ?? 'Leaving Sunday morning.',
      createdAt: options.occurredAt,
    });
    const event = await insertBulletinCreatedEvent({
      bulletinId,
      authorId: author.userId,
      occurredAt: options.occurredAt,
    });

    const notifications = buildNotificationsModule();
    await notifications.evaluateNotifyMe.handle(event);
    await notifications.sendGroupedPush.flush({
      now: new Date(options.occurredAt.getTime() + 120_000),
    });

    return { author, recipient, bulletinId, notifications };
  }

  /**
   * One recipient with one note pinned to their board, already delivered by the
   * `NotePinned` consumer — the shape every note scenario below starts from.
   *
   * The delivery goes through `notifications.deliverNotePinned.handle(event)`, the same
   * seam the bulletin helper uses for `evaluateNotifyMe`: what the *drainer* is wired
   * with is `container-notification-wiring.integration.test.ts`'s subject, and asserting it
   * twice would make one of the two the copy that rots.
   */
  async function seedDeliveredNote(options: {
    readonly authorHandle: string;
    readonly recipientHandle: string;
    readonly occurredAt: Date;
    readonly body?: string;
  }): Promise<{
    author: { userId: string; authUserId: string };
    recipient: { userId: string; authUserId: string };
    noteId: string;
    eventId: string;
    notifications: NotificationsModule;
  }> {
    const author = await seedOnboardedUser(options.authorHandle);
    const recipient = await seedOnboardedUser(options.recipientHandle);
    await seedAcceptedConnection(author.userId, recipient.userId);

    const noteId = await seedNote(author.userId, recipient.userId, {
      body: options.body ?? 'Meet me at the temple at sunrise.',
      createdAt: options.occurredAt,
    });
    const event = await insertNotePinnedEvent({
      noteId,
      authorId: author.userId,
      recipientId: recipient.userId,
      occurredAt: options.occurredAt,
    });

    const notifications = buildNotificationsModule();
    await notifications.deliverNotePinned.handle(event);

    return { author, recipient, noteId, eventId: event.eventId, notifications };
  }

  /**
   * One owner with one pending connection request, already delivered by the
   * `ConnectionRequested` consumer (issue #218) — the same seam discipline as
   * `seedDeliveredNote`, with the recipient key named `ownerId` because that is the
   * shape `modules/connections` actually writes.
   */
  async function seedDeliveredConnectionRequest(options: {
    readonly ownerHandle: string;
    readonly requesterHandle: string;
    readonly occurredAt: Date;
  }): Promise<{
    owner: { userId: string; authUserId: string };
    requester: { userId: string; authUserId: string };
    requestId: string;
    eventId: string;
    notifications: NotificationsModule;
  }> {
    const owner = await seedOnboardedUser(options.ownerHandle);
    const requester = await seedOnboardedUser(options.requesterHandle);

    const { rows } = await testDatabase.client.query<{ id: string }>(
      `insert into app.connection_requests (owner_id, requester_id, status, created_at)
       values ($1, $2, 'pending', $3) returning id`,
      [owner.userId, requester.userId, options.occurredAt],
    );
    const requestId = rows[0]?.id;
    if (requestId === undefined) {
      throw new Error('connection request insert returned no row');
    }

    const eventId = randomUUID();
    const payload = { ownerId: owner.userId, requesterId: requester.userId };
    await testDatabase.client.query(
      `insert into app.outbox_events
         (event_id, event_type, occurred_at, actor_id, aggregate_id, payload)
       values ($1, 'ConnectionRequested', $2, $3, $4, $5::jsonb)`,
      [eventId, options.occurredAt, requester.userId, requestId, JSON.stringify(payload)],
    );

    const notifications = buildNotificationsModule();
    await notifications.deliverConnectionRequested.handle({
      eventId,
      eventType: 'ConnectionRequested',
      occurredAt: options.occurredAt,
      actorId: requester.userId,
      aggregateId: requestId,
      payload,
    });

    return { owner, requester, requestId, eventId, notifications };
  }

  describe('Scenario: A connection request reaches its owner’s bell (issue #218)', () => {
    it('answers one connections notification carrying the request identifier and nothing else', async () => {
      const occurredAt = new Date('2026-08-14T12:00:00.000Z');
      const { owner, requestId, eventId, notifications } = await seedDeliveredConnectionRequest({
        ownerHandle: 'dusty_conn_owner',
        requesterHandle: 'dusty_conn_asker',
        occurredAt,
      });

      const caller = callerFor(notifications, await bearerFor(owner.authUserId));
      const listed = await caller.notifications.list();

      expect(listed).toEqual([
        {
          kind: 'connections',
          notificationId: eventId,
          occurredAt: occurredAt.toISOString(),
          connectionRequestId: requestId,
          unread: true,
          seen: false,
        },
      ]);
      // Identifiers only — no requester handle, so the bell says someone asked without
      // naming them until the owner opens the request itself.
      expect(JSON.stringify(listed)).not.toMatch(/dusty_conn_asker/i);
    });

    it('drops the notification once the request is decided', async () => {
      const { owner, requestId, notifications } = await seedDeliveredConnectionRequest({
        ownerHandle: 'dusty_conn_decided_owner',
        requesterHandle: 'dusty_conn_decided_asker',
        occurredAt: new Date('2026-08-14T12:00:00.000Z'),
      });

      const caller = callerFor(notifications, await bearerFor(owner.authUserId));
      await expect(caller.notifications.list()).resolves.toHaveLength(1);

      await testDatabase.client.query(
        `update app.connection_requests set status = 'accepted', decided_at = now() where id = $1`,
        [requestId],
      );

      await expect(caller.notifications.list()).resolves.toEqual([]);
    });

    it('drops the notification once the request lapses past its fourteen days', async () => {
      const fifteenDaysAgo = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000);
      const { owner, notifications } = await seedDeliveredConnectionRequest({
        ownerHandle: 'dusty_conn_lapsed_owner',
        requesterHandle: 'dusty_conn_lapsed_asker',
        occurredAt: fifteenDaysAgo,
      });

      const caller = callerFor(notifications, await bearerFor(owner.authUserId));

      await expect(caller.notifications.list()).resolves.toEqual([]);
    });

    it('marks the request read once its owner dismisses it', async () => {
      // Exercises the ownerId branch of hasDeliveredMatch: a dismissal names the event,
      // and the repository must recognize the owner as this event's recipient.
      const { owner, eventId, notifications } = await seedDeliveredConnectionRequest({
        ownerHandle: 'dusty_conn_dismiss_owner',
        requesterHandle: 'dusty_conn_dismiss_asker',
        occurredAt: new Date('2026-08-14T12:00:00.000Z'),
      });

      const caller = callerFor(notifications, await bearerFor(owner.authUserId));
      await expect(
        caller.notifications.dismiss({ notificationId: eventId }),
      ).resolves.toMatchObject({ notificationId: eventId });

      const listed = await caller.notifications.list();

      expect(listed).toHaveLength(1);
      expect(listed[0]?.unread).toBe(false);
    });

    it("refuses a dismissal of somebody else's connection notification", async () => {
      const { eventId, notifications } = await seedDeliveredConnectionRequest({
        ownerHandle: 'dusty_conn_theirs_owner',
        requesterHandle: 'dusty_conn_theirs_asker',
        occurredAt: new Date('2026-08-14T12:00:00.000Z'),
      });
      const stranger = await seedOnboardedUser('dusty_conn_theirs_stranger');

      const caller = callerFor(notifications, await bearerFor(stranger.authUserId));

      await expect(
        caller.notifications.dismiss({ notificationId: eventId }),
      ).rejects.toMatchObject({
        code: 'NOT_FOUND',
        cause: expect.objectContaining({ code: 'NOTIFICATION_UNAVAILABLE' }),
      });
    });
  });

  describe('Scenario: A viewer reads the grouped notification the flush produced', () => {
    it('answers one notification carrying the matched bulletin', async () => {
      const occurredAt = new Date('2026-08-01T12:00:00.000Z');
      const { recipient, bulletinId, notifications } = await seedFlushedNotification({
        authorHandle: 'dusty_list_a',
        recipientHandle: 'dusty_list_b',
        occurredAt,
      });

      const caller = callerFor(notifications, await bearerFor(recipient.authUserId));
      const listed = await caller.notifications.list();

      expect(listed).toHaveLength(1);
      expect(listed[0]).toMatchObject({ kind: 'bulletins', bulletinIds: [bulletinId] });
      expect(listed[0]?.occurredAt).toBe(occurredAt.toISOString());
      expect(listed[0]?.notificationId).toEqual(expect.any(String));
    });
  });

  describe('Scenario: A pinned note reaches its recipient’s bell (issue #149)', () => {
    it('answers one note notification carrying the note identifier and nothing else', async () => {
      const occurredAt = new Date('2026-08-01T12:00:00.000Z');
      const { recipient, noteId, eventId, notifications } = await seedDeliveredNote({
        authorHandle: 'dusty_note_a',
        recipientHandle: 'dusty_note_b',
        occurredAt,
        body: 'A private line that must never appear in a notification payload.',
      });

      const caller = callerFor(notifications, await bearerFor(recipient.authUserId));
      const listed = await caller.notifications.list();

      expect(listed).toEqual([
        {
          kind: 'note',
          // The `NotePinned` event's own id, which is also what a dismissal names.
          notificationId: eventId,
          occurredAt: occurredAt.toISOString(),
          noteId,
          unread: true,
          // Never opened their panel, so nothing is seen yet (issue #178). Like `unread`
          // it is a fact about this caller alone and quotes nothing.
          seen: false,
        },
      ]);
      // A full-equality assertion above already forbids an extra field; this says why it
      // matters. A note is the most private thing this product stores, and the bell must
      // say one arrived without ever quoting it or naming who wrote it.
      const serialized = JSON.stringify(listed);
      expect(serialized).not.toMatch(/private line/i);
      expect(serialized).not.toMatch(/dusty_note_a/i);
    });

    it('answers nothing while the NotePinned event has no delivery receipt', async () => {
      // ADR-0006 makes the receipt the record that a consumer processed an event, so an
      // undrained `NotePinned` row is a note that has been pinned but not yet notified —
      // it must not appear, or the bell would be reading the outbox rather than a
      // delivery.
      const occurredAt = new Date('2026-08-01T12:00:00.000Z');
      const author = await seedOnboardedUser('dusty_note_undelivered_a');
      const recipient = await seedOnboardedUser('dusty_note_undelivered_b');
      await seedAcceptedConnection(author.userId, recipient.userId);
      const noteId = await seedNote(author.userId, recipient.userId, {
        body: 'Pinned, but not yet drained.',
        createdAt: occurredAt,
      });
      await insertNotePinnedEvent({
        noteId,
        authorId: author.userId,
        recipientId: recipient.userId,
        occurredAt,
      });
      // Deliberately no `deliverNotePinned.handle`.

      const caller = callerFor(buildNotificationsModule(), await bearerFor(recipient.authUserId));

      await expect(caller.notifications.list()).resolves.toEqual([]);
    });

    it('drops the notification once the note leaves app.visible_notes', async () => {
      const { recipient, noteId, notifications } = await seedDeliveredNote({
        authorHandle: 'dusty_note_gone_a',
        recipientHandle: 'dusty_note_gone_b',
        occurredAt: new Date('2026-08-01T12:00:00.000Z'),
      });

      const caller = callerFor(notifications, await bearerFor(recipient.authUserId));
      await expect(caller.notifications.list()).resolves.toHaveLength(1);

      // ADR-0002 §11's re-check on the read path. Removing the row is the bluntest way to
      // make `app.visible_notes` stop returning it, and the mechanism is not the point —
      // the point is that the notification follows the authorized set rather than the
      // delivery record, whatever makes the two diverge.
      await testDatabase.client.query(`delete from app.notes where id = $1`, [noteId]);

      await expect(caller.notifications.list()).resolves.toEqual([]);
    });

    it('refuses to disclose a note the event payload claims but app.visible_notes does not', async () => {
      // The payload routes; it never authorizes. A `NotePinned` row naming this viewer as
      // recipient while the note itself is addressed to somebody else must disclose
      // nothing — otherwise the outbox, which any future writer can append to, would be a
      // way to hand somebody another person's note identifier.
      const occurredAt = new Date('2026-08-01T12:00:00.000Z');
      const author = await seedOnboardedUser('dusty_note_lying_a');
      const realRecipient = await seedOnboardedUser('dusty_note_lying_b');
      const impostor = await seedOnboardedUser('dusty_note_lying_c');
      await seedAcceptedConnection(author.userId, realRecipient.userId);

      const noteId = await seedNote(author.userId, realRecipient.userId, {
        body: 'Addressed to exactly one person.',
        createdAt: occurredAt,
      });
      const event = await insertNotePinnedEvent({
        noteId,
        authorId: author.userId,
        // The lie: the envelope says this note is for the impostor.
        recipientId: impostor.userId,
        occurredAt,
      });

      const notifications = buildNotificationsModule();
      await notifications.deliverNotePinned.handle(event);

      const caller = callerFor(notifications, await bearerFor(impostor.authUserId));

      await expect(caller.notifications.list()).resolves.toEqual([]);
    });

    it('marks the note read once its recipient dismisses it', async () => {
      const { recipient, eventId, notifications } = await seedDeliveredNote({
        authorHandle: 'dusty_note_dismiss_a',
        recipientHandle: 'dusty_note_dismiss_b',
        occurredAt: new Date('2026-08-01T12:00:00.000Z'),
      });

      const caller = callerFor(notifications, await bearerFor(recipient.authUserId));
      await expect(
        caller.notifications.dismiss({ notificationId: eventId }),
      ).resolves.toMatchObject({ notificationId: eventId });

      const listed = await caller.notifications.list();

      // Marked, not subtracted — the same rule the grouped kind follows, so the panel's
      // history section works identically for both.
      expect(listed).toHaveLength(1);
      expect(listed[0]?.unread).toBe(false);
    });

    it('refuses a dismissal of somebody else’s note notification', async () => {
      const { eventId, notifications } = await seedDeliveredNote({
        authorHandle: 'dusty_note_theirs_a',
        recipientHandle: 'dusty_note_theirs_b',
        occurredAt: new Date('2026-08-01T12:00:00.000Z'),
      });
      const stranger = await seedOnboardedUser('dusty_note_theirs_c');

      const caller = callerFor(notifications, await bearerFor(stranger.authUserId));

      await expect(
        caller.notifications.dismiss({ notificationId: eventId }),
      ).rejects.toMatchObject({
        code: 'NOT_FOUND',
        cause: expect.objectContaining({ code: 'NOTIFICATION_UNAVAILABLE' }),
      });
    });
  });

  describe('Scenario: The NotePinned consumer is idempotent and minds its own events', () => {
    it('lists one notification after the same event is delivered twice (M2-AC8)', async () => {
      // ADR-0006 promises at-least-once, so a crash between dispatch and the drainer's
      // status update genuinely replays a delivery. Asserted through the list rather than
      // through a row count: two receipts would be invisible to a person, two
      // notifications would not.
      const occurredAt = new Date('2026-08-01T12:00:00.000Z');
      const author = await seedOnboardedUser('dusty_note_replay_a');
      const recipient = await seedOnboardedUser('dusty_note_replay_b');
      await seedAcceptedConnection(author.userId, recipient.userId);
      const noteId = await seedNote(author.userId, recipient.userId, {
        body: 'Delivered once, replayed once.',
        createdAt: occurredAt,
      });
      const event = await insertNotePinnedEvent({
        noteId,
        authorId: author.userId,
        recipientId: recipient.userId,
        occurredAt,
      });

      const notifications = buildNotificationsModule();
      await notifications.deliverNotePinned.handle(event);
      await notifications.deliverNotePinned.handle(event);

      const caller = callerFor(notifications, await bearerFor(recipient.authUserId));

      await expect(caller.notifications.list()).resolves.toHaveLength(1);
      expect(await receiptCountFor(event.eventId)).toBe(1);
    });

    it('writes no receipt for an event it does not subscribe to, and does not throw', async () => {
      // The drainer routes every event to every consumer. Throwing would push an
      // irrelevant delivery through the retry-and-dead-letter path (ADR-0006, M2-AC23)
      // and eventually raise an alert about nothing; claiming a receipt would be worse,
      // because here the receipt *is* the notification.
      const author = await seedOnboardedUser('dusty_note_foreign_a');
      const bulletinId = await seedBulletin(author.userId, {
        title: 'Not a note',
        body: 'A BulletinCreated has no business with the note consumer.',
        createdAt: new Date('2026-08-01T12:00:00.000Z'),
      });
      const event = await insertBulletinCreatedEvent({
        bulletinId,
        authorId: author.userId,
        occurredAt: new Date('2026-08-01T12:00:00.000Z'),
      });

      const notifications = buildNotificationsModule();

      await expect(notifications.deliverNotePinned.handle(event)).resolves.toBeUndefined();
      expect(await receiptCountFor(event.eventId)).toBe(0);
    });
  });

  describe('Scenario: Both kinds share one list', () => {
    it('serves the note and the grouped bulletins together, newest first', async () => {
      const bulletinAt = new Date('2026-08-01T12:00:00.000Z');
      const { author, recipient, bulletinId, notifications } = await seedFlushedNotification({
        authorHandle: 'dusty_mixed_a',
        recipientHandle: 'dusty_mixed_b',
        occurredAt: bulletinAt,
      });

      const noteAt = new Date(bulletinAt.getTime() + 600_000);
      const noteId = await seedNote(author.userId, recipient.userId, {
        body: 'Later than the bulletin.',
        createdAt: noteAt,
      });
      await notifications.deliverNotePinned.handle(
        await insertNotePinnedEvent({
          noteId,
          authorId: author.userId,
          recipientId: recipient.userId,
          occurredAt: noteAt,
        }),
      );

      const caller = callerFor(notifications, await bearerFor(recipient.authUserId));
      const listed = await caller.notifications.list();

      expect(listed).toHaveLength(2);
      expect(listed[0]).toMatchObject({ kind: 'note', noteId });
      expect(listed[1]).toMatchObject({ kind: 'bulletins', bulletinIds: [bulletinId] });
    });
  });

  describe("Scenario: Another viewer sees nothing of someone else's notifications", () => {
    it('answers an empty list for an unrelated onboarded viewer', async () => {
      const { notifications } = await seedFlushedNotification({
        authorHandle: 'dusty_scope_a',
        recipientHandle: 'dusty_scope_b',
        occurredAt: new Date('2026-08-01T12:00:00.000Z'),
      });
      const stranger = await seedOnboardedUser('dusty_scope_c');

      const caller = callerFor(notifications, await bearerFor(stranger.authUserId));

      await expect(caller.notifications.list()).resolves.toEqual([]);
    });
  });

  describe('Scenario: Two matches inside one window read as one notification (M2-AC7)', () => {
    it('answers a single notification carrying both bulletins', async () => {
      const author = await seedOnboardedUser('dusty_read_59_a');
      const recipient = await seedOnboardedUser('dusty_read_59_b');
      await seedAcceptedConnection(author.userId, recipient.userId);
      await seedNotifyMeQuery(recipient.userId);
      await seedPushSubscription(recipient.userId);

      const windowStart = new Date('2026-08-01T12:00:00.000Z');
      const first = await seedBulletin(author.userId, {
        title: 'Bulletin one',
        body: 'First match, opens the window.',
        createdAt: windowStart,
      });
      const secondAt = new Date(windowStart.getTime() + 59_000);
      const second = await seedBulletin(author.userId, {
        title: 'Bulletin two',
        body: 'Second match, 59 seconds later.',
        createdAt: secondAt,
      });

      const notifications = buildNotificationsModule();
      await notifications.evaluateNotifyMe.handle(
        await insertBulletinCreatedEvent({
          bulletinId: first,
          authorId: author.userId,
          occurredAt: windowStart,
        }),
      );
      await notifications.evaluateNotifyMe.handle(
        await insertBulletinCreatedEvent({
          bulletinId: second,
          authorId: author.userId,
          occurredAt: secondAt,
        }),
      );
      await notifications.sendGroupedPush.flush({
        now: new Date(windowStart.getTime() + 180_000),
      });

      const caller = callerFor(notifications, await bearerFor(recipient.authUserId));
      const listed = await caller.notifications.list();

      expect(listed).toHaveLength(1);
      expect(new Set(bulletinIdsOf(listed[0]))).toEqual(new Set([first, second]));
    });
  });

  describe('Scenario: A match outside the window reads as a second notification (M2-AC7)', () => {
    it('answers two notifications, newest first', async () => {
      const author = await seedOnboardedUser('dusty_read_61_a');
      const recipient = await seedOnboardedUser('dusty_read_61_b');
      await seedAcceptedConnection(author.userId, recipient.userId);
      await seedNotifyMeQuery(recipient.userId);
      await seedPushSubscription(recipient.userId);

      const windowStart = new Date('2026-08-01T12:00:00.000Z');
      const first = await seedBulletin(author.userId, {
        title: 'Bulletin one',
        body: 'First match, opens the window.',
        createdAt: windowStart,
      });
      const secondAt = new Date(windowStart.getTime() + 61_000);
      const second = await seedBulletin(author.userId, {
        title: 'Bulletin two',
        body: 'Second match, outside the first window.',
        createdAt: secondAt,
      });

      const notifications = buildNotificationsModule();
      await notifications.evaluateNotifyMe.handle(
        await insertBulletinCreatedEvent({
          bulletinId: first,
          authorId: author.userId,
          occurredAt: windowStart,
        }),
      );
      await notifications.evaluateNotifyMe.handle(
        await insertBulletinCreatedEvent({
          bulletinId: second,
          authorId: author.userId,
          occurredAt: secondAt,
        }),
      );
      await notifications.sendGroupedPush.flush({ now: new Date(secondAt.getTime() + 180_000) });

      const caller = callerFor(notifications, await bearerFor(recipient.authUserId));
      const listed = await caller.notifications.list();

      expect(listed).toHaveLength(2);
      // Newest first: a panel reads top-down, and the most recent notification is the
      // one a person opened the panel to see.
      expect(bulletinIdsOf(listed[0])).toEqual([second]);
      expect(bulletinIdsOf(listed[1])).toEqual([first]);
    });
  });

  describe('Scenario: A match whose window has not been flushed is not a notification yet', () => {
    it('answers an empty list while the match is still pending', async () => {
      const author = await seedOnboardedUser('dusty_pending_a');
      const recipient = await seedOnboardedUser('dusty_pending_b');
      await seedAcceptedConnection(author.userId, recipient.userId);
      await seedNotifyMeQuery(recipient.userId);
      await seedPushSubscription(recipient.userId);

      const occurredAt = new Date('2026-08-01T12:00:00.000Z');
      const bulletinId = await seedBulletin(author.userId, {
        title: 'Matched but not yet flushed',
        body: 'The window has not closed.',
        createdAt: occurredAt,
      });

      const notifications = buildNotificationsModule();
      await notifications.evaluateNotifyMe.handle(
        await insertBulletinCreatedEvent({
          bulletinId,
          authorId: author.userId,
          occurredAt,
        }),
      );
      // Deliberately no flush.

      const caller = callerFor(notifications, await bearerFor(recipient.authUserId));

      await expect(caller.notifications.list()).resolves.toEqual([]);
    });
  });

  describe('Scenario: A viewer who has lost access to the bulletin no longer sees it listed', () => {
    it('drops the notification once its bulletin leaves the viewer’s authorized set', async () => {
      const occurredAt = new Date('2026-08-01T12:00:00.000Z');
      const { author, recipient, notifications } = await seedFlushedNotification({
        authorHandle: 'dusty_revoked_read_a',
        recipientHandle: 'dusty_revoked_read_b',
        occurredAt,
      });

      const caller = callerFor(notifications, await bearerFor(recipient.authUserId));
      await expect(caller.notifications.list()).resolves.toHaveLength(1);

      // ADR-0002 §11's race, moved to the read path: authorization is re-evaluated at
      // the moment of disclosure, so the notification stops being disclosable the
      // instant its bulletin leaves `app.visible_bulletins` for this viewer.
      await removeConnection(author.userId, recipient.userId);

      await expect(caller.notifications.list()).resolves.toEqual([]);
    });
  });

  describe('Scenario: The listed notification carries identifiers only (M2-AC5, M2-AC10)', () => {
    it('exposes exactly { notificationId, occurredAt, bulletinIds, unread } and no author or content', async () => {
      const occurredAt = new Date('2026-08-01T12:00:00.000Z');
      const { author, notifications, recipient } = await seedFlushedNotification({
        authorHandle: 'dusty_minimal_a',
        recipientHandle: 'dusty_minimal_b',
        occurredAt,
        title: 'A sensitive headline nobody should see in a panel payload',
        body: 'Body text, an author name, or any contact detail must never reach the list.',
      });

      const caller = callerFor(notifications, await bearerFor(recipient.authUserId));
      const listed = await caller.notifications.list();
      const notification = listed[0];

      // A full key-set equality rather than a subset match, so an accidentally-added
      // field fails this test rather than passing silently — the same discipline
      // M2-AC21's payload assertion uses on the push side.
      // `unread` and `seen` are booleans derived from the caller's own dismissals and
      // their own last panel open, so each says nothing about anybody else — but both are
      // still fields, and this assertion is a full key-set equality precisely so that
      // adding one is a decision rather than a drift. `seen` was added by issue #178 and
      // this line is where that decision is recorded.
      expect(Object.keys(notification as object).sort()).toEqual([
        'bulletinIds',
        'kind',
        'notificationId',
        'occurredAt',
        'seen',
        'unread',
      ]);

      const serialized = JSON.stringify(listed);
      expect(serialized).not.toMatch(/sensitive headline/i);
      expect(serialized).not.toMatch(/Body text/i);
      expect(serialized).not.toMatch(/dusty_minimal_a/i);
      expect(serialized).not.toMatch(new RegExp(author.userId));
    });
  });

  describe('Scenario: The list refuses a caller with no credentials', () => {
    it('answers 401 UNAUTHORIZED', async () => {
      const caller = callerFor(buildNotificationsModule(), undefined);

      await expect(caller.notifications.list()).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    });
  });

  describe('Scenario: The list refuses a verified caller who is not onboarded', () => {
    it('answers 403 with the stable ONBOARDING_REQUIRED code', async () => {
      // A verified token whose subject has no `app.users` row — the one case that must
      // not be indistinguishable from a bad token (M2-AC2's third row).
      const caller = callerFor(buildNotificationsModule(), await bearerFor(randomUUID()));

      await expect(caller.notifications.list()).rejects.toMatchObject({
        code: 'FORBIDDEN',
        cause: expect.objectContaining({ code: 'ONBOARDING_REQUIRED' }),
      });
    });
  });
});

/**
 * The bulletin ids of a notification that must be a grouped-bulletin one.
 *
 * A narrowing helper rather than a property access: `notifications.list` has served a
 * discriminated union since #149, so a test reaching straight for `bulletinIds` would
 * read `undefined` off a note notification and quietly pass a comparison that means
 * nothing. Throwing names the wrong kind instead.
 */
function bulletinIdsOf(notification: PresentedNotification | undefined): readonly string[] {
  if (notification?.kind !== 'bulletins') {
    throw new Error(
      `expected a grouped-bulletin notification, got ${notification?.kind ?? 'nothing'}`,
    );
  }
  return notification.bulletinIds;
}

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
