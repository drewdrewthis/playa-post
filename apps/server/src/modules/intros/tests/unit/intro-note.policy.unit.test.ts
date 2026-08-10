import { describe, expect, it } from 'vitest';

import { INTRO_NOTE_MAX_LENGTH } from '../../domain/intro-note';
import { validateIntroNote } from '../../domain/intro-note.policy';
import { IntroContentInvalidError } from '../../domain/intro-request.errors';

/**
 * `specs/features/request-an-intro.feature` › "The intro note is trimmed, bounded, and
 * never empty" (`@unit`, issue #89) — the unit half of AC12.
 *
 * The rule worth stating twice: an intro note may **not** be empty. It is the whole of
 * what the via is being asked to judge and the whole of what the target is eventually
 * shown, so an empty one is a stranger's name and no reason.
 */
describe('validateIntroNote', () => {
  it('returns the trimmed value, which is what the caller must store', () => {
    expect(validateIntroNote('  We both build shade structures.  ')).toBe(
      'We both build shade structures.',
    );
  });

  it('refuses an empty note — an intro with no reason is a stranger and nothing else', () => {
    expect(() => validateIntroNote('')).toThrow(IntroContentInvalidError);
  });

  it('trims first, so whitespace cannot disguise an empty note', () => {
    expect(() => validateIntroNote('   \n\t ')).toThrow(IntroContentInvalidError);
  });

  it(`accepts one of exactly ${String(INTRO_NOTE_MAX_LENGTH)} characters`, () => {
    const atBound = 'x'.repeat(INTRO_NOTE_MAX_LENGTH);

    expect(validateIntroNote(atBound)).toBe(atBound);
  });

  it('refuses one longer than the bound', () => {
    expect(() => validateIntroNote('x'.repeat(INTRO_NOTE_MAX_LENGTH + 1))).toThrow(
      IntroContentInvalidError,
    );
  });

  it('measures the bound after trimming, so surrounding whitespace is not charged for it', () => {
    const padded = `  ${'x'.repeat(INTRO_NOTE_MAX_LENGTH)}  `;

    expect(validateIntroNote(padded)).toHaveLength(INTRO_NOTE_MAX_LENGTH);
  });

  it('refuses with the stable INTRO_CONTENT_INVALID code, not a generic error', () => {
    // The code is what a client branches on to put the message beside the textarea; a
    // `BAD_REQUEST` with prose would make it parse the message instead. It is also what
    // keeps this refusal distinguishable from INTRO_UNAVAILABLE — which is safe only
    // because content is validated *before* eligibility (see the integration ordering
    // scenario), so this code can never be the answer to "can I reach that person".
    expect(() => validateIntroNote('')).toThrow(
      expect.objectContaining({ code: IntroContentInvalidError.code }),
    );
  });
});
