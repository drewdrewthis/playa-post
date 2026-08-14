import type { BoardQuery } from './board-query-grammar';

/**
 * One saved Notify Me query.
 *
 * **One per person**, enforced by `app.notify_me_queries`' `unique (owner_id)`. The
 * per-view designations D16 layered on top went with the Saved Views feature (issue
 * #208, ADR-0019), which restored D1's one-query-per-owner shape — the evaluator's
 * read cost is bounded by the key again, so there is no cap constant to count against.
 *
 * Carries the source text *and* the validated AST, per ADR-0007's storage rule: the
 * text round-trips into the input exactly as the person typed it, and the AST is what
 * the hot notification path evaluates so it never re-parses untrusted text on every
 * `BulletinCreated`.
 */
export interface NotifyMeQuery {
  /**
   * `app.notify_me_queries.id` — this query's own identity.
   *
   * Server-internal. It is what an outbox event routes on, and it never reaches a
   * client: `views.notifyMe.update` names no row, because the actor is the address.
   */
  readonly id: string;
  /** `app.users.id`. Whose query this is, and who would be notified. */
  readonly ownerId: string;
  /** Exactly what the person typed, for round-tripping back into the input. */
  readonly sourceText: string;
  /** The validated AST — the same {@link BoardQuery} the board uses. */
  readonly query: BoardQuery;
  /**
   * {@link import('./board-query-grammar').BOARD_QUERY_AST_VERSION} as of the write
   * that stored {@link query}.
   */
  readonly astVersion: number;
  /**
   * ADR-0005 optimistic-concurrency version, bumped on every successful update.
   *
   * `notifyMe.update` is `expectedVersion: yes` (ADR-0005:98) — "last saved query is
   * user-visible state, not a merge candidate", so a mismatch is a conflict and never
   * a silent overwrite.
   */
  readonly version: number;
  readonly updatedAt: Date;
}
