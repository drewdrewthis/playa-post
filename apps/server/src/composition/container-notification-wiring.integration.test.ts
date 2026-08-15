import { randomUUID } from 'node:crypto';

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { startPostgresTestDatabase, type PostgresTestDatabase } from '@playa-post/testing';

import { CONNECT_INTRODUCED_PAIR_CONSUMER } from '../modules/connections/persistence/postgres-connect-introduced-pair.handler';
import { DELIVER_CONNECTION_REQUESTED_CONSUMER } from '../modules/notifications/application/deliver-connection-requested.handler';
import { DELIVER_NOTE_PINNED_CONSUMER } from '../modules/notifications/application/deliver-note-pinned.handler';

import type { Configuration } from './config';
import { buildAppContainer, type AppContainer } from './container';

const APP_RW_PASSWORD = 'container_wiring_app_rw_password';

/**
 * The composition root's outbox-consumer registrations, proven by draining a real row.
 *
 * ⚠ **This is the only test that can catch an unregistered consumer, and the failure it
 * catches is silent.** A consumer's receipt is what `notifications.list` joins its event
 * to, so deleting a `toDrainerConsumer(...)` line does not delay a notification — it
 * means the notification never exists, nothing throws, and every module-level suite stays
 * green because each of those wires its own module by hand.
 *
 * **In `composition/` rather than under the module**, because that is where the fact
 * lives and because `no-container-outside-composition` forbids an `apps/**` test outside
 * `entrypoints/**` and `composition/**` from importing `container.ts` at all. Beside
 * `container-notification-wiring.unit.test.ts`, whose subject is the same and whose cost
 * is not — the suffix is the price tag (addendum §20).
 */
