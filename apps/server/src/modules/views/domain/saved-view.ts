import type { BoardQuery } from './board-query-grammar';

/**
 * How long a saved view's name may be, after trimming.
 *
 * The comp seeds a name from the query text truncated to 26 characters, so this is a
 * ceiling on what a *rename* may grow it to rather than a bound anybody hits by
 * accident. 80 is roughly a phone-width line at the card's 19px serif — long enough
 * that no honest name is refused, short enough that a name cannot be used as a place
 * to store a paragraph.
 */
export const SAVED_VIEW_NAME_MAX_LENGTH = 80;

/**
 * How many views one person may keep.
 *
 * ⚠ **A bound, not a product feature.** Nothing in the comp or ADR-0007 asks for a cap;
 * this exists because the Saved screen asks the board for a live match count *per view*,
 * so an unbounded list is an unbounded fan-out one person can create for themselves. 24
 * is far above any plausible real use of a screen that renders every view as a card, and
 * raising it is a one-constant change with no migration — see ADR-0016's decision D3.
 */
export const SAVED_VIEW_LIMIT_PER_OWNER = 24;

/**
 * One person's saved board query, as the Saved screen lists it.
 *
 * Carries the source text *and* the validated AST, per ADR-0007's storage rule: the text
 * round-trips into the board's search field exactly as the person typed it, and the AST
 * is what a future server-side evaluation would read so it never re-parses untrusted text.
 *
 * ⚠ **There is no `notify` field here, and that absence outlived the decision that
 * produced it.** It was D1's — "exactly one Notify Me query per user", so a boolean per
 * view could have drawn a state the database could not hold. **D16 supersedes that half
 * of D1**: a person may now light the bell on several views at once, and the field is
 * still absent, for the reason that never depended on the count. Whether this view is
 * notifying is a fact about `app.notify_me_queries`; a boolean here would be a second
 * answer to the same question, and the two would disagree the first time either was
 * written without the other. The Saved screen's bell state arrives as
 * {@link SavedViewListing.notifyingViewIds} instead.
 */
export interface SavedView {
  readonly id: string;
  /** `app.users.id`. Always the acting actor — see {@link SavedView}'s repository port. */
  readonly ownerId: string;
  /** What the person calls it, trimmed. Never empty. */
  readonly name: string;
  /** Exactly what the person typed, for round-tripping back into the board. */
  readonly sourceText: string;
  /** The validated AST — the same {@link BoardQuery} the board and Notify Me use. */
  readonly query: BoardQuery;
  /**
   * {@link import('./board-query-grammar').BOARD_QUERY_AST_VERSION} as of the write that
   * stored {@link query}.
   */
  readonly astVersion: number;
  /**
   * ADR-0005 optimistic-concurrency version, bumped on every successful rename.
   *
   * `view.save` is `expectedVersion: yes` (ADR-0005:102) — a view's name is user-visible
   * state, not a merge candidate, so a mismatch is a conflict and never a silent
   * overwrite of somebody's deliberate rename.
   */
  readonly version: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/**
 * Everything the Saved screen needs in one answer: the views, and which are notifying.
 *
 * **One read, not two**, because the two facts have to agree. Serving the list and the
 * designations through separate procedures would let a client render a bell against a
 * view a concurrent `setNotify` had already cleared — a lie about somebody's notification
 * settings, which is the one thing on this screen worth being careful with.
 */
export interface SavedViewListing {
  readonly views: readonly SavedView[];
  /**
   * Every {@link SavedView.id} one of the caller's Notify Me queries was designated from.
   *
   * Empty covers both "no Notify Me query at all" and "only a query written directly
   * through `views.notifyMe.update`, belonging to no view" — indistinguishable to this
   * screen, because in both cases no card's bell is lit.
   *
   * ⚠ **A set, and its order carries no meaning.** It is ordered only so that two reads
   * of unchanged state serialize identically; nothing renders it as a sequence.
   */
  readonly notifyingViewIds: readonly string[];
}
