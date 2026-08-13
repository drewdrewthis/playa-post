import type { ConnectionRequest, ConnectionRequestDecision } from './connection-request';

/** What sending a request is given. */
export interface NewConnectionRequest {
  /** The requester, taken from the resolved `Actor` and never from request input. */
  readonly requesterId: string;
  /** The slug they opened. The only thing they supply, and a claim the database authorizes. */
  readonly slug: string;
  readonly createdAt: Date;
  /**
   * The `created_at` floor a pending request must be after to count toward the cap, from
   * {@link import('./connection-request.policy').liveRequestFloor}.
   *
   * Passed in rather than computed in SQL so the TTL has one home and a test can move the
   * boundary without moving the clock.
   */
  readonly liveSince: Date;
  /** The rate window's floor, from {@link import('./connection-request.policy').rateWindowFloor}. */
  readonly rateWindowSince: Date;
}

/** What deciding a request is given. */
export interface ConnectionRequestDecisionWrite {
  readonly connectionRequestId: string;
  /**
   * The owner, taken from the resolved `Actor`.
   *
   * ⚠ It is a *predicate* on the update, not a field written to the row: the statement's
   * `where owner_id = <actor>` is what makes "only the owner may decide" true, and there is
   * no path here that writes an actor anywhere.
   */
  readonly actorId: string;
  readonly decision: ConnectionRequestDecision;
  readonly decidedAt: Date;
  /** The TTL floor, so a lapsed request is refused by the same statement that decides one. */
  readonly liveSince: Date;
}

/**
 * The connection requests port — the **write** one.
 *
 * Declared here in `domain/` and implemented in `persistence/` (addendum §2). The owner's
 * inbox is a viewer-scoped projection and lives behind
 * {@link import('../application/visible-connection-requests.repository').VisibleConnectionRequestsRepository}
 * instead.
 */
export interface ConnectionRequestRepository {
  /**
   * Write a request and its `ConnectionRequested` event, **atomically**, and only if the
   * slug resolves to a live link belonging to somebody else who is not already connected to
   * the caller and whose inbox has room.
   *
   * ⚠ **Every one of those conditions is part of the statement, not a prior read.** The
   * insert is a single `INSERT … SELECT … WHERE …`, so a refusal inserts **zero rows** and
   * there is no window in which the link could rotate, the pair could connect, or the cap
   * could fill between a check and a write. Ordering the checks differently cannot change
   * the answer, because there is no ordering to change.
   *
   * ⚠ **The one-open-request-per-pair rule is enforced by the same statement**, through
   * `on conflict … do update … where` on the partial unique index. That is why a duplicate
   * comes back as the ordinary refusal instead of a unique violation escaping as a 500 — and
   * why two concurrent taps leave exactly one row, with the loser blocked on the index
   * rather than racing a read.
   *
   * ⚠ **A row that has already lapsed is refreshed rather than refused**, and the asymmetry
   * is what keeps the TTL from becoming a permanent block. The partial index cannot tell a
   * lapsed pending row from a live one — an index predicate has to be immutable, so it
   * cannot read a clock — so without this the pair could never ask again after fourteen
   * days, which is the opposite of what an expiry is for.
   *
   * One transaction covering two writes, because a request the owner was never told about
   * and a notification about a request that does not exist are both worse than neither
   * (addendum §10, ADR-0006).
   *
   * @throws {import('./personal-link.errors').PersonalLinkUnavailableError} when the
   *   statement wrote no row — the same answer for "no such slug", "rotated", "that is your
   *   own link", "you are already connected", "you already asked", "their inbox is full",
   *   and "this link is being hammered".
   */
  send(write: NewConnectionRequest): Promise<ConnectionRequest>;

  /**
   * Decide a pending request as its named owner, writing the connection when they accept,
   * **atomically**.
   *
   * ⚠ **`where owner_id = <actor> and status = 'pending' and created_at > liveSince` is the
   * whole authorization, and all three clauses matter.** The first makes "only the owner may
   * decide" true — the requester and a stranger each match zero rows, exactly as an id
   * naming nothing does. The second is the terminal-once rule and the concurrency control:
   * two simultaneous decisions block on the row, and the loser re-evaluates against the
   * committed status, matches nothing, and is refused. The third is the TTL, enforced where
   * it cannot be skipped rather than in a check the update could race.
   *
   * ⚠ **Accepting writes `app.connections` in this same transaction, unlike an accepted
   * introduction** (ADR-0018 D7). `modules/intros` routes through an `IntroAccepted` event
   * because `app.connections` belongs to *another* module and a synchronous cross-module
   * write is the reach-in addendum §19 forbids. Here there is no boundary to cross: this
   * module owns both tables, so the strictly better answer is one transaction — the owner
   * gets a connection that exists by the time the mutation returns, instead of one that
   * will exist after the next drainer round.
   *
   * ⚠ **Eligibility is deliberately not re-checked**, and there is nothing to re-check: the
   * owner is answering a request addressed to them, and rotating their link between the ask
   * and the answer changes nothing about that. Rotation retires an *address*, never the
   * requests it already produced (issue #206).
   *
   * @throws {import('./connection-request.errors').ConnectionRequestUnavailableError} when
   *   the statement updated no row — "no such request", "not yours", "already decided" and
   *   "lapsed" are one answer.
   */
  decide(write: ConnectionRequestDecisionWrite): Promise<ConnectionRequest>;
}