describe('buildAppContainer outbox consumer registration', () => {
  let testDatabase: PostgresTestDatabase;
  let container: AppContainer;

  beforeAll(async () => {
    testDatabase = await startPostgresTestDatabase();
    await testDatabase.client.query(`alter role app_rw with password '${APP_RW_PASSWORD}'`);

    const configuration: Configuration = {
      nodeEnv: 'test',
      host: '127.0.0.1',
      port: 0,
      logLevel: 'silent',
      databaseUrl: asRole(testDatabase.connectionString, 'app_rw', APP_RW_PASSWORD),
      // Never fetched: nothing here authenticates a request, and building the verifier
      // opens no socket.
      supabaseUrl: 'http://127.0.0.1:1/unused-by-this-suite',
      // Never swept: nothing here starts the purge poller, and no fixture is old enough.
      purgeRetentionDays: 30,
      // Unconfigured on purpose. This suite's subject is *which consumers are
      // registered*, and `null` composes the no-op push transport, so draining a real
      // row cannot reach for a network this suite has not got. Which transport the
      // switch picks — `null` against the VAPID trio — is proven next door in
      // `container-notification-wiring.unit.test.ts`, where it costs no container.
      webPush: null,
    };
    container = buildAppContainer(configuration);
  }, 300_000);

  afterEach(async () => {
    await testDatabase.truncateAllTables();
  });

  afterAll(async () => {
    await container?.dispose();
    await testDatabase?.stop();
  });

  async function seedOnboardedUser(handle: string): Promise<string> {
    const { rows } = await testDatabase.client.query<{ id: string }>(
      `insert into app.users (auth_user_id, handle, display_name, created_at)
       values ($1, $2, $3, now()) returning id`,
      [randomUUID(), handle, handle],
    );
    const userId = rows[0]?.id;
    if (userId === undefined) {
      throw new Error('seedOnboardedUser: insert returned no row');
    }
    return userId;
  }

  describe('Scenario: A pinned note is delivered by the drainer this container built (#149)', () => {
    it('writes the DeliverNotePinnedHandler receipt for a claimed NotePinned row', async () => {
      const author = await seedOnboardedUser('dusty_wired_author');
      const recipient = await seedOnboardedUser('dusty_wired_recipient');
      const { rows: noteRows } = await testDatabase.client.query<{ id: string }>(
        `insert into app.notes (author_id, recipient_id, body, created_at)
         values ($1, $2, 'Bring water.', now()) returning id`,
        [author, recipient],
      );
      const noteId = noteRows[0]?.id;
      if (noteId === undefined) {
        throw new Error('note insert returned no row');
      }

      // `app.outbox_events` directly: it is L2's shared table and the sanctioned seam, so
      // `modules/notes/persistence` stays untouched. Identifiers only and no `body` —
      // the shape that module actually writes.
      const eventId = randomUUID();
      await testDatabase.client.query(
        `insert into app.outbox_events
           (event_id, event_type, occurred_at, actor_id, aggregate_id, payload)
         values ($1, 'NotePinned', now(), $2, $3, $4::jsonb)`,
        [eventId, author, noteId, JSON.stringify({ noteId, authorId: author, recipientId: recipient })],
      );

      const result = await container.outboxDrainer.drainOnce();

      expect(result.claimedEventIds).toContain(eventId);
      const { rows } = await testDatabase.client.query<{ count: string }>(
        `select count(*)::text as count
           from app.consumer_receipts
          where consumer_name = $1 and event_id = $2`,
        [DELIVER_NOTE_PINNED_CONSUMER, eventId],
      );
      expect(rows[0]?.count).toBe('1');
    });
  });

  describe('Scenario: A connection request is delivered by the drainer this container built (#218)', () => {
    it('writes the DeliverConnectionRequestedHandler receipt for a claimed ConnectionRequested row', async () => {
      const owner = await seedOnboardedUser('dusty_wired_owner');
      const requester = await seedOnboardedUser('dusty_wired_asker');
      const { rows: requestRows } = await testDatabase.client.query<{ id: string }>(
        `insert into app.connection_requests (owner_id, requester_id, status, created_at)
         values ($1, $2, 'pending', now()) returning id`,
        [owner, requester],
      );
      const requestId = requestRows[0]?.id;
      if (requestId === undefined) {
        throw new Error('connection request insert returned no row');
      }

      // The same sanctioned seam as the NotePinned scenario, and the same payload shape
      // `modules/connections` actually writes: the recipient is `ownerId`, not
      // `recipientId` — the key this consumer reads for the opt-out question.
      const eventId = randomUUID();
      await testDatabase.client.query(
        `insert into app.outbox_events
           (event_id, event_type, occurred_at, actor_id, aggregate_id, payload)
         values ($1, 'ConnectionRequested', now(), $2, $3, $4::jsonb)`,
        [eventId, requester, requestId, JSON.stringify({ ownerId: owner, requesterId: requester })],
      );

      const result = await container.outboxDrainer.drainOnce();

      expect(result.claimedEventIds).toContain(eventId);
      const { rows } = await testDatabase.client.query<{ count: string }>(
        `select count(*)::text as count
           from app.consumer_receipts
          where consumer_name = $1 and event_id = $2`,
        [DELIVER_CONNECTION_REQUESTED_CONSUMER, eventId],
      );
      expect(rows[0]?.count).toBe('1');
    });
  });

  describe('Scenario: An accepted introduction connects two people through this container (#166)', () => {
    it('drains IntroAccepted into a real app.connections row', async () => {
      const requester = await seedOnboardedUser('dusty_wired_requester');
      const target = await seedOnboardedUser('dusty_wired_target');
      const via = await seedOnboardedUser('dusty_wired_via');
      const { rows: introRows } = await testDatabase.client.query<{ id: string }>(
        `insert into app.intro_requests
           (requester_id, via_id, target_id, note, via_note, status,
            created_at, decided_at, responded_at)
         values ($1, $2, $3, 'why we should meet', 'worth an hour', 'accepted',
                 now(), now(), now())
         returning id`,
        [requester, via, target],
      );
      const introRequestId = introRows[0]?.id;
      if (introRequestId === undefined) {
        throw new Error('intro request insert returned no row');
      }

      // `app.outbox_events` directly, the same sanctioned seam the scenario above uses:
      // identifiers only and no note of either kind, which is the shape `modules/intros`
      // actually writes.
      const eventId = randomUUID();
      await testDatabase.client.query(
        `insert into app.outbox_events
           (event_id, event_type, occurred_at, actor_id, aggregate_id, payload)
         values ($1, 'IntroAccepted', now(), $2, $3, $4::jsonb)`,
        [
          eventId,
          target,
          introRequestId,
          JSON.stringify({ introRequestId, requesterId: requester, viaId: via, targetId: target }),
        ],
      );

      const result = await container.outboxDrainer.drainOnce();

      expect(result.claimedEventIds).toContain(eventId);

      // ⚠ **The connection itself, not just the receipt**, and that is the difference from
      // the scenario above. Decision D12 makes this event the only thing that forms the
      // edge, so an unregistered consumer here is not a late connection — it is a feature
      // that silently does not exist, with every module-level suite still green because
      // each of those wires its own module by hand.
      const { rows: connections } = await testDatabase.client.query<{ count: string }>(
        `select count(*)::text as count
           from app.connections
          where status = 'accepted'
            and ((user_a_id = $1 and user_b_id = $2) or (user_a_id = $2 and user_b_id = $1))`,
        [requester, target],
      );
      expect(connections[0]?.count).toBe('1');

      const { rows: receipts } = await testDatabase.client.query<{ count: string }>(
        `select count(*)::text as count
           from app.consumer_receipts
          where consumer_name = $1 and event_id = $2`,
        [CONNECT_INTRODUCED_PAIR_CONSUMER, eventId],
      );
      expect(receipts[0]?.count).toBe('1');
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
