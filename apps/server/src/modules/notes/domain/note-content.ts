/**
 * Longest note a person may pin.
 *
 * ⚠ **Deliberately the same number as
 * {@link import('../../bulletins/domain/bulletin-content').BULLETIN_BODY_MAX_LENGTH},
 * and deliberately not that constant.** A note and a bulletin body are both "as much
 * prose as this product asks anyone to read", so they start at the same bound — but
 * importing it would be `modules/notes` depending on `modules/bulletins`' domain, which
 * addendum §19 forbids and which would make one product's limit silently move the
 * other's. Restated here so the two can diverge the day either has a reason to.
 *
 * ⚠ **Not ADR-pinned**, for the reason that constant gives: the bound exists because
 * `text` columns are unbounded and an unbounded write path is an abuse surface, not
 * because the product asked for 4000.
 *
 * Its own module rather than a member of `note-content.policy.ts`, mirroring
 * `connections/domain/connection-trust.ts` beside `connection-trust.policy.ts`:
 * {@link import('./note.errors').NoteContentInvalidError} needs the bound to word its
 * message and the policy needs the error class, so the constant living apart from the
 * policy is what keeps those two from importing each other.
 */
export const NOTE_BODY_MAX_LENGTH = 4000;
