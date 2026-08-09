import { describe, expect, it } from 'vitest';

import { NOTE_BODY_MAX_LENGTH } from '../../domain/note-content';
import { validateNoteBody } from '../../domain/note-content.policy';
import { NoteContentInvalidError } from '../../domain/note.errors';

/**
 * `specs/features/pin-a-note.feature` › "The note body is trimmed, bounded, and never
 * empty" (`@unit`, issue #88).
 *
 * The one rule worth stating twice: a note's body may **not** be empty, where a
 * bulletin's may. A bulletin has a title to carry it; a note has nothing else, so an
 * empty note is a row addressed to somebody who will be told they have mail.
 */
describe('validateNoteBody', () => {
  it('returns the trimmed value, which is what the caller must store', () => {
    expect(validateNoteBody('  Bring the good coffee.  ')).toBe('Bring the good coffee.');
  });

  it('refuses an empty body — unlike a bulletin, a note is only its body', () => {
    expect(() => validateNoteBody('')).toThrow(NoteContentInvalidError);
  });

  it('trims first, so whitespace cannot disguise an empty note', () => {
    expect(() => validateNoteBody('   \n\t ')).toThrow(NoteContentInvalidError);
  });

  it(`accepts one of exactly ${String(NOTE_BODY_MAX_LENGTH)} characters`, () => {
    const atBound = 'x'.repeat(NOTE_BODY_MAX_LENGTH);

    expect(validateNoteBody(atBound)).toBe(atBound);
  });

  it('refuses one longer than the bound', () => {
    expect(() => validateNoteBody('x'.repeat(NOTE_BODY_MAX_LENGTH + 1))).toThrow(
      NoteContentInvalidError,
    );
  });

  it('measures the bound after trimming, so surrounding whitespace is not charged for it', () => {
    const padded = `  ${'x'.repeat(NOTE_BODY_MAX_LENGTH)}  `;

    expect(validateNoteBody(padded)).toHaveLength(NOTE_BODY_MAX_LENGTH);
  });

  it('refuses with the stable NOTE_CONTENT_INVALID code, not a generic error', () => {
    // The code is what a client branches on to put the message beside the input; a
    // `BAD_REQUEST` with prose would make it parse the message instead.
    expect(() => validateNoteBody('')).toThrow(
      expect.objectContaining({ code: NoteContentInvalidError.code }),
    );
  });
});
