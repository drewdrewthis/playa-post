import type { Connection } from './connection';

/** Event type name, past tense (addendum §20). Stable — consumers subscribe to it. */
export const CONNECTION_ACCEPTED = 'ConnectionAccepted';

/**
 * What produced a connection, so a consumer can correlate without a second read.
 *
 * ⚠ **A union of exactly the two ways a connection can form, and it must stay exhaustive.**
 * A spent invite was the only one until issue #166 gave an accepted introduction the same
 * standing (decision D12). Written as a union rather than as two optional keys so a third
 * origin cannot arrive as "both absent" — a payload with neither identifier says a
 * connection appeared from nowhere, which is precisely what an audit trail exists to make
 * impossible.
 */
export type ConnectionOrigin =
  | { readonly invitationId: string }
  | { readonly introRequestId: string };

/**
 * Two people are now connected.
 *
 * **Identifiers only.** ADR-0006 is explicit that a payload carries what a consumer
 * needs to *route*, never content or contact data: an outbox row is durable,
 * widely-read, and outlives the authorization state that produced it, so a consumer
 * re-reads what it needs through the owning module's authorized path — which also
 * means it cannot deliver something the current visibility rules no longer allow.
 *
 * ⚠ **One event type for both origins, never two.** "These two are now connected" is one
 * fact whoever caused it, and a second type would mean every future consumer of it had to
 * remember to subscribe twice — the drift this outbox exists to remove. Which origin it
 * was travels as {@link ConnectionOrigin} instead.
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
  /**
   * The invite that produced it.
   *
   * Absent when the connection came from an accepted introduction rather than from a
   * spent token — see {@link ConnectionAccepted.introRequestId}. Exactly one of the two is
   * present on every event this module builds.
   */
  readonly invitationId?: string;
  /** The introduction that produced it (#166). Absent when an invite did. */
  readonly introRequestId?: string;
  readonly userAId: string;
  readonly userBId: string;
}

/**
 * Build the event for a connection that has just been written.
 *
 * @param connection - The stored row, so `connectionId` is the real aggregate ID
 *   rather than one the caller hoped for.
 * @param acceptance - Who accepted, and what they were acting on. The origin is spread
 *   rather than copied field by field, so the built event carries exactly the one key the
 *   union chose and `exactOptionalPropertyTypes` keeps the other absent instead of
 *   `undefined`.
 */
export function connectionAccepted(
  connection: Connection,
  acceptance: { readonly actorId: string; readonly origin: ConnectionOrigin },
): ConnectionAccepted {
  return {
    type: CONNECTION_ACCEPTED,
    occurredAt: connection.createdAt,
    connectionId: connection.id,
    actorId: acceptance.actorId,
    ...acceptance.origin,
    userAId: connection.userAId,
    userBId: connection.userBId,
  };
}
