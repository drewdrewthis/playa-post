import { randomUUID } from 'node:crypto';

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { startPostgresTestDatabase, type PostgresTestDatabase } from '@playa-post/testing';

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
});

/** Mirrors `packages/database/src/database-schema.integration.test.ts`'s helper. */
function asRole(connectionString: string, username: string, password: string): string {
  const url = new URL(connectionString);
  url.username = username;
  url.password = password;
  return url.toString();
}
