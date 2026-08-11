import { INTRO_NOTE_MAX_LENGTH } from './intro-note';
import { INTRO_DECISION, type IntroDecision } from './intro-request';
import {
  IntroContentInvalidError,
  IntroDeclineCarriesNoNoteError,
} from './intro-request.errors';

/**
 * Accept a submitted intro note, or refuse it.
 *
 * Trimmed first, so leading whitespace can neither disguise an empty note nor consume
 * the length budget — and so the bound is measured against what the target will actually
 * read.
 *
 * ⚠ **An empty note is refused.** The note is the whole of what the via is being asked
 * to judge and the whole of what the target is eventually shown; an intro request with
 * nothing in it is a stranger's name and no reason. Whitespace-only counts as empty for
 * the same reason: the trim happens before the check, not after it.
 *
 * @returns The trimmed note, which is what gets stored — the caller must use this
 *   return value rather than its own input, or the trim is advice instead of a rule.
 * @throws {IntroContentInvalidError} when the note is empty or too long.
 */
export function validateIntroNote(note: string): string {
  const trimmed = note.trim();

  if (trimmed.length === 0 || trimmed.length > INTRO_NOTE_MAX_LENGTH) {
    throw new IntroContentInvalidError();
  }

  return trimmed;
}

/**
 * Accept the **via's own** note against the decision it arrived with, or refuse it
 * (issue #175).
 *
 * ⚠ **Passing an introduction on requires a note of the via's own** — the owner
 * directive behind #175, recorded as decision D11. A pass-on is a vouch rather than a
 * forward: the target reads the requester's reason for asking *and* the via's reason for
 * agreeing, each under its own author's card, so a pass-on with nothing added is a
 * stranger's note arriving with a shrug attached to it.
 *
 * An absent note and an empty one are the same refusal, which is why the missing case
 * falls through {@link validateIntroNote} rather than getting a check of its own: the via
 * gave no reason either way, and one rule with one message beats two that can drift.
 *
 * ⚠ **A decline carries no note at all**, and one supplied with a decline is refused
 * rather than dropped. The requester learns only that it was not passed on — no reason,
 * no re-ask control — so a note here would be text written for a reader who must never
 * be given it, and silently discarding it would let its writer believe it was kept.
 *
 * **This is the one function that branches on the decision**, and it is in the domain for
 * that reason: `decide-intro.service.ts` must stay branch-free, because the *other*
 * difference between the two decisions — the eligibility re-check — lives inside the
 * repository's single gated UPDATE, and half an authorization rule in an application
 * service is worse than none.
 *
 * @returns The trimmed note to store for a pass-on, or `undefined` for a decline — which
 *   the caller must use in place of its own input, or the trim is advice instead of a
 *   rule.
 * @throws {IntroContentInvalidError} when a pass-on carries no note, a whitespace-only
 *   one, or one past {@link INTRO_NOTE_MAX_LENGTH}.
 * @throws {IntroDeclineCarriesNoNoteError} when a decline carries one.
 */
export function validateViaNote(
  decision: IntroDecision,
  note: string | undefined,
): string | undefined {
  if (decision === INTRO_DECISION.decline) {
    if (note !== undefined) {
      throw new IntroDeclineCarriesNoNoteError();
    }

    return undefined;
  }

  return validateIntroNote(note ?? '');
}
