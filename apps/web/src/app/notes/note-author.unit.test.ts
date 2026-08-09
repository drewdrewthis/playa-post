import { describe, expect, it } from 'vitest';

import type { Note } from '@playa-post/contracts';

import { noteAuthorCard } from './note-author';

const note = (author?: Note['author']): Note => ({
  id: 'n1',
  body: 'Come find me at the pavilion.',
  createdAt: '2026-08-09T10:00:00.000Z',
  ...(author === undefined ? {} : { author }),
});

describe('noteAuthorCard', () => {
  it('hands back the card the server sent, untouched', () => {
    const author = { userId: 'user-1', disclosure: 'full', displayName: 'Lena' };

    expect(noteAuthorCard(note(author))).toBe(author);
  });

  /*
   * ⚠ Withheld is still a line. A person who is in this viewer's world but discloses
   * nothing arrives as a card with no name, and `PersonIdentity` renders that as "Private
   * connection" — dropping the line here would hide the fact that somebody wrote this.
   */
  it('keeps an author who disclosed nothing but is still there', () => {
    expect(noteAuthorCard(note({ userId: 'user-1', disclosure: 'topology_only' }))).toEqual({
      userId: 'user-1',
      disclosure: 'topology_only',
    });
  });

  /*
   * ⚠ The §6a case this exists for. No author card means no author line — never a
   * placeholder, never a name rebuilt from a graph this viewer still happens to hold, and
   * never "Unknown". The note is still the note; nobody is named on it.
   */
  it('answers null when the author is no longer in this viewer’s world', () => {
    expect(noteAuthorCard(note())).toBeNull();
  });
});
