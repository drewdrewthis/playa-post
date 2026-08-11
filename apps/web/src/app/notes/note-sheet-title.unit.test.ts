import { describe, expect, it } from 'vitest';

import type { Note } from '@playa-post/contracts';

import { noteSheetTitle } from './note-sheet-title';

function note(body: string, displayName?: string): Note {
  return {
    id: 'note-1',
    body,
    createdAt: '2026-08-11T09:00:00.000Z',
    author: {
      userId: 'author-1',
      disclosure: displayName === undefined ? 'topology_only' : 'full',
      ...(displayName === undefined ? {} : { displayName }),
    },
  };
}

/** An author who has left this viewer's world: the key is absent, not `null`. */
const AUTHORLESS: Note = {
  id: 'note-2',
  body: 'The good coffee is in the blue bin.',
  createdAt: '2026-08-11T09:00:00.000Z',
};

describe('what a note’s expanded view is announced as', () => {
  it('names who it is from and how it starts', () => {
    expect(noteSheetTitle(note('The good coffee is in the blue bin.', 'Lena'))).toBe(
      'Note from Lena — The good coffee is in the blue bin.',
    );
  });

  /*
   * The defect this replaced: every note was labelled with the literal word "Note", so two
   * open dialogs were indistinguishable to anyone listening rather than looking. Two notes
   * from the same person must still differ.
   */
  it('tells two notes from the same person apart', () => {
    const first = noteSheetTitle(note('Bring the good tarp.', 'Lena'));
    const second = noteSheetTitle(note('Camp moved to 7 and Esplanade.', 'Lena'));

    expect(first).not.toBe(second);
  });

  describe('given a body longer than a label should be', () => {
    const LONG = 'a'.repeat(20) + ' ' + 'b'.repeat(20) + ' ' + 'c'.repeat(20) + ' tail';

    it('cuts it on a word and marks the cut', () => {
      const title = noteSheetTitle(note(LONG, 'Lena'));

      expect(title).toBe(`Note from Lena — ${'a'.repeat(20)} ${'b'.repeat(20)}…`);
      expect(title).not.toContain('tail');
    });

    it('cuts mid-word rather than announcing nothing, when there is no word break', () => {
      expect(noteSheetTitle(note('z'.repeat(90), 'Lena'))).toBe(
        `Note from Lena — ${'z'.repeat(60)}…`,
      );
    });

    it('leaves a body that already fits exactly as it is', () => {
      const exact = 'x'.repeat(60);

      expect(noteSheetTitle(note(exact, 'Lena'))).toBe(`Note from Lena — ${exact}`);
    });
  });

  /*
   * A body is `pre-wrap` on screen, so its newlines are meaningful there and merely noisy
   * in something announced before the dialog is read out.
   */
  it('flattens the body to one line', () => {
    expect(noteSheetTitle(note('Camp moved.\n\n  See you there.', 'Lena'))).toBe(
      'Note from Lena — Camp moved. See you there.',
    );
  });

  describe('§6a — a name is a disclosure whether it is read or heard', () => {
    it('names nobody when the note disclosed no name', () => {
      const title = noteSheetTitle(note('The good coffee is in the blue bin.'));

      expect(title).toBe('Note — The good coffee is in the blue bin.');
    });

    it('names nobody when the author has left this viewer’s world', () => {
      const title = noteSheetTitle(AUTHORLESS);

      expect(title).toBe('Note — The good coffee is in the blue bin.');
      expect(title).not.toContain('author-1');
    });
  });
});
