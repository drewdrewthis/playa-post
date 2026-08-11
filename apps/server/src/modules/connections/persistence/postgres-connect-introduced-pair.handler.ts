import { randomUUID } from 'node:crypto';

import type { DatabaseConnection } from '@playa-post/database';

import type { OutboxConsumer } from '../../../entrypoints/outbox-drainer/outbox-consumer';
import type { OutboxEventRecord } from '../../../entrypoints/outbox-drainer/outbox-event';
import { CONNECTION_STATUS, orderedPair } from '../domain/connection';
import { connectionAccepted } from '../domain/connection.events';
import { INTRO_ACCEPTED, toIntroducedPair } from '../domain/introduced-pair';

import { toConnection } from './connection.mapper';

/**
 * `app.consumer_receipts.consumer_name` this handler writes under.
 *
 * ⚠ **Stable.** Renaming it makes every past receipt invisible, and every `IntroAccepted`
 * event still inside the outbox's retention would be reprocessed — harmless, because the
 * connection insert is idempotent, but the rename would also make this consumer's history
 * unqueryable, which is the part that does not come back.
 */
export const CONNECT_INTRODUCED_PAIR_CONSUMER = 'ConnectIntroducedPairHandler';

/** PostgreSQL's `unique_violation`. */
const UNIQUE_VIOLATION = '23505';

/**
 * The one field this handler needs from a driver error, read structurally so this file
 * needs no value import from `pg` (mirrors
 * `modules/audit/persistence/postgres-record-audit-entry-handler.ts`).
 */
function isUniqueViolation(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return false;
  }
  return (error as { code?: unknown }).code === UNIQUE_VIOLATION;
}

/** Everything the handler needs, injected (addendum §12). */
export interface ConnectIntroducedPairDependencies {
  /** Connected as `app_rw` and nothing else (ADR-0002 §2). */
  readonly database: DatabaseConnection;
  /** Reads the wall clock for the receipt. Overridable so a test can pin `processed_at`. */
  readonly now?: (() => Date) | undefined;
}

/**
 * Form the connection an accepted introduction earned (issue #166, decision D12).
 *
 * **This is the second way a connection can come into existence**, after
 * `ConnectionRepository.acceptInvitation`, and it is deliberately in this module rather
 * than in `modules/intros`: `app.connections` is this module's table, and a cross-module
 * write to it would be the reach-in addendum §19 forbids and `sql-table-ownership` polices
 * for the checked-in half it can see.
 *
 * **An event rather than a call, and that is the whole point of D12.** `modules/intros`
 * writes `status = 'accepted'` and this event in one transaction; the drainer delivers it
 * at least once; this handler writes the edge under its own receipt. A synchronous call
 * from the accepting service would put the two facts in two transactions with no
 * reconciliation — and because answering an introduction is terminal-once, a failure
 * between them would leave an acceptance nobody could retry and a connection that never
 * forms. Here the failure mode is a delivery still owed, which is what the drainer's
 * retry and dead-letter path already exists to handle.
 *
 * **The only file in this module allowed to contain SQL besides the repositories** — the
 * `no-sql-outside-persistence` fitness rule fails the build on a SQL literal anywhere but
 * `persistence/`, and this is `persistence/`. It is written with the Kysely builder rather
 * than a `sql` literal for the same reason `postgres-connection.repository.ts` is: the
 * generated schema then type-checks the column list.
 *
 * One transaction covering three writes, in the order ADR-0006 requires:
 *
 * 1. `app.consumer_receipts` — **first**, so a redelivery hits the unique violation and
 *    abandons the transaction before the connection insert is even attempted. `handle`
 *    then resolves normally, because a duplicate delivery is "already processed → skip"
 *    rather than a failure.
 * 2. `app.connections` — the edge, `on conflict do nothing`, so a pair who already know
 *    each other are not connected twice and no read-then-write race exists.
 * 3. `app.outbox_events` — `ConnectionAccepted`, **only when a row was actually
 *    inserted**. An already-connected pair is not a new fact, so nothing announces one:
 *    the same call `acceptInvitation` makes when an invite is spent between two people who
 *    already connected.
 */
