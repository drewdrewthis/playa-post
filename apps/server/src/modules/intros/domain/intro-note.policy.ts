import { INTRO_NOTE_MAX_LENGTH } from './intro-note';
import { IntroContentInvalidError } from './intro-request.errors';

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
