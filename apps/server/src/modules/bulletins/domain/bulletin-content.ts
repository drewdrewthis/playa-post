/**
 * Longest title a bulletin may carry.
 *
 * ⚠ **Not ADR-pinned.** The PDF and the prototype state an intent ("Title — short and
 * typed beats long and lost") and no number. This bound exists because `text` columns
 * are unbounded and an unbounded write path is an abuse surface, not because the
 * product asked for 120 — revise it when the product states a real limit, and the
 * change is this constant and nothing else (ADR-0013's second open risk).
 */
export const BULLETIN_TITLE_MAX_LENGTH = 120;

/** Longest body a bulletin may carry. See {@link BULLETIN_TITLE_MAX_LENGTH}. */
export const BULLETIN_BODY_MAX_LENGTH = 4000;

/**
 * A title and body that have been through
 * {@link import('./bulletin-content.policy').validateBulletinContent}.
 *
 * Its own module rather than a member of `bulletin-content.policy.ts`, mirroring
 * `connection-trust.ts` beside `connection-trust.policy.ts`: the error class needs the
 * bounds to word its message and the policy needs the error class, so the constants
 * living apart from the policy is what keeps those two from importing each other.
 */
export interface BulletinContent {
  readonly title: string;
  readonly body: string;
}
