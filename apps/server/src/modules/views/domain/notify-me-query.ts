import type { BoardQuery } from './board-query-grammar';

/**
 * The shape version of the stored AST — ADR-0007:70-72's `ast_version`.
 *
 * It versions the **AST's shape**, never the row. A grammar change ships as a new
 * value here plus a migration that re-validates or re-parses stored queries; until
 * that migration runs, a query saved under an older version is simply not evaluated
 * by this grammar. That is the point: silently reinterpreting somebody's saved query
 * notifies them about the wrong things while they are not there to notice.
 *
 * ⚠ Bump this and you owe the migration. Leaving it unchanged after a grammar change
 * is the silent reinterpretation the column exists to prevent.
 */
export const NOTIFY_ME_AST_VERSION = 1;

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
  /** {@link NOTIFY_ME_AST_VERSION} as of the write that stored {@link query}. */
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
