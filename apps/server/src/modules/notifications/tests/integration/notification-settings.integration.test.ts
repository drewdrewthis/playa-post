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

/**
 * `notifications.settings.*` and the default-on delivery it governs (issue #209,
 * ADR-0020).
 *
 * Two halves, deliberately in one file, because the second is what the first *means*:
 *
 * 1. **The transport contract** — `settings.get` answers all-on for a person who never
 *    touched a switch, `settings.update` flips one and answers where they all stand,
 *    and a retry converges. Through the real router and the real auth middleware, the
 *    idiom `notifications-list.integration.test.ts` establishes.
 * 2. **The delivery consequence** — a connected person with **no stored query** is
 *    matched by a bulletin (D1's default-on, which no unit fake can prove because the
 *    eligibility read is `app.visible_bulletins`), an out-of-graph person is not, a
 *    `bulletins` opt-out removes someone the graph would otherwise serve, and a `note`
 *    opt-out means no receipt — and the receipt is the notification (D4).
 */
describe('notifications.settings and default-on delivery (issue #209, ADR-0020)', () => {
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

  /** A `NotePinned` outbox row, identifiers only — the shape `modules/notes` writes. */
  async function insertNotePinnedEvent(options: {
    readonly noteId: string;
    readonly authorId: string;
    readonly recipientId: string;
    readonly occurredAt: Date;
  }): Promise<OutboxEventRowForTest> {
    const eventId = randomUUID();
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

  async function matchedRecipients(): Promise<readonly string[]> {
    const { rows } = await testDatabase.client.query<{ recipient_id: string }>(
      `select payload ->> 'recipientId' as recipient_id
         from app.outbox_events where event_type = 'NotifyMeMatched'
        order by 1`,
    );
    return rows.map((row) => row.recipient_id);
  }

  async function noteReceiptCount(eventId: string): Promise<number> {
    const { rows } = await testDatabase.client.query<{ count: string }>(
      `select count(*)::text as count from app.consumer_receipts
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

  /** A caller over the real router and the real auth middleware. */
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

  describe('Scenario: A person who never opened the settings reads all-on', () => {
    it('answers both kinds enabled, in a stable order', async () => {
      const person = await seedOnboardedUser('dusty_settings_default');
      const notifications = buildNotificationsModule();
      const caller = callerFor(notifications, await bearerFor(person.authUserId));

      const settings = await caller.notifications.settings.get();

      expect(settings).toEqual({
        settings: [
          { kind: 'bulletins', enabled: true },
          { kind: 'note', enabled: true },
        ],
      });
    });
  });

  describe('Scenario: Flipping one switch off, and back on, converges', () => {
    it('answers the full list on every call, and a retry changes nothing', async () => {
      const person = await seedOnboardedUser('dusty_settings_flip');
      const notifications = buildNotificationsModule();
      const caller = callerFor(notifications, await bearerFor(person.authUserId));

      const off = await caller.notifications.settings.update({ kind: 'note', enabled: false });
      expect(off).toEqual({
        settings: [
          { kind: 'bulletins', enabled: true },
          { kind: 'note', enabled: false },
        ],
      });

      // A retry of the same flip converges — the PK makes off-twice one row.
      const offAgain = await caller.notifications.settings.update({ kind: 'note', enabled: false });
      expect(offAgain).toEqual(off);
      expect(await caller.notifications.settings.get()).toEqual(off);

      const on = await caller.notifications.settings.update({ kind: 'note', enabled: true });
      expect(on).toEqual({
        settings: [
          { kind: 'bulletins', enabled: true },
          { kind: 'note', enabled: true },
        ],
      });
    });
  });

  describe('Scenario: A connected person with no stored query is matched by default (ADR-0020 D1)', () => {
    it('matches the queryless connection and nobody outside the graph', async () => {
      const author = await seedOnboardedUser('dusty_default_author');
      const connected = await seedOnboardedUser('dusty_default_connected');
      await seedOnboardedUser('dusty_default_stranger');
      await seedAcceptedConnection(author.userId, connected.userId);
      // The stranger is deliberately connected to nobody: eligibility is
      // `app.visible_bulletins`, so they must not appear however default-on the default is.

      const occurredAt = new Date('2026-08-01T12:00:00.000Z');
      const bulletinId = await seedBulletin(author.userId, {
        title: 'Need a ride',
        body: 'No query anywhere, and the connection still hears about it.',
        createdAt: occurredAt,
      });
      const event = await insertBulletinCreatedEvent({
        bulletinId,
        authorId: author.userId,
        occurredAt,
      });

      const notifications = buildNotificationsModule();
      await notifications.evaluateNotifyMe.handle(event);

      expect(await matchedRecipients()).toEqual([connected.userId]);
    });
  });

  describe('Scenario: A bulletins opt-out removes a person the graph would serve', () => {
    it('matches the still-opted-in connection only', async () => {
      const author = await seedOnboardedUser('dusty_optout_author');
      const optedOut = await seedOnboardedUser('dusty_optout_off');
      const optedIn = await seedOnboardedUser('dusty_optout_on');
      await seedAcceptedConnection(author.userId, optedOut.userId);
      await seedAcceptedConnection(author.userId, optedIn.userId);

      const notifications = buildNotificationsModule();
      const offCaller = callerFor(notifications, await bearerFor(optedOut.authUserId));
      await offCaller.notifications.settings.update({ kind: 'bulletins', enabled: false });

      const occurredAt = new Date('2026-08-01T12:00:00.000Z');
      const bulletinId = await seedBulletin(author.userId, {
        title: 'Need a ride',
        body: 'One connection switched bulletins off.',
        createdAt: occurredAt,
      });
      const event = await insertBulletinCreatedEvent({
        bulletinId,
        authorId: author.userId,
        occurredAt,
      });

      await notifications.evaluateNotifyMe.handle(event);

      expect(await matchedRecipients()).toEqual([optedIn.userId]);
    });
  });

  describe('Scenario: A note opt-out means no receipt, and the receipt is the notification (ADR-0020 D4)', () => {
    it('writes no receipt for the opted-out recipient, and writes one after opting back in', async () => {
      const author = await seedOnboardedUser('dusty_note_author');
      const recipient = await seedOnboardedUser('dusty_note_recipient');
      await seedAcceptedConnection(author.userId, recipient.userId);

      const notifications = buildNotificationsModule();
      const caller = callerFor(notifications, await bearerFor(recipient.authUserId));
      await caller.notifications.settings.update({ kind: 'note', enabled: false });

      const occurredAt = new Date('2026-08-01T12:00:00.000Z');
      const noteId = await seedNote(author.userId, recipient.userId, {
        body: 'Meet me at the temple at sunrise.',
        createdAt: occurredAt,
      });
      const skipped = await insertNotePinnedEvent({
        noteId,
        authorId: author.userId,
        recipientId: recipient.userId,
        occurredAt,
      });
      await notifications.deliverNotePinned.handle(skipped);

      // No receipt — the opt-out in its entirety. The skip is permanent for this
      // event: the handler returned normally, so the drainer will not redeliver it.
      expect(await noteReceiptCount(skipped.eventId)).toBe(0);

      await caller.notifications.settings.update({ kind: 'note', enabled: true });

      const laterNoteId = await seedNote(author.userId, recipient.userId, {
        body: 'Second note, after opting back in.',
        createdAt: new Date(occurredAt.getTime() + 60_000),
      });
      const delivered = await insertNotePinnedEvent({
        noteId: laterNoteId,
        authorId: author.userId,
        recipientId: recipient.userId,
        occurredAt: new Date(occurredAt.getTime() + 60_000),
      });
      await notifications.deliverNotePinned.handle(delivered);

      expect(await noteReceiptCount(delivered.eventId)).toBe(1);
    });
  });

  describe('Scenario: An unauthenticated caller is refused', () => {
    it('refuses both procedures with UNAUTHORIZED', async () => {
      const notifications = buildNotificationsModule();
      const caller = callerFor(notifications, undefined);

      await expect(caller.notifications.settings.get()).rejects.toMatchObject({
        code: 'UNAUTHORIZED',
      });
      await expect(
        caller.notifications.settings.update({ kind: 'note', enabled: false }),
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
