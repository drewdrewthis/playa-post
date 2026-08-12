/**
 * `views.notifyMe.update` input.
 *
 * `expectedVersion` absent means "create or overwrite"; present means "only if the
 * saved query is still at this version". A mismatch is a `conflict`, never a
 * last-write-wins overwrite — the last saved query is user-visible state, not a merge
 * candidate (ADR-0005's conflict matrix).
 */
export interface UpdateNotifyMeQueryRequest {
  readonly sourceText: string;
  /**
   * `?: number | undefined`, not `?: number`. The server's schema marks it
   * `.optional()`, which accepts an explicitly-`undefined` value as well as an omitted
   * key; under `exactOptionalPropertyTypes` the narrower form would refuse a call the
   * server would have served.
   */
  readonly expectedVersion?: number | undefined;
}

/** `views.notifyMe.update` output — the saved query, as stored. */
export interface NotifyMeQuery {
  readonly sourceText: string;
  readonly version: number;
  readonly updatedAt: string;
}

/**
 * One saved board query, as `views.saved.list` and the write procedures render it.
 *
 * `sourceText` round-trips into the board's search field exactly as the person typed it.
 * The parsed AST is **not** on the wire: it is a server-internal representation versioned
 * by `ast_version`, and publishing it would make every future grammar change a
 * client-visible break for no benefit — the client already has the text.
 *
 * There is no `ownerId`: every view a caller can see is their own, so the field could
 * only ever hold the value the client already knows.
 */
export interface SavedView {
  readonly id: string;
  readonly name: string;
  readonly sourceText: string;
  /** Send this back as {@link RenameSavedViewRequest.expectedVersion} on the next rename. */
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/**
 * `views.saved.list` output.
 *
 * ⚠ **The lit bells are a set of ids, not a flag per view.** Decision D16 (which
 * supersedes D1's single-query rule) lets a person notify on several views at once, and
 * this is still not a `notify: boolean` on {@link SavedView}: whether a view is notifying
 * is a fact about `app.notify_me_queries`, and a boolean on the view would be a second
 * answer to the same question that could disagree with the first. An empty array means no
 * card's bell is lit — which still covers a query saved directly through
 * `views.notifyMe.update`, because that one belongs to no view and appears on no card.
 *
 * ⚠ **No match counts.** The "N match now" line on a card is `bulletins.board({ query })`
 * called per view, so the number is provably the one the board shows when the same card
 * is opened — including its page-size ceiling.
 */
export interface SavedViewListing {
  readonly views: readonly SavedView[];
  readonly notifyingViewIds: readonly string[];
}

/** `views.saved.save` input — the board query you are looking at, under a name. */
export interface SaveViewRequest {
  readonly name: string;
  readonly sourceText: string;
}

/** Input of every procedure that names one saved view. */
export interface SavedViewIdRequest {
  readonly viewId: string;
}

/**
 * `views.saved.rename` input.
 *
 * `expectedVersion` is **required**, unlike {@link UpdateNotifyMeQueryRequest}'s: a
 * rename always edits a view the caller read from `views.saved.list`, which carries the
 * version. A mismatch is a `conflict` — a view's name is user-visible state, not a merge
 * candidate (ADR-0005's conflict matrix).
 *
 * Only the name changes. Re-pointing an existing card at different results under the same
 * name is the one edit that would make a saved view untrustworthy; save a new one instead.
 */
export interface RenameSavedViewRequest {
  readonly viewId: string;
  readonly name: string;
  readonly expectedVersion: number;
}

/**
 * `views.saved.delete` output.
 *
 * `deleted: false` means the view was already gone **or was never yours** — the two are
 * deliberately indistinguishable, because telling them apart would let an actor learn
 * which view ids are real. Either way the request succeeded and the state the caller
 * asked for holds.
 */
export interface SavedViewDeletion {
  readonly viewId: string;
  readonly deleted: boolean;
}

/**
 * `views.saved.setNotify` input.
 *
 * `notify` is the desired state rather than a toggle, so two taps racing on a slow
 * connection cannot land in an order nobody chose.
 */
export interface SetSavedViewNotifyRequest {
  readonly viewId: string;
  readonly notify: boolean;
}

/**
 * `views.saved.setNotify` output — every view the caller's bells are now lit on.
 *
 * ⚠ **The whole set, not the view that was just toggled.** Under D16 a toggle changes one
 * membership in a set the client renders as a screenful of bells, and a client that was
 * told only about its own request would have to reconstruct the rest from what it
 * believed a moment ago — which is wrong the instant another device changed one. The same
 * answer `views.saved.list` gives, so the two surfaces cannot disagree.
 */
export interface NotifyMeDesignation {
  readonly notifyingViewIds: readonly string[];
}
