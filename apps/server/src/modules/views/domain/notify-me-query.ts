import type { BoardQuery } from './board-query-grammar';

/**
 * How many saved views one person may have a Notify Me bell lit on at once.
 *
 * ⚠ **It counts the *designated* queries only.** The untied query
 * `views.notifyMe.update` writes is not one of these and is not counted: it is held at one
 * per person by `UNIQUE NULLS NOT DISTINCT (owner_id, source_view_id)`, so a count would
 * bound nothing the key does not — while spending a bell slot on a query that is on no
 * card, and making the refusal's "switch one off" point at cards that could not free it.
 * A person's worst case is therefore **six bells plus one untied query, seven rows.**
 *
 * ⚠ **This number is decision D16's whole cost argument, and it is deliberately not
 * {@link import('./saved-view').SAVED_VIEW_LIMIT_PER_OWNER}.** D1 bounded the evaluator's
 * read cost at one query per person by making that a primary key; reopening D1 gives that
 * bound up, so something has to replace it. `EvaluateNotifyMeHandler` runs one authorized
 * read per saved query on **every** `BulletinCreated`, and it stops at a person's first
 * match — so a person whose bulletins match pays for one read and a person whose bulletins
 * match nothing pays for all of theirs, which is the common case and therefore the one to
 * bound. Seven rows rather than six is the same bound: a small constant, not a growth
 * curve.
 *
 * Six rather than 24 because the two caps have different payers. The saved-view cap bounds
 * a *per-render* fan-out somebody creates on a screen they chose to open and pays for
 * themselves (ADR-0016 D3); this one bounds work that every other person's bulletin
 * creation performs in the background on their behalf. Letting the display cap double as
 * the background cap would set a number chosen for one cost against a cost it was never
 * weighed against. Six is above any plausible curated set of alerts and holds the
 * worst-case fan-out to a small constant multiple of what D1 allowed.
 *
 * A **soft** bound, like the saved-view cap: counted inside the write's transaction but
 * not locked, so two taps racing each other can land one extra row. That is the right
 * trade for a bound whose purpose is to stop a list growing without limit rather than to
 * be a constraint anything depends on. Raising it is a one-constant change with no
 * migration — the schema enforces *uniqueness* per (owner, view), never a count.
 */
export const NOTIFY_ME_QUERY_LIMIT_PER_OWNER = 6;

/**
 * One saved Notify Me query.
 *
 * ⚠ **A person may have several, and that is decision D16 reopening D1.** What the
 * database enforces is no longer "one per user" but **one per (owner, saved view), plus
 * one untied query per owner** — `notify_me_queries_owner_id_source_view_id_key`, a
 * `UNIQUE NULLS NOT DISTINCT` so the untied row's `NULL` is a key value rather than an
 * exemption. Nothing in this module counts rows to keep bells from colliding; it counts
 * them only for {@link NOTIFY_ME_QUERY_LIMIT_PER_OWNER}, which is a different question.
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
   * Server-internal. It is what an outbox event routes on (D16: the aggregate is the
   * query, because a person may hold several and an event naming only the owner could not
   * say which one changed), and it never reaches a client: the API names a designation by
   * the saved view its bell sits on.
   */
  readonly id: string;
  /** `app.users.id`. Whose query this is, and who would be notified. */
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
   * ⚠ **This is what tells one person's queries apart**, and after D16 it is half the
   * key rather than a decoration on a singleton row. Lighting the bell on a second view
   * now *adds* a query instead of moving the one there was; lighting a bell that is
   * already lit still upserts onto the same row, because `(owner_id, source_view_id)` is
   * unique. A `null` here is not "no view yet": it is the one query per owner that
   * belongs to no view, appears on no card's bell, and is the only row
   * `views.notifyMe.update` can address.
   */
  readonly sourceViewId: string | null;
  /**
   * ADR-0005 optimistic-concurrency version, bumped on every successful update.
   *
   * Per query rather than per person (D16): each row carries its own, so a stale
   * `expectedVersion` for the untied query cannot refuse a write to a designated one.
   * `notifyMe.update` is `expectedVersion: yes` (ADR-0005:98) — "last saved query is
   * user-visible state, not a merge candidate", so a mismatch is a conflict and never
   * a silent overwrite.
   */
  readonly version: number;
  readonly updatedAt: Date;
}
