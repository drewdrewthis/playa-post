import { describe, expect, it } from 'vitest';

import {
  buildPinNotePayload,
  inspectNoteDraft,
  NOTE_BODY_MAX_LENGTH,
  noteOverBy,
} from './pin-note-draft';

describe('inspectNoteDraft', () => {
  it('accepts a note somebody could act on', () => {
    expect(inspectNoteDraft('Bring the drill to 7:30 & E, any morning.')).toEqual({
      body: null,
      pinnable: true,
    });
  });

  it('refuses an empty note', () => {
    expect(inspectNoteDraft('')).toEqual({ body: 'empty', pinnable: false });
  });

  // The server trims before it measures, so a whitespace-only note is `NOTE_CONTENT_INVALID`
  // there. Refusing it here means the button is disabled instead of the round trip failing.
  it('refuses a whitespace-only note, which the server also refuses', () => {
    expect(inspectNoteDraft('   \n\t ')).toEqual({ body: 'empty', pinnable: false });
  });

  it('accepts a note exactly at the bound', () => {
    expect(inspectNoteDraft('x'.repeat(NOTE_BODY_MAX_LENGTH)).pinnable).toBe(true);
  });

  it('refuses a note one character past the bound', () => {
    expect(inspectNoteDraft('x'.repeat(NOTE_BODY_MAX_LENGTH + 1))).toEqual({
      body: 'too-long',
      pinnable: false,
    });
  });

  // The bound is measured after trimming, here and on the server. Measuring the raw value
  // would refuse a note the server would have accepted.
  it('measures the bound after trimming, so padding is not length', () => {
    const padded = `  ${'x'.repeat(NOTE_BODY_MAX_LENGTH)}  `;

    expect(inspectNoteDraft(padded).pinnable).toBe(true);
  });
});

describe('noteOverBy', () => {
  it('is zero for a note within the bound', () => {
    expect(noteOverBy('short')).toBe(0);
  });

  it('counts only the characters past the bound', () => {
    expect(noteOverBy('x'.repeat(NOTE_BODY_MAX_LENGTH + 12))).toBe(12);
  });
});

describe('buildPinNotePayload', () => {
  it('sends the trimmed body, which is what the server stores', () => {
    expect(buildPinNotePayload('user-1', '  Come find me at the pavilion.  ')).toEqual({
      recipientId: 'user-1',
      body: 'Come find me at the pavilion.',
    });
  });

  // `recipientId` is a claim the server authorizes inside its insert. A client that
  // filtered, normalised, or pre-checked it would be building the "can I write to this
  // person" probe `packages/contracts/src/notes.ts` forbids.
  it('carries the recipient id through untouched', () => {
    expect(buildPinNotePayload('  user-2  ', 'hi').recipientId).toBe('  user-2  ');
  });

  // A note has one field. No type, no title, no location, no audience, no expiry — the
  // shape is where "a note is not a bulletin" (decision D6) stops being a slogan.
  it('carries nothing a bulletin carries', () => {
    expect(Object.keys(buildPinNotePayload('user-1', 'hi')).sort()).toEqual(['body', 'recipientId']);
  });
});
