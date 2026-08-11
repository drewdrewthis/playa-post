/**
 * Longest `displayName` the server accepts.
 *
 * Mirrors `modules/identity/transport/display-name.ts`'s `DISPLAY_NAME_MAX_LENGTH`,
 * which is the declaration — a module never imports this package, so the copy is
 * one-directional and deliberate (ADR-0014). It is here so a client can stop a person
 * overrunning the bound before the round trip; the server refuses it either way, and
 * a client that omitted the check would be rude, not unsafe.
 *
 * The same number bounds **both** `identity.completeOnboarding` and
 * `identity.updateDisplayName`, because they take one shared schema server-side: the
 * name you may rename yourself to is exactly the name you could have joined under
 * (decision D15).
 */
export const DISPLAY_NAME_MAX_LENGTH = 80;

/**
 * Structured reasons `identity.completeOnboarding` refuses a handle.
 *
 * The **codes** are the server's (it puts them on the error envelope as
 * `data.applicationCode`); the **copy** is the client's. Enumerated here so a client
 * renders five distinct messages rather than one "something went wrong" — a handle
 * rule the user cannot see is a handle rule the user cannot satisfy.
 */
export const HANDLE_REJECTION_CODES = [
  'HANDLE_RESERVED',
  'HANDLE_TAKEN',
  'HANDLE_CONFUSABLE',
  'HANDLE_CHARSET',
  'HANDLE_LENGTH',
] as const;

/** One of {@link HANDLE_REJECTION_CODES}. */
export type HandleRejectionCode = (typeof HANDLE_REJECTION_CODES)[number];

/** `identity.completeOnboarding` input. */
export interface CompleteOnboardingRequest {
  readonly handle: string;
  readonly displayName: string;
}

/** `identity.completeOnboarding` output — the caller's own row, never anyone else's. */
export interface OnboardedUser {
  readonly userId: string;
  readonly handle: string;
  readonly displayName: string;
}

/**
 * How far away somebody may stand and still see that you exist.
 *
 * ⚠ **This is "who can see you at all", not "who sees your name".** Past your limit you
 * are not an unnamed node on their graph — you are not on their graph. The distinction
 * matters to anyone reading a payload: there is no row to correlate, which is why this
 * setting is meaningful even though ADR-0004 decision 4's ghost surrogate IDs are not
 * built yet.
 *
 * Ordered least-permissive first, which is also the order the You screen's dial cycles
 * through. The scale tops out at `'sixth'` — the six-degrees principle: the most open a
 * person can be is the whole small world, never an unbounded graph walk. The traversal's
 * own operational `max_depth` (ADR-0004 decision 2) remains a separate safety bound.
 *
 * The **trust** half of the prototype's privacy block ("name visible to: anyone /
 * trust 50+ / trust 75+") is deliberately absent: it is a later version's problem, and a
 * half-wired dial in a privacy screen is worse than an absent one.
 */
export const VISIBLE_TO_DISTANCE_OPTIONS = ['first', 'second', 'third', 'sixth'] as const;

/** One of {@link VISIBLE_TO_DISTANCE_OPTIONS}. */
export type VisibleToDistance = (typeof VISIBLE_TO_DISTANCE_OPTIONS)[number];

/** `identity.visibility.get` output, and `identity.visibility.set`'s echo of the stored value. */
export interface VisibilitySetting {
  readonly visibleToDistance: VisibleToDistance;
}

/** `identity.visibility.set` input — the caller's own setting, never anyone else's. */
export interface SetVisibilityRequest {
  readonly visibleToDistance: VisibleToDistance;
}

/**
 * `identity.updateDisplayName` input — the caller's own name, never anyone else's.
 *
 * ⚠ **No handle field, and adding one is an ADR change rather than a contract
 * change.** A handle is chosen once and never changed
 * ([ADR-0008](../../../docs/adr/ADR-0008-identity-model.md) rule 4): re-issuing a
 * retired one lets its next holder inherit shared links and real-world recognition,
 * which is an impersonation vector in a network built on recognition. Decision D15
 * records that issue #177 deliberately did not reopen it.
 */
export interface UpdateDisplayNameRequest {
  readonly displayName: string;
}

/**
 * `identity.updateDisplayName` output — the name the server actually stored.
 *
 * The echo, not the request: trimming happens server-side, so this is the truthful
 * value for a client that caches what it just sent rather than re-reading.
 *
 * ⚠ **The You screen is deliberately not that client.** A display name renders in more
 * places than this response knows about — the profile heading, the graph, board
 * attribution, note author cards — so it invalidates its queries and lets every one of
 * them re-read, and never looks at this field. The echo is here for the caller that has
 * only this answer to go on, not because the shipped client leans on it.
 */
export interface StoredDisplayName {
  readonly displayName: string;
}
