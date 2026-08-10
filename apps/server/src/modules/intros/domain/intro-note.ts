/**
 * Longest note an intro request may carry.
 *
 * ⚠ **Deliberately the same number as
 * {@link import('../../notes/domain/note-content').NOTE_BODY_MAX_LENGTH}, and
 * deliberately not that constant.** The owner's framing for this feature is "a special
 * type of pinning a note" — the same textarea, the same bound — but importing it would
 * be `modules/intros` depending on `modules/notes`' domain, which addendum §19 forbids
 * and which would make one product's limit silently move the other's. Restated here so
 * the two can diverge the day either has a reason to.
 *
 * ⚠ **Not ADR-pinned**, for the reason both of its siblings give: the bound exists
 * because `text` columns are unbounded and an unbounded write path is an abuse surface,
 * not because the product asked for 4000.
 *
 * Its own module rather than a member of `intro-note.policy.ts`, mirroring
 * `notes/domain/note-content.ts`: {@link
 * import('./intro-request.errors').IntroContentInvalidError} needs the bound to word its
 * message and the policy needs the error class, so the constant living apart from the
 * policy is what keeps those two from importing each other.
 */
export const INTRO_NOTE_MAX_LENGTH = 4000;
