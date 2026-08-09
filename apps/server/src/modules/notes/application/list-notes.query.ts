import type { VisibleNote } from './visible-note';
import type { VisibleNotesRepository } from './visible-notes.repository';

/**
 * What listing your notes is given. Nothing but the resolved viewer.
 *
 * ⚠ `viewerId` is the reading actor's `app.users.id`, and it must arrive from the
 * `Actor` resolved at the tRPC context boundary — never from request input
 * (ADR-0002 §5a, B14). The transport passes `ctx.viewerId`, the branded
 * {@link import('../../../shared/auth/viewer-id').ViewerId} whose only constructor takes
 * an `Actor`; this command widens it to `string` the same way
 * `modules/bulletins`' `ListBoardCommand` does, so the application layer states one
 * identifier convention rather than two.
 *
 * There is no filter, no query grammar, and no other person's ID — so there is nothing
 * here a caller could aim at somebody else's notes even if a field appeared.
 */
export interface ListNotesCommand {
  readonly viewerId: string;
}

export interface ListNotesQuery {
  list(command: ListNotesCommand): Promise<readonly VisibleNote[]>;
}

/** Collaborators, injected rather than resolved (addendum §12, ADR-0003). */
export interface ListNotesDependencies {
  readonly notes: VisibleNotesRepository;
}

/**
 * The recipient's note list (issue #88).
 *
 * One step, and the thinness is the design: the whole of "which notes may this person
 * read" lives in `app.visible_notes`, so there is nothing for this layer to add. A
 * filter, a merge with the board, or a "mark as read" side effect written here would each
 * be a rule the offline path and the tRPC path could then disagree about.
 *
 * ⚠ **Notes are not merged into the board.** PDF §6 keeps fixed-recipient messaging out
 * of the bulletin model, and that separation is only real if it survives the read: a
 * board query that also returned notes would make a note a bulletin in everything but
 * the table it came from (decision D6).
 */
export function createListNotesQuery(dependencies: ListNotesDependencies): ListNotesQuery {
  return {
    async list(command: ListNotesCommand): Promise<readonly VisibleNote[]> {
      return dependencies.notes.listFor(command.viewerId);
    },
  };
}
