import type { SavedView, SavedViewListing } from '../domain/saved-view';

/**
 * A saved view as this API renders one.
 *
 * `sourceText` round-trips into the board's search field exactly as the person typed it,
 * which is the whole reason ADR-0007 stores the text beside the AST. **The AST itself is
 * not on the wire**: it is an internal representation this module is free to change under
 * a new `ast_version`, and publishing it would make every future grammar change a
 * client-visible break for no benefit.
 *
 * `ownerId` is absent, and not by oversight. Every view a caller can see is their own —
 * the repository's `WHERE owner_id = <actor>` guarantees it — so the field could only
 * ever hold the value the client already knows, while inviting a future client to filter
 * on it as though it might not.
 *
 * `version` is here because the client must send it back as `expectedVersion` on a rename
 * (ADR-0005:102). Timestamps are ISO-8601 strings rather than `Date`s, for
 * `bulletin.presenter.ts`'s reason: that is what a client actually receives.
 */
export interface PresentedSavedView {
  readonly id: string;
  readonly name: string;
  readonly sourceText: string;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** `views.saved.list`'s answer: the views, and which of them have a bell lit. */
export interface PresentedSavedViewListing {
  readonly views: readonly PresentedSavedView[];
  /**
   * Every {@link PresentedSavedView.id} one of the caller's Notify Me queries was
   * designated from. Empty when no card's bell is lit.
   *
   * ⚠ Still served here rather than as a `notify` flag per view, even though D16 now
   * allows several: a boolean on the view row would be a second answer to a question
   * `app.notify_me_queries` already answers, and the two would disagree the first time
   * either was written without the other. That argument never rested on the count.
   */
  readonly notifyingViewIds: readonly string[];
}

/** Project one saved view onto the wire. */
export function presentSavedView(view: SavedView): PresentedSavedView {
  return {
    id: view.id,
    name: view.name,
    sourceText: view.sourceText,
    version: view.version,
    createdAt: view.createdAt.toISOString(),
    updatedAt: view.updatedAt.toISOString(),
  };
}

/** Project the Saved screen's whole answer onto the wire. */
export function presentSavedViewListing(listing: SavedViewListing): PresentedSavedViewListing {
  return {
    views: listing.views.map(presentSavedView),
    notifyingViewIds: listing.notifyingViewIds,
  };
}
