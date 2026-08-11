import { NoteGoneError } from '../domain/note.errors';

import type { VisibleNote } from './visible-note';
import type { VisibleNotesRepository } from './visible-notes.repository';

/**
 * What fetching one note is given.
 *
 * ⚠ `viewerId` is the reading actor's `app.users.id`, and it must arrive from the `Actor`
 * resolved at the tRPC context boundary — never from request input (ADR-0002 §5a, B14).
 * The transport passes `ctx.viewerId`, the branded
 * {@link import('../../../shared/auth/viewer-id').ViewerId} whose only constructor takes
 * an `Actor`; this command widens it to `string` the same way {@link
 * import('./list-notes.query').ListNotesCommand} does, so the module states one identifier
 * convention rather than two.
 *
 * `noteId` is the caller's whole claim, and the only field here they supply.
 */
export interface GetNoteCommand {
  readonly viewerId: string;
  readonly noteId: string;
}

export interface GetNoteQuery {
  getById(command: GetNoteCommand): Promise<VisibleNote>;
}

/** Collaborators, injected rather than resolved (addendum §12, ADR-0003). */
export interface GetNoteDependencies {
  readonly notes: VisibleNotesRepository;
}

/**
 * The single-note read (#176, decision D14) — `notes.getById`.
 *
 * The expanded view's backing procedure, and the reason `note-card.tsx` may become a tap
 * target: a card that opens has to open onto the server's own copy, re-checked against
 * this viewer at the moment they open it, rather than onto whatever the list read left in
 * a cache.
 *
 * **The `null`-to-error translation on line one is the whole security property.**
 * `app.visible_notes` answers "nothing" identically for a note that never existed and one
 * addressed to somebody else; this query turns both into one {@link NoteGoneError} without
 * ever learning which it was. There is no branch here that could grow a distinguishing
 * message, because there is no information here to distinguish with — the same
 * construction `modules/bulletins`' `get-bulletin.query.ts` uses, for the same B17 reason.
 *
 * ⚠ Do not add a "does it exist" pre-read to improve the message. That read is the
 * existence oracle §10 forbids, and it would be invisible in the response it improved.
 *
 * ⚠ **This adds a read, never a lifecycle.** Notes stay immutable and pin-only: there is
 * no unpin, no archive, and no update to reach from here (decision D14 revisits that and
 * keeps it). "Pin back" is a new note through the existing `notes.pin`, so nothing on this
 * path writes.
 */
export function createGetNoteQuery(dependencies: GetNoteDependencies): GetNoteQuery {
  return {
    async getById(command: GetNoteCommand): Promise<VisibleNote> {
      const note = await dependencies.notes.findVisibleById(command.viewerId, command.noteId);

      if (note === null) {
        throw new NoteGoneError();
      }

      return note;
    },
  };
}
