import { describe, expect, it } from 'vitest';

import { INTRO_NOTE_MAX_LENGTH } from '../../domain/intro-note';
import { validateIntroNote, validateViaNote } from '../../domain/intro-note.policy';
import { INTRO_DECISION } from '../../domain/intro-request';
import {
  IntroContentInvalidError,
  IntroDeclineCarriesNoNoteError,
} from '../../domain/intro-request.errors';

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

/**
 * `specs/features/request-an-intro.feature` › "Passing an intro on requires a note of the
 * via's own" and › "A decline carries no note" (`@unit`, issue #175).
 *
 * The rule the owner stated: "you have to add your own message". A pass-on is a vouch
 * rather than a forward, so the note is required rather than offered — and a decline
 * takes none at all, because the requester is told only that it was not passed on.
 *
 * ⚠ **This is the one function that branches on the decision.** The service must not, and
 * `decide-intro.service.ts` says so — which is why the branch is tested here rather than
 * inferred from a service that happens to call it.
 */
describe('validateViaNote', () => {
  describe('passing it on', () => {
    it('returns the trimmed value, which is what the caller must store', () => {
      expect(validateViaNote(INTRO_DECISION.passOn, '  They both build shade.  ')).toBe(
        'They both build shade.',
      );
    });

    it('refuses an absent note — a pass-on with nothing added is a shrug', () => {
      expect(() => validateViaNote(INTRO_DECISION.passOn, undefined)).toThrow(
        IntroContentInvalidError,
      );
    });

    it('refuses an absent note and an empty one identically', () => {
      // One rule with one message, deliberately: "you sent no note" and "you sent an
      // empty one" are the same fact about what the target would read, and two codes for
      // it is two things a client has to branch on to say one sentence.
      const forAbsent = refusalOf(() => validateViaNote(INTRO_DECISION.passOn, undefined));
      const forEmpty = refusalOf(() => validateViaNote(INTRO_DECISION.passOn, ''));

      expect(forAbsent).toEqual(forEmpty);
    });

    it('trims first, so whitespace cannot disguise an empty note', () => {
      expect(() => validateViaNote(INTRO_DECISION.passOn, '   \n\t ')).toThrow(
        IntroContentInvalidError,
      );
    });

    it(`accepts one of exactly ${String(INTRO_NOTE_MAX_LENGTH)} characters and refuses one longer`, () => {
      const atBound = 'x'.repeat(INTRO_NOTE_MAX_LENGTH);

      expect(validateViaNote(INTRO_DECISION.passOn, atBound)).toBe(atBound);
      expect(() =>
        validateViaNote(INTRO_DECISION.passOn, 'x'.repeat(INTRO_NOTE_MAX_LENGTH + 1)),
      ).toThrow(IntroContentInvalidError);
    });

    it('is held to the same bound as the requester’s note, from the same constant', () => {
      // Not a coincidence worth restating in a second policy: both notes land in `text`
      // columns on one row and both are read on one screen, so a via allowed more room
      // than the person they are vouching for would be a rule nobody chose.
      const atBound = 'x'.repeat(INTRO_NOTE_MAX_LENGTH);

      expect(validateViaNote(INTRO_DECISION.passOn, atBound)).toBe(validateIntroNote(atBound));
    });
  });

  describe('declining', () => {
    it('returns nothing, so the column it lands in is null', () => {
      // `undefined`, not `''`. The table's `via_note is null or status = 'passed_on'`
      // CHECK is a backstop with something to check only while a decline writes a null.
      expect(validateViaNote(INTRO_DECISION.decline, undefined)).toBeUndefined();
    });

    it('refuses a note rather than dropping one', () => {
      // ⚠ Silently discarding it would let its writer believe the requester might one
      // day read it. Nobody ever will — a decline carries no reason — so the honest
      // answer is a refusal naming what happened.
      expect(() => validateViaNote(INTRO_DECISION.decline, 'They are not for you.')).toThrow(
        IntroDeclineCarriesNoNoteError,
      );
    });

    it('refuses an empty string too, because a present key is a claim that there is one', () => {
      expect(() => validateViaNote(INTRO_DECISION.decline, '')).toThrow(
        IntroDeclineCarriesNoNoteError,
      );
    });

    it('refuses with its own code, never the content one', () => {
      // One error, one meaning. The text may be perfectly well-formed, so answering
      // "your note is empty or too long" would send somebody to fix a note that is fine.
      expect(() => validateViaNote(INTRO_DECISION.decline, 'anything')).toThrow(
        expect.objectContaining({ code: IntroDeclineCarriesNoNoteError.code }),
      );
      expect(IntroDeclineCarriesNoNoteError.code).not.toBe(IntroContentInvalidError.code);
    });
  });
});

/** A thrown refusal as a caller can compare two of them: the class and the stable code. */
function refusalOf(operation: () => unknown): { readonly name: string; readonly code: unknown } {
  try {
    operation();
  } catch (error) {
    const refusal = error as { name: string; code?: unknown };
    return { name: refusal.name, code: refusal.code };
  }

  throw new Error('the operation was expected to be refused');
}
