import { describe, expect, it } from 'vitest';

import { createGetNoteQuery } from '../../application/get-note.query';
import type { VisibleNote } from '../../application/visible-note';
import type { VisibleNotesRepository } from '../../application/visible-notes.repository';
import { NoteGoneError } from '../../domain/note.errors';

/**
 * `notes.getById`'s one decision: a missing row becomes one refusal (#176, decision D14).
 *
 * The authorization itself is not testable here and is not tested here — it lives in
 * `app.visible_notes`, and `read-a-note.integration.test.ts` is its only real proof. What
 * *is* a property of this file is the translation: whatever the port answers `null` for,
 * the caller gets one {@link NoteGoneError} for, with no branch that could grow a second
 * one. A fake port is enough to state that, and a container would add nothing to it.
 *
 * ⚠ A **fake**, not a mock: an in-memory implementation of a port this module owns, so the
 * assertions are about what the query answered rather than about which methods it called.
 */
describe('modules/notes/application/get-note.query (#176)', () => {
  const NOTE: VisibleNote = {
    id: 'note-1',
    body: 'The good coffee is in the blue bin.',
    createdAt: new Date('2026-08-11T09:00:00.000Z'),
    author: { userId: 'author-1', disclosure: 'full', displayName: 'Lena' },
  };

  /**
   * A port holding one note for one viewer.
   *
   * `listFor` is present because the port declares it and unreachable because this query
   * does not read lists — a fake that answered it would invite a future edit to satisfy
   * this suite through the wrong method.
   */
  function fakeNotes(stored: readonly { viewerId: string; note: VisibleNote }[]): VisibleNotesRepository {
    return {
      listFor: () => Promise.reject(new Error('get-note.query must not read the list')),
      findVisibleById: (viewerId, noteId) =>
        Promise.resolve(
          stored.find((row) => row.viewerId === viewerId && row.note.id === noteId)?.note ?? null,
        ),
    };
  }

  it('answers the note the port authorized for this viewer', async () => {
    const getNote = createGetNoteQuery({ notes: fakeNotes([{ viewerId: 'viewer-1', note: NOTE }]) });

    await expect(getNote.getById({ viewerId: 'viewer-1', noteId: 'note-1' })).resolves.toEqual(NOTE);
  });

  it('raises one NOTE_GONE for a note this viewer may not read and for one that does not exist', async () => {
    const getNote = createGetNoteQuery({ notes: fakeNotes([{ viewerId: 'viewer-1', note: NOTE }]) });

    // Two inputs the port cannot tell apart and this query must not either: somebody
    // else's note, and a note nobody has. Both arrive here as `null`, which is precisely
    // why the refusal cannot become an oracle — there is no information at this seam to
    // build one out of (ADR-0002 §10, B17).
    const notMine = await getNote
      .getById({ viewerId: 'viewer-2', noteId: 'note-1' })
      .catch((error: unknown) => error);
    const noSuchNote = await getNote
      .getById({ viewerId: 'viewer-1', noteId: 'note-404' })
      .catch((error: unknown) => error);

    expect(notMine).toBeInstanceOf(NoteGoneError);
    expect(noSuchNote).toBeInstanceOf(NoteGoneError);
    expect(NoteGoneError.code).toBe('NOTE_GONE');
    expect(JSON.stringify(notMine)).toBe(JSON.stringify(noSuchNote));
  });
});