export function createConnectIntroducedPairHandler(
  dependencies: ConnectIntroducedPairDependencies,
): OutboxConsumer {
  const { database } = dependencies;
  const readClock = dependencies.now ?? ((): Date => new Date());

  return {
    consumerName: CONNECT_INTRODUCED_PAIR_CONSUMER,

    async handle(event: OutboxEventRecord): Promise<void> {
      // Returning rather than throwing for an event this consumer does not subscribe to:
      // the drainer routes by nothing more than "here is an event", and a throw would push
      // every unrelated delivery through the retry-and-dead-letter path (ADR-0006,
      // M2-AC23) and eventually raise an alert about nothing.
      if (event.eventType !== INTRO_ACCEPTED) {
        return;
      }

      const pair = toIntroducedPair(event);
      const [userAId, userBId] = orderedPair(pair.requesterId, pair.targetId);

      // Set the moment the receipt insert returns, so the catch below can tell a
      // redelivery (the receipt's own unique violation — the only 23505 this transaction
      // is allowed to swallow) from a unique violation raised by a *later* write, which
      // must fail the delivery: swallowing one of those would mark the event processed
      // with no connection formed and nothing owed.
      let receiptWritten = false;

      try {
        await database.transaction().execute(async (transaction) => {
          await transaction
            .insertInto('app.consumer_receipts')
            .values({
              consumer_name: CONNECT_INTRODUCED_PAIR_CONSUMER,
              event_id: event.eventId,
              processed_at: readClock(),
            })
            .execute();
          receiptWritten = true;

          const inserted = await transaction
            .insertInto('app.connections')
            .values({
              user_a_id: userAId,
              user_b_id: userBId,
              status: CONNECTION_STATUS.accepted,
              // The moment the target accepted, never the moment this was delivered — see
              // `IntroducedPair.occurredAt`. The disclosure levels are left to the
              // columns' own defaults, which is exactly what an accepted invite gets.
              created_at: pair.occurredAt,
            })
            .onConflict((onConflict) => onConflict.columns(['user_a_id', 'user_b_id']).doNothing())
            .returningAll()
            .executeTakeFirst();

          if (inserted === undefined) {
            // These two are already connected — through an invite, or through an earlier
            // introduction between the same pair. The acceptance still stands and the
            // receipt above still lands; there is simply no new fact to announce.
            return;
          }

          const connection = toConnection(inserted);
          const accepted = connectionAccepted(connection, {
            // The target is who accepted. Taken from the payload rather than the
            // envelope's `actor_id`, which is nullable for system-originated events and
            // would have to be defaulted to somebody here.
            actorId: pair.targetId,
            origin: { introRequestId: pair.introRequestId },
          });

          // The outbox row rides the same transaction as the connection it describes —
          // the entire point of ADR-0006, and the reason this consumer is allowed to
          // publish at all.
          await transaction
            .insertInto('app.outbox_events')
            .values({
              // ADR-0006 names UUID v7; PostgreSQL 17 has no `uuidv7()`. v4 is a correct
              // key — the ADR guarantees no ordering — and this is one of the lines that
              // changes when a v7 source arrives.
              event_id: randomUUID(),
              event_type: accepted.type,
              occurred_at: accepted.occurredAt,
              actor_id: accepted.actorId,
              aggregate_id: accepted.connectionId,
              // Identifiers only, and **no note of either kind**: this row descends from
              // an intro request that carries two, and neither has ever been in an event
              // payload. `introRequestId` replaces the `invitationId` an invite-formed
              // connection carries — see `ConnectionOrigin`.
              payload: {
                connectionId: accepted.connectionId,
                introRequestId: pair.introRequestId,
                userAId: accepted.userAId,
                userBId: accepted.userBId,
              },
            })
            .execute();
        });
      } catch (error) {
        if (!receiptWritten && isUniqueViolation(error)) {
          return;
        }
        throw error;
      }
    },
  };
}
