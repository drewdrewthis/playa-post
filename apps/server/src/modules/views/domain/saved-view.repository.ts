import type { BoardQuery } from './board-query-grammar';
import type { SavedView, SavedViewListing } from './saved-view';

/**
 * What saving a new view is given.
 *
 * ⚠ **There is no target-owner field, and that absence is the authorization design.**
 * `ownerId` is the *actor*, taken from the `Actor` resolved at the tRPC context boundary
 * and never from request input (ADR-0002:180-181, B14), and every statement behind this
 * port is scoped `WHERE owner_id = ownerId` unconditionally. The same statement
 * {@link import('./notify-me-query.repository').SaveNotifyMeQuery} makes, and it is what
 * makes M5-AC16 ("user B cannot read, update, or delete user A's view by ID") hold by
 * construction rather than by a check somebody has to remember to write first.
 */
export interface SaveSavedView {
  /** The actor, who is also the owner. See this interface's own warning. */
  readonly ownerId: string;
  readonly name: string;
  readonly sourceText: string;
  readonly query: BoardQuery;
  readonly astVersion: number;
  readonly createdAt: Date;
}

/** What renaming a view is given. `viewId` is scoped to `ownerId`; see {@link SaveSavedView}. */
export interface RenameSavedView {
  readonly ownerId: string;
  readonly viewId: string;
  readonly name: string;
  /**
   * ADR-0005:102 — `view.save` is `expectedVersion: yes`, so a mismatch is a conflict.
   *
   * Required rather than optional, unlike Notify Me's: a rename always edits a row the
   * caller has already read (it came from `list`, which carries the version), so there
   * is no first-write case where the caller could not know it.
   */
  readonly expectedVersion: number;
  readonly renamedAt: Date;
}

/** What deleting a view is given. */
export interface DeleteSavedView {
  readonly ownerId: string;
  readonly viewId: string;
  /**
   * When it happened — carried in, not read from the clock inside the transaction.
   *
   * Deleting the designated Notify Me view emits a `NotifyMeQueryCleared`, and that
   * event's `occurredAt` is the one thing a caller has to be able to pin in a test.
   */
  readonly deletedAt: Date;
}

/** What lighting or clearing the bell on a view is given. */
export interface SetSavedViewNotify {
  readonly ownerId: string;
  readonly viewId: string;
  /** `true` moves the Notify Me designation onto this view; `false` clears it (D1). */
  readonly notify: boolean;
  readonly changedAt: Date;
}

/**
 * The saved-views port.
 *
 * Declared here in `domain/` and implemented in `persistence/` (addendum §2).
 *
 * ⚠ **Four of these five operations may touch `app.notify_me_queries` as well as
 * `app.saved_views`, and that is not a layering slip.** Both tables belong to this
 * module, and a designation is a fact *spanning* them: which view the bell is lit on
 * (`saved_views.id`) and what is actually being notified on (`notify_me_queries`) are one
 * transactional truth, exactly as a state change and its outbox row are (addendum §10,
 * ADR-0006). A port per table would make that atomicity a convention two services have to
 * remember rather than a guarantee the database enforces — and D1's "exactly one Notify
 * Me query per user" would stop being a primary key.
 */
export interface SavedViewRepository {
  /**
   * This owner's views, oldest first, and which of them the bell is lit on.
   *
   * One read rather than two, so the list and the designation cannot disagree — see
   * {@link SavedViewListing}.
   */
  listFor(ownerId: string): Promise<SavedViewListing>;

  /**
   * Store a new view for the acting owner.
   *
   * @throws {import('./saved-view.errors').SavedViewLimitReachedError} when the owner
   *   already keeps {@link import('./saved-view').SAVED_VIEW_LIMIT_PER_OWNER} of them.
   *   ⚠ A **soft** bound: the count and the insert share a transaction but not a lock, so
   *   two saves racing each other can both see 23 and land a 25th row. That is the right
   *   trade — the cap exists to stop an unbounded list, not to be a constraint anything
   *   depends on, and the alternatives (an advisory lock per owner, or a check
   *   constraint) buy exactness in a scenario one person double-tapping is the only way
   *   to reach.
   */
  save(write: SaveSavedView): Promise<SavedView>;

  /**
   * Rename one of the acting owner's own views.
   *
   * @throws {import('./saved-view.errors').SavedViewConflictError} when nothing matched
   *   `(owner_id, id, version)` — deliberately incurious about which of the three it was.
   *   Distinguishing "wrong version" from "not your view" would answer, for an actor who
   *   owns nothing, whether *somebody else's* view carries the version they guessed.
   */
  rename(write: RenameSavedView): Promise<SavedView>;

  /**
   * Remove one of the acting owner's own views.
   *
   * ⚠ **Clears the Notify Me query first when this view is the one it was designated
   * from**, inside the same transaction. Leaving it would keep pushing notifications for
   * a query whose only off-switch — the bell on this card — has just been deleted.
   *
   * Idempotent, and **the one operation here that does not raise
   * {@link import('./saved-view.errors').SavedViewUnavailableError} for an id that is not
   * this owner's**: a delete asks for a *state*, and that state holds whether the view
   * was already gone or was never theirs. Answering identically to both is also the
   * strongest anti-oracle position available to a destructive operation — the two cases
   * are indistinguishable from the outside. `rename` and `setNotify` refuse instead,
   * because a client that could not apply its change has to be told; they are equally
   * non-oracular, because an invented id and somebody else's get the same refusal.
   *
   * It resolves `false` so a caller can tell "removed now" from "was already absent"
   * without a second read.
   *
   * @returns `true` when a row was removed.
   */
  delete(write: DeleteSavedView): Promise<boolean>;

  /**
   * Move the Notify Me designation onto this view, or clear it.
   *
   * `notify: true` **replaces** whatever the owner's single Notify Me query was — D1's
   * "toggling a bell on view B moves Notify Me from view A, it does not create a second
   * notifying query", which is `app.notify_me_queries`' primary key on `owner_id` rather
   * than an application rule.
   *
   * `notify: false` removes the query only when it is *this* view's; a stale client
   * clearing a bell that has already moved must not switch off the notifications the
   * owner just turned on somewhere else.
   *
   * No `expectedVersion`: the bell is a designation rather than a document, there is
   * nothing to merge, and the last tap winning is what a toggle means.
   *
   * @returns The view the bell is now lit on, or `null` when it is lit on none.
   * @throws {import('./saved-view.errors').SavedViewUnavailableError} when the view is
   *   not one of this owner's — the same answer an invented ID gets (M5-AC16).
   */
  setNotify(write: SetSavedViewNotify): Promise<string | null>;
}
