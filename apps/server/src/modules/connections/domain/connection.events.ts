import type { Connection } from './connection';

/** Event type name, past tense (addendum §20). Stable — consumers subscribe to it. */
export const CONNECTION_ACCEPTED = 'ConnectionAccepted';

/**
 * Two people are now connected.
 *
 * **Identifiers only.** ADR-0006 is explicit that a payload carries what a consumer
 * needs to *route*, never content or contact data: an outbox row is durable,
 * widely-read, and outlives the authorization state that produced it, so a consumer
 * re-reads what it needs through the owning module's authorized path — which also
 * means it cannot deliver something the current visibility rules no longer allow.
 *
 * Written to `app.outbox_events` **in the same transaction as the connection insert**
 * (addendum §10, ADR-0006). Not published to a queue by anybody here; the drainer
 * (M2.14) is the only publisher.
 */
export interface ConnectionAccepted {
  readonly type: typeof CONNECTION_ACCEPTED;
  readonly occurredAt: Date;
  /** The aggregate this event is about — `app.outbox_events.aggregate_id`. */
  readonly connectionId: string;
  /** Who accepted — `app.outbox_events.actor_id`. */
  readonly actorId: string;
  /** The invite that produced it, so a consumer can correlate without a second read. */
  readonly invitationId: string;
  readonly userAId: string;
  readonly userBId: string;
}

/**
 * Build the event for a connection that has just been written.
 *
 * @param connection - The stored row, so `connectionId` is the real aggregate ID
 *   rather than one the caller hoped for.
 * @param acceptance - Who accepted, and which invite they spent.
 */
export function connectionAccepted(
  connection: Connection,
  acceptance: { readonly actorId: string; readonly invitationId: string },
): ConnectionAccepted {
  return {
    type: CONNECTION_ACCEPTED,
    occurredAt: connection.createdAt,
    connectionId: connection.id,
    actorId: acceptance.actorId,
    invitationId: acceptance.invitationId,
    userAId: connection.userAId,
    userBId: connection.userBId,
  };
}
