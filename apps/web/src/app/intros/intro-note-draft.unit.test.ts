import { describe, expect, it } from 'vitest';

import { INTRO_NOTE_MAX_LENGTH, inspectIntroNote, introNoteOverBy } from './intro-note-draft';

describe('inspectIntroNote', () => {
  it('accepts an ordinary note', () => {
    expect(inspectIntroNote('We both ride at dawn.')).toEqual({ note: null, sendable: true });
  });

  /*
   * ⚠ The note is the whole of what the via judges and the whole of what the target is
   * eventually shown. An empty one is a stranger's name and no reason, which is exactly
   * what `intro-note.policy.ts` refuses server-side.
   */
  it('refuses an empty note', () => {
    expect(inspectIntroNote('')).toEqual({ note: 'empty', sendable: false });
  });

  it('refuses a whitespace-only note, because the server trims before it counts', () => {
    expect(inspectIntroNote('   \n\t ')).toEqual({ note: 'empty', sendable: false });
  });

  it('accepts a note exactly at the bound', () => {
    expect(inspectIntroNote('a'.repeat(INTRO_NOTE_MAX_LENGTH)).sendable).toBe(true);
  });

  it('refuses one character past it', () => {
    expect(inspectIntroNote('a'.repeat(INTRO_NOTE_MAX_LENGTH + 1))).toEqual({
      note: 'too-long',
      sendable: false,
    });
  });

  // Measured after trimming, like the server: padding the server discards must not cost
  // the writer a character of budget.
  it('does not spend the budget on padding the server would drop', () => {
    const padded = `   ${'a'.repeat(INTRO_NOTE_MAX_LENGTH)}   `;

    expect(inspectIntroNote(padded).sendable).toBe(true);
  });
});

describe('introNoteOverBy', () => {
  it('counts only what is over the bound', () => {
    expect(introNoteOverBy('a'.repeat(INTRO_NOTE_MAX_LENGTH + 12))).toBe(12);
  });

  it('is zero for a note that fits, rather than a negative remainder', () => {
    expect(introNoteOverBy('short')).toBe(0);
  });

  // The count and the button have to agree: trailing spaces the bound ignores cannot
  // appear in the sentence that explains the bound.
  it('ignores padding, so the count cannot contradict the submit beside it', () => {
    expect(introNoteOverBy(`${'a'.repeat(INTRO_NOTE_MAX_LENGTH)}      `)).toBe(0);
  });
});
