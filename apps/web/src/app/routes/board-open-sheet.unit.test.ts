import { describe, expect, it } from 'vitest';

import {
  bulletinSheet,
  bulletinSheetId,
  noteSheet,
  noteSheetId,
  NO_SHEET,
  type OpenSheet,
} from './board-open-sheet';

/*
 * The board raises two kinds of sheet onto one layer. These read as small because the
 * property they hold is small — exactly one sheet, ever — and that property used to be a
 * comment over two `useState`s, where it was already violated by the view toggle.
 *
 * Read the assertions in pairs. Each one checks not only that the right sheet is raised
 * but that the *other* accessor answers `null`, which is the half a two-state version
 * could not make true and a `kind` union cannot make false.
 */
describe('what the board has raised', () => {
  it('raises nothing to begin with', () => {
    expect(bulletinSheetId(NO_SHEET)).toBeNull();
    expect(noteSheetId(NO_SHEET)).toBeNull();
  });

  it('raises a bulletin, and no note alongside it', () => {
    const sheet = bulletinSheet('bulletin-1');

    expect(bulletinSheetId(sheet)).toBe('bulletin-1');
    expect(noteSheetId(sheet)).toBeNull();
  });

  it('raises a note, and no bulletin alongside it', () => {
    const sheet = noteSheet('note-1');

    expect(noteSheetId(sheet)).toBe('note-1');
    expect(bulletinSheetId(sheet)).toBeNull();
  });

  /*
   * The regression, stated as the sequence that produced it: a note is read, the viewer
   * switches to Dismissed, and the board asks what to raise. Before, this left the note
   * sheet floating over a view that lists no notes.
   */
  it('lowers a note when the next thing raised is a bulletin', () => {
    const raised: OpenSheet = bulletinSheet('bulletin-1');

    expect(noteSheetId(raised)).toBeNull();
  });

  it('lowers a bulletin when the next thing raised is a note', () => {
    const raised: OpenSheet = noteSheet('note-1');

    expect(bulletinSheetId(raised)).toBeNull();
  });

  it('lowers everything on a close, whichever kind was up', () => {
    for (const raised of [bulletinSheet('bulletin-1'), noteSheet('note-1')]) {
      expect(bulletinSheetId(raised) ?? noteSheetId(raised)).not.toBeNull();
      expect(bulletinSheetId(NO_SHEET)).toBeNull();
      expect(noteSheetId(NO_SHEET)).toBeNull();
    }
  });

  /*
   * Ids from two tables are never compared, so the same string standing for a note and a
   * bulletin stays two different sheets. Contrived as a fixture, and the exact confusion a
   * bare `string | null` state would have allowed.
   */
  it('does not confuse a note with a bulletin that shares its id', () => {
    expect(bulletinSheetId(noteSheet('shared-id'))).toBeNull();
    expect(noteSheetId(bulletinSheet('shared-id'))).toBeNull();
  });
});
