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
 * Longest location line a bulletin may carry.
 *
 * The prototype's `loc` is a one-line landmark — "7:30 & E", "departing Reno, Aug 24" —
 * rendered inline on a card beside the author's name, so it is bounded like a title
 * rather than like a body. Not ADR-pinned, same as {@link BULLETIN_TITLE_MAX_LENGTH}:
 * the bound exists because `text` is unbounded and an unbounded write path is an abuse
 * surface.
 */
export const BULLETIN_LOC_MAX_LENGTH = 120;

/**
 * What a caller submits as a bulletin's content, before the policy has looked at it.
 *
 * Distinct from {@link BulletinContent} because the two differ in exactly the way the
 * policy is for: `loc` arrives optional and untrimmed, and leaves as a trimmed value or
 * an explicit `null`. A single type would make "not yet checked" and "checked" the same
 * shape, and the compiler could then no longer tell a caller that it stored its own
 * input instead of the policy's return value.
 */
export interface SubmittedBulletinContent {
  readonly title: string;
  readonly body: string;
  readonly loc?: string | undefined;
}

/**
 * A title, body and location that have been through
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
  /**
   * `null` when the bulletin names no place.
   *
   * Nullable rather than optional, unlike the author-card identity fields: an absent
   * name is a **privacy** projection a client must not be able to fill in, whereas an
   * absent location is an ordinary value a client renders as no location line. Nullable
   * is also what `archived_at` established for a field whose absence is a state.
   */
  readonly loc: string | null;
}
