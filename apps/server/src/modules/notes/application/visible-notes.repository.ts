import type { VisibleNote } from './visible-note';

/**
 * The port onto `app.visible_notes`.
 *
 * Declared in `application/` rather than `domain/` for the reason
 * `modules/bulletins/application/visible-bulletins.repository.ts` gives: this is a
 * **read model, not a domain entity**. There is no note aggregate to reconstruct here —
 * the aggregate is {@link import('../domain/note').Note}, behind
 * {@link import('../domain/note.repository').NoteRepository} — and inventing a second
 * domain type to hold a projection would be the placeholder layer addendum §4 forbids.
 *
 * ⚠ **Every method composes `app.visible_notes` and nothing else.** A method that read
 * `app.notes` with its own `where` would be the second visibility predicate ADR-0002 §6
 * forbids and `sql-table-ownership` cannot see, because a Kysely builder is not a `.sql`
 * file.
 */
export interface VisibleNotesRepository {
  /**
   * Every note pinned to this viewer's board, newest first.
   *
   * There is no paging bound here, unlike the board's `BOARD_PAGE_SIZE`: a note arrives
   * only from somebody who was a direct connection at the time, so the set is bounded by
   * a person's own connections rather than by the network. A limit arrives the day that
   * stops being true, as a cursor rather than as a parameter a caller could raise.
   *
   * @param viewerId - The reading actor's `app.users.id`. It is the whole authorization:
   *   the function returns the notes addressed to this person and no others, so there is
   *   no argument here through which a caller could reach somebody else's notes.
   * @returns Empty for a viewer nobody has written to. Never a refusal — an empty board
   *   and a board you are not allowed to read are the same thing for notes, because
   *   there is only ever your own.
   */
  listFor(viewerId: string): Promise<readonly VisibleNote[]>;
}
