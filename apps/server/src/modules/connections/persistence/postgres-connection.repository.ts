import { randomUUID } from 'node:crypto';

import type { DatabaseConnection } from '@playa-post/database';

import { CONNECTION_STATUS, orderedPair, type Connection } from '../domain/connection';
import { connectionAccepted } from '../domain/connection.events';
import type {
  AcceptInvitationWrite,
  AcceptedConnection,
  ConnectionRepository,
} from '../domain/connection.repository';
import { INVITATION_STATUS } from '../domain/invitation';
import { InvitationUnavailableError } from '../domain/invitation.errors';

import { toConnection } from './connection.mapper';

/** Everything the repository needs, injected (addendum §12). */
export interface PostgresConnectionRepositoryDependencies {
  /** Connected as `app_rw` and nothing else (ADR-0002 §2). */
  readonly database: DatabaseConnection;
}

/**
 * The accepted connection between two people, whichever order it was stored in.
 *
 * A local helper rather than a second port method because the transactional write
 * needs the same lookup against its own transaction handle, and two spellings of "are
 * these two connected" is the kind of near-duplicate that drifts into two different
 * answers.
 *
 * Both orders are matched. The application writes pairs in canonical order, but
 * fixtures and any pre-canonical row may be stored either way round, and a read that
 * quietly missed half of them would look like a visibility bug rather than a storage
 * one.
 */
async function findAcceptedConnection(
  database: DatabaseConnection,
  oneUserId: string,
  otherUserId: string,
): Promise<Connection | null> {
  const row = await database
    .selectFrom('app.connections')
    .selectAll()
    .where('status', '=', CONNECTION_STATUS.accepted)
    .where((eb) =>
      eb.or([
        eb.and([eb('user_a_id', '=', oneUserId), eb('user_b_id', '=', otherUserId)]),
        eb.and([eb('user_a_id', '=', otherUserId), eb('user_b_id', '=', oneUserId)]),
      ]),
    )
    .executeTakeFirst();

  return row === undefined ? null : toConnection(row);
}

/**
 * `app.connections`, behind the domain's {@link ConnectionRepository} port.
 *
 * Every statement is schema-qualified per ADR-0002's pooler-safety rules.
 *
 * ⚠ This file also writes `app.invitations` and `app.outbox_events`, which is not a
 * layering slip: acceptance is **one transactional fact** (addendum §10, ADR-0006),
 * and a port per table would make the atomicity a convention that two services have to
 * remember rather than a guarantee the database enforces. The port's docstring states
 * the whole write; this is the only implementation of it.
 */
export function createPostgresConnectionRepository(
  dependencies: PostgresConnectionRepositoryDependencies,
): ConnectionRepository {
  const { database } = dependencies;

  return {
    async findBetween(oneUserId: string, otherUserId: string): Promise<Connection | null> {
      return findAcceptedConnection(database, oneUserId, otherUserId);
    },

    async acceptInvitation(write: AcceptInvitationWrite): Promise<AcceptedConnection> {
      return database.transaction().execute(async (transaction) => {
        // Spending the invite is conditional on it still being `pending`, and that
        // `where` is the concurrency control: two simultaneous acceptances of one
        // token both read `pending`, and exactly one of them updates a row. The loser
        // is refused here rather than going on to create a second connection.
        const spent = await transaction
          .updateTable('app.invitations')
          .set({
            status: INVITATION_STATUS.accepted,
            accepted_by_id: write.inviteeId,
            accepted_at: write.occurredAt,
          })
          .where('id', '=', write.invitation.id)
          .where('status', '=', INVITATION_STATUS.pending)
          .executeTakeFirst();

        if (spent.numUpdatedRows === 0n) {
          throw new InvitationUnavailableError();
        }

        const [userAId, userBId] = orderedPair(write.invitation.inviterId, write.inviteeId);
        const inserted = await transaction
          .insertInto('app.connections')
          .values({
            user_a_id: userAId,
            user_b_id: userBId,
            status: CONNECTION_STATUS.accepted,
            created_at: write.occurredAt,
          })
          // These two may already be connected through an earlier invite. That spends
          // this token — it was a real, valid invite — but creates nothing and
          // announces nothing, because no new fact occurred. `do nothing` says that in
          // one statement instead of a read-then-write race.
          .onConflict((onConflict) =>
            onConflict.columns(['user_a_id', 'user_b_id']).doNothing(),
          )
          .returningAll()
          .executeTakeFirst();

        if (inserted === undefined) {
          const existing = await findAcceptedConnection(transaction, userAId, userBId);
          if (existing === null) {
            // The insert conflicted, so a row for this pair exists, yet it is not an
            // accepted one — the pair key spans every status. Nothing here can make
            // that coherent, so fail closed and leave the transaction to roll back.
            throw new InvitationUnavailableError();
          }
          return { connection: existing, event: null };
        }

        const connection = toConnection(inserted);
        const event = connectionAccepted(connection, {
          actorId: write.inviteeId,
          origin: { invitationId: write.invitation.id },
        });

        // The outbox row rides the same transaction as the connection it describes —
        // the entire point of ADR-0006. Publishing to a queue from here instead is the
        // dual-write bug: the commit succeeds, the publish fails, and the two diverge
        // with nothing left to reconcile them.
        await transaction
          .insertInto('app.outbox_events')
          .values({
            // ADR-0006 names UUID v7; PostgreSQL 17 has no `uuidv7()` and M2 adds no
            // dependency for one. v4 is a correct key — the ADR guarantees no ordering
            // and consumers must not assume any — and this is the one line that
            // changes when a v7 source arrives.
            event_id: randomUUID(),
            event_type: event.type,
            occurred_at: event.occurredAt,
            actor_id: event.actorId,
            aggregate_id: event.connectionId,
            // Identifiers only. A consumer re-reads what it needs through the owning
            // module's authorized path, so a delivery can never carry data the current
            // visibility rules have since withdrawn (ADR-0006, PDF §6).
            //
            // Passed as an object, not a `JSON.stringify`d string: the generated type
            // for a `jsonb` column is `Json`, so a string type-checks and stores a
            // JSON *scalar* — `"{\"connectionId\":…}"` — that every consumer would
            // then have to parse twice. `pg` serializes the object itself.
            payload: {
              connectionId: event.connectionId,
              // From the invite being spent rather than off the event: since #166
              // `ConnectionAccepted.invitationId` is one arm of a union and is absent on
              // an introduction-formed connection, so reading it here would type as
              // `string | undefined` and could serialize a payload with no origin at all.
              // On this path there is always exactly one invite, and it is right here.
              invitationId: write.invitation.id,
              userAId: event.userAId,
              userBId: event.userBId,
            },
          })
          .execute();

        return { connection, event };
      });
    },
  };
}
