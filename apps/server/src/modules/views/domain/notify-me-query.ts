import type { BoardQuery } from './board-query-grammar';

/**
 * One person's saved Notify Me query — at most one per user (D1).
 *
 * "At most one" is a **primary key on `owner_id`** (ADR-0007:79), not a check a
 * service performs first, which is why nothing in this module counts rows before
 * writing.
 *
 * Carries the source text *and* the validated AST, per ADR-0007's storage rule: the
 * text round-trips into the input exactly as the person typed it, and the AST is what
 * the hot notification path evaluates so it never re-parses untrusted text on every
 * `BulletinCreated`.
 */
export interface NotifyMeQuery {
  /** `app.users.id`. The primary key, and the only row this owner can ever write. */
  readonly ownerId: string;
  /** Exactly what the person typed, for round-tripping back into the input. */
  readonly sourceText: string;
  /** The validated AST — the same {@link BoardQuery} the board and saved views use. */
  readonly query: BoardQuery;
  /**
   * {@link import('./board-query-grammar').BOARD_QUERY_AST_VERSION} as of the write
   * that stored {@link query}.
   */
  readonly astVersion: number;
  /**
   * The `app.saved_views` row this query was designated from, or `null` when it was
   * written directly through `views.notifyMe.update`.
   *
   * D1: exactly one Notify Me query per user, so lighting the bell on a second view
   * **moves** the designation rather than adding one — which is this aggregate's primary
   * key doing the enforcing (ADR-0016). A `null` here is not "no view yet"; it is a
   * query that belongs to no view and therefore appears on no card's bell.
   */
  readonly sourceViewId: string | null;
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
