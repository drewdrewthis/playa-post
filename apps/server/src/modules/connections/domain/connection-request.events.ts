import { CONNECTION_REQUEST_STATUS, type ConnectionRequest } from './connection-request';

/** Event type names, past tense (addendum §20). Stable — consumers subscribe to them. */
export const CONNECTION_REQUESTED = 'ConnectionRequested';
export const CONNECTION_REQUEST_DECLINED = 'ConnectionRequestDeclined';

/**
 * Something happened to a connection request (issue #206).
 *
 * **Identifiers and routing data only.** ADR-0006 is explicit that a payload carries what a
 * consumer needs to *route*, never content: an outbox row is durable, widely-read, and
 * outlives the authorization state that produced it, so a consumer re-reads what it needs
 * through this module's authorized path — which also means it cannot deliver something the
 * current visibility rules no longer allow.
 *
 * ⚠ **The slug is absent and must stay absent.** It is the owner's published address, it
 * appears in no read this module serves, and an event carrying it would put it in every
 * log line that dumps an outbox row — where it would outlive the rotation that was supposed
 * to retire it. Nothing routes on it: a delivery needs to know *who*, and both parties are
 * already here.
 *
 * There is no acceptance event of this type, on purpose. Accepting emits
 * {@link import('./connection.events').ConnectionAccepted} carrying
 * `connectionRequestId` as its origin, because "these two are now connected" is one fact
 * whoever caused it and a second type would mean every future consumer had to remember to
 * subscribe twice (ADR-0012's `ConnectionOrigin` note).
 */
interface ConnectionRequestEvent {
  readonly occurredAt: Date;
  /** The aggregate this event is about — `app.outbox_events.aggregate_id`. */
  readonly connectionRequestId: string;
  /** Whose link was opened. */
  readonly ownerId: string;
  readonly requesterId: string;
  /** Who acted — `app.outbox_events.actor_id`. The requester, then the owner. */
  readonly actorId: string;
}

/**
 * Somebody asked to connect through a personal link. Routed to the owner.
 *
 * ⚠ **Routing it to the owner is the only delivery this module's request path may ever
 * have**, and it discloses nothing new: they published the link, and the request is
 * already on their inbox where they can read the requester's own self-projection. A
 * consumer says "somebody asked to connect" and links to the inbox; it never names the
 * requester from a payload, because the payload does not carry a name and the inbox read
 * is what applies §6a.
 */
export interface ConnectionRequested extends ConnectionRequestEvent {
  readonly type: typeof CONNECTION_REQUESTED;
}

/**
 * The owner declined. Routed to **nobody**.
 *
 * ⚠ The event exists — the fact happened and the audit trail is entitled to it — and its
 * *delivery* must not exist. A requester who could tell a decline from a request nobody has
 * answered would make declining unsafe for the owner, and an owner who cannot safely
 * decline will accept to avoid the awkwardness, which is the whole of what a personal link
 * is supposed to protect them from. This is ADR-0017's founding invariant applied one
 * relationship along, and it is the reason there is no requester-side read at all
 * (ADR-0018 D6).
 */
export interface ConnectionRequestDeclined extends ConnectionRequestEvent {
  readonly type: typeof CONNECTION_REQUEST_DECLINED;
}

/** Either of the two. */
export type ConnectionRequestEventUnion = ConnectionRequested | ConnectionRequestDeclined;

/**
 * Build the event for a request that has just been written.
 *
 * @param request - The stored row, so `connectionRequestId` is the real aggregate ID rather
 *   than one the caller hoped for, and `occurredAt` is the `created_at` the database
 *   committed.
 */
export function connectionRequested(request: ConnectionRequest): ConnectionRequested {
  return {
    type: CONNECTION_REQUESTED,
    occurredAt: request.createdAt,
    connectionRequestId: request.id,
    ownerId: request.ownerId,
    requesterId: request.requesterId,
    actorId: request.requesterId,
  };
}

/**
 * Build the event for a request the owner has just declined.
 *
 * Only the decline has a builder here, because only the decline has an event of this type:
 * an acceptance announces itself as a `ConnectionAccepted` written by the same transaction.
 *
 * @param request - The row **as updated**, so `occurredAt` is the `decided_at` the database
 *   committed and the status cannot disagree with the type.
 * @throws {Error} when the row is not a declined one. Not an `ApplicationError`: no caller
 *   can produce this, so it is a programming mistake rather than a refusal, and quietly
 *   announcing a decline for an accepted request would be worse than a 500.
 */
export function connectionRequestDeclined(
  request: ConnectionRequest,
): ConnectionRequestDeclined {
  if (request.decidedAt === undefined) {
    throw new Error('connectionRequestDeclined: the request carries no decision');
  }

  if (request.status !== CONNECTION_REQUEST_STATUS.declined) {
    throw new Error(`connectionRequestDeclined: ${request.status} is not a decline`);
  }

  return {
    type: CONNECTION_REQUEST_DECLINED,
    occurredAt: request.decidedAt,
    connectionRequestId: request.id,
    ownerId: request.ownerId,
    requesterId: request.requesterId,
    actorId: request.ownerId,
  };
}
