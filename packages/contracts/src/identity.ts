/** Longest `displayName` the server accepts. Mirrors `DISPLAY_NAME_MAX_LENGTH`. */
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
