import { NOTE_BODY_MAX_LENGTH } from './note-content';
import { NoteContentInvalidError } from './note.errors';

/**
 * Accept a submitted note body, or refuse it.
 *
 * Trimmed first, so leading whitespace can neither disguise an empty note nor consume
 * the length budget — and so the bound is measured against what the recipient will
 * actually read.
 *
 * ⚠ **An empty body is refused**, unlike a bulletin's. A bulletin's title carries it
 * when the body is blank; a note has no title, so whitespace is the whole of the note.
 * Whitespace-only counts as empty for the same reason: the trim happens before the
 * check, not after it.
 *
 * @returns The trimmed body, which is what gets stored — the caller must use this
 *   return value rather than its own input, or the trim is advice instead of a rule.
 * @throws {NoteContentInvalidError} when the body is empty or too long.
 */
export function validateNoteBody(body: string): string {
  const trimmed = body.trim();

  if (trimmed.length === 0 || trimmed.length > NOTE_BODY_MAX_LENGTH) {
    throw new NoteContentInvalidError();
  }

  return trimmed;
}
