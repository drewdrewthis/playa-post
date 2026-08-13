/**
 * The three states a connection request can be in (issue #206).
 *
 * ```
 * pending ──accept───▶ accepted  (terminal, and writes the connection)
 *    └─────decline───▶ declined  (terminal, and invisible to the requester)
 * ```
 *
 * A `text` column with a CHECK rather than an enum, matching
 * {@link import('./connection').CONNECTION_STATUS} and `app.intro_requests.status`:
 * adding a state is a migration rather than a type rewrite.
 *
 * ⚠ **There is no `expired` state and there must never be one.** A request older than
 * {@link import('./connection-request.policy').CONNECTION_REQUEST_TTL_DAYS} is gone as far
 * as every read and the gated update are concerned, and it is gone by arithmetic on
 * `created_at` rather than by a status somebody has to write (ADR-0018 D5). A stored state
 * needs a cron to maintain it and is wrong for exactly as long as that cron is behind —
 * and "wrong" here means an owner deciding a request the rules say has lapsed.
 *
 * Exported so a consumer branching on status compares against this rather than
 * re-spelling the literal.
 */
export const CONNECTION_REQUEST_STATUS = {
  /** Waiting on the owner. The only state their inbox shows and the only one decidable. */
  pending: 'pending',
  /**
   * The owner accepted.
   *
   * ⚠ **This is the state that makes a connection**, and unlike an accepted introduction
   * the edge is written by the *same transaction* rather than from a published event
   * (ADR-0018 D7). `app.connections` belongs to this module, so there is no cross-module
   * write to route around: the event seam decision D12 made for `modules/intros` was
   * about crossing a module boundary, and this crosses none.
   */
  accepted: 'accepted',
  /**
   * The owner declined.
   *
   * ⚠ **Invisible to the requester forever**, and indistinguishable from a request nobody
   * has answered. That is ADR-0017's founding invariant one relationship along: somebody
   * who can be *seen* refusing cannot safely refuse, and there is no read on this API
   * through which a requester could tell the two apart — because there is no
   * requester-side read at all (ADR-0018 D6).
   */
  declined: 'declined',
} as const;

/** One of {@link CONNECTION_REQUEST_STATUS}'s values. */
export type ConnectionRequestStatus =
  (typeof CONNECTION_REQUEST_STATUS)[keyof typeof CONNECTION_REQUEST_STATUS];

/**
 * What the owner may do with a request, and the only two things they may do.
 *
 * Separate from {@link CONNECTION_REQUEST_STATUS} because a decision is an *input* and a
 * status is stored state: `pending` is not a decision anybody can make, and modelling
 * them as one type would let a caller ask to un-decide.
 */
export const CONNECTION_REQUEST_DECISION = {
  accept: 'accept',
  decline: 'decline',
} as const;

/** One of {@link CONNECTION_REQUEST_DECISION}'s values. */
export type ConnectionRequestDecision =
  (typeof CONNECTION_REQUEST_DECISION)[keyof typeof CONNECTION_REQUEST_DECISION];

/** The stored status a decision produces. Total over {@link ConnectionRequestDecision}. */
export const STATUS_FOR_CONNECTION_REQUEST_DECISION: Readonly<
  Record<ConnectionRequestDecision, ConnectionRequestStatus>
> = {
  [CONNECTION_REQUEST_DECISION.accept]: CONNECTION_REQUEST_STATUS.accepted,
  [CONNECTION_REQUEST_DECISION.decline]: CONNECTION_REQUEST_STATUS.declined,
};

/**
 * A connection request as `app.connection_requests` stores one.
 *
 * This is the entity, not a read model. It carries both parties' raw identifiers because
 * the only paths that reconstruct it are the two writes — sending and deciding — where the
 * actor is one of the parties. **Nothing projected to a client is built from this**; the
 * owner's inbox answers with `application/`'s read model, projected through
 * `app.visible_people` and therefore through ADR-0002 §6a.
 *
 * ⚠ **Two parties and no content.** A request carries no note, unlike an intro request,
 * and that is a decision rather than an omission (ADR-0018 D4): the owner published the
 * link, so the ask is "somebody who has your link would like to connect" and nothing else.
 * A free-text field on an unsolicited message from a stranger is an abuse channel with a
 * moderation queue attached, and the link is already the introduction.
 *
 * There is deliberately no `version`. Deciding is a gated UPDATE whose
 * `where status = 'pending'` *is* the concurrency control, so a version column would be
 * one nothing reads.
 */
export interface ConnectionRequest {
  readonly id: string;
  /** Whose link was opened. Only they may decide this row. */
  readonly ownerId: string;
  /** Who asked. Taken from the resolved `Actor`, never from request input. */
  readonly requesterId: string;
  readonly status: ConnectionRequestStatus;
  readonly createdAt: Date;
  /**
   * When the owner decided, or `undefined` while the request is still open.
   *
   * Absent rather than `null`: `(status = 'pending') = (decided_at is null)` is a database
   * CHECK, so the two can never disagree, and an omitted key is what
   * `exactOptionalPropertyTypes` lets the compiler keep honest.
   */
  readonly decidedAt?: Date;
}
