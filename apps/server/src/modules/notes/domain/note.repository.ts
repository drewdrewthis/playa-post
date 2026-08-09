import type { Note } from './note';

/** What pinning a note is given. The body has already been through the policy. */
export interface NewNote {
  /** The author, taken from the resolved `Actor` and never from request input. */
  readonly authorId: string;
  /** Who the note is for. The only identifier a caller legitimately supplies here. */
  readonly recipientId: string;
  /**
   * Already trimmed and bounded by
   * {@link import('./note-content.policy').validateNoteBody}.
   */
  readonly body: string;
  readonly createdAt: Date;
}

/**
 * The notes port — the **author-side** one.
 *
 * Declared here in `domain/` and implemented in `persistence/` (addendum §2). The
 * recipient's read is a viewer-scoped projection and lives behind
 * {@link import('../application/visible-notes.repository').VisibleNotesRepository}
 * instead, the same split `modules/bulletins` makes between `BulletinRepository` and
 * `VisibleBulletinsRepository`. Keeping the two apart is what stops a convenience
 * method on this port from becoming a second visibility predicate (ADR-0002 §6).
 */
export interface NoteRepository {
  /**
   * Write a note and its `NotePinned` event, **atomically**, and only if the recipient
   * is a first-degree connection of the author.
   *
   * ⚠ **The authorization is part of the statement, not a prior read.** The insert is a
   * single `INSERT … SELECT … WHERE EXISTS (…)` over the authorized-people set, so a
   * pair that is not directly connected inserts **zero rows** and there is no window in
   * which the connection could change between a check and a write. A read-then-write
   * would put actorship in a step a future editor could reorder; expressed this way it
   * cannot be moved without deleting it.
   *
   * One transaction covering two writes, because a note nobody was told about and a
   * notification about a note that does not exist are both worse than neither
   * (addendum §10, ADR-0006).
   *
   * @throws {import('./note.errors').NoteRecipientUnreachableError} when the statement
   *   wrote no row — which is the same answer for "no such person", "not connected",
   *   "two hops away", "no longer active" and "that is you". Telling them apart is the
   *   user-existence oracle ADR-0002 §10 forbids.
   */
  pin(write: NewNote): Promise<Note>;
}
