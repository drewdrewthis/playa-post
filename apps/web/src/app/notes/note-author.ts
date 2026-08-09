import type { Note, NoteAuthor } from '@playa-post/contracts';

/**
 * The author card to render under a note, or `null` for no author line at all.
 *
 * ⚠ **Absent and withheld are two different answers, and only one of them is a line.**
 * An author who is still in this viewer's world but discloses nothing arrives as a card
 * with no name — `PersonIdentity` renders that as the private treatment, and the line
 * stays. An author who is no longer in this viewer's world arrives not at all, and the
 * only correct rendering is nothing: the note survives, unnamed.
 *
 * ⚠ **Never fill the gap in.** Not from the local graph, not from the connection you
 * remember making, not from the `userId` on any other row. Pinning required a first-degree
 * connection *at the time*; by the time the note is read that person may disclose less or
 * may have moved further away, and what the server withheld it withheld deliberately
 * (`packages/contracts/src/notes.ts`, §6a). This is the same discipline
 * `bulletin-detail-sheet.tsx`'s `authorLine` keeps, minus its "You" case — a note is never
 * one you pinned to yourself.
 */
export function noteAuthorCard(note: Note): NoteAuthor | null {
  return note.author ?? null;
}
