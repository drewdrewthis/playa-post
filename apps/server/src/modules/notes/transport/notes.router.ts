import { TRPCError } from '@trpc/server';

import { ApplicationError } from '../../../shared/errors/application-error';
import { authenticatedProcedure, router } from '../../../shared/trpc/trpc';
import type { GetNoteQuery } from '../application/get-note.query';
import type { ListNotesQuery } from '../application/list-notes.query';
import type { PinNoteService } from '../application/pin-note.service';
import { NoteGoneError, NoteRecipientUnreachableError } from '../domain/note.errors';

import { noteIdInput } from './note-id.input';
import {
  presentNote,
  presentVisibleNote,
  type PresentedNote,
  type PresentedVisibleNote,
} from './note.presenter';
import { pinNoteCommandFields, pinNoteInput } from './pin-note.input';

/**
 * The application operations this router speaks for. One use case, one procedure.
 *
 * {@link ListNotesQuery} and {@link GetNoteQuery} are two entries here and one port
 * underneath — `notes.module.ts` builds both over the same `VisibleNotesRepository` — so
 * the pair is two readers of one authorized set rather than two answers to "which notes
 * may this person read".
 */
export interface NotesRouterDependencies {
  readonly pinNote: PinNoteService;
  readonly listNotes: ListNotesQuery;
  readonly getNote: GetNoteQuery;
}

/**
 * Give an {@link ApplicationError} the transport status it deserves.
 *
 * Without this, an application error escapes as tRPC's default
 * `INTERNAL_SERVER_ERROR` — a 500 for a recipient you are not connected to. The stable
 * application code travels either way (`trpc.ts`'s `errorFormatter` lifts it into
 * `data.applicationCode`), so this decides the HTTP status and nothing else.
 *
 * **`NOTE_RECIPIENT_UNREACHABLE` and `NOTE_GONE` are `NOT_FOUND`, and never `FORBIDDEN`.**
 * A 403 says "that person is real, you just may not write to them" — or "that note is
 * real, it simply is not yours" — which in a product with no people search is the whole of
 * what an attacker wanted to know; 404 is the same answer a UUID naming nobody gets. The
 * uniformity only holds because the domain raises **one** error class for every reason
 * each of the two failed — see {@link NoteRecipientUnreachableError} and
 * {@link NoteGoneError} — so this mapping cannot become an oracle by someone later giving
 * one of those cases its own code.
 *
 * `NOTE_CONTENT_INVALID` is the caller's own submission being malformed, which is a **bad
 * request** and may name what they sent without disclosing anything.
 */
function asTrpcError(error: ApplicationError): TRPCError {
  const code =
    error instanceof NoteRecipientUnreachableError || error instanceof NoteGoneError
      ? 'NOT_FOUND'
      : 'BAD_REQUEST';

  return new TRPCError({ code, message: error.message, cause: error });
}

/**
 * Run one application operation and map its refusals onto the wire.
 *
 * Every procedure body is the same three steps — call one operation, present the result,
 * translate an `ApplicationError` — so the translation lives here once, the same shape
 * `bulletins.router.ts` establishes.
 */
async function present<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof ApplicationError) {
      throw asTrpcError(error);
    }
    throw error;
  }
}

/**
 * The notes module's tRPC surface — the private person-to-person channel (issue #88).
 *
 * **Three procedures: `pin`, `list`, and `getById`.** `getById` arrived with #176 and
 * decision D14, which reversed this router's original "two procedures and deliberately no
 * third" position: a note now opens into an expanded view, and a card that opens has to
 * open onto the server's own copy, re-checked against this viewer at the moment they open
 * it, rather than onto whatever a list read left in a cache. It is a **second read of the
 * same authorized set** — `app.visible_notes` plus an id predicate — never a second
 * definition of which notes a person may read.
 *
 * ⚠ **There is still no `listSent` and no `archive`, and D14 did not reopen either.** A
 * "sent" list would turn a thing you leave into a thread you keep — the fixed-recipient
 * *messaging* PDF §6 keeps out of this product until it is designed deliberately — and an
 * archive would be the first note lifecycle: notes are immutable and pin-only (see
 * {@link import('../domain/note').Note}), with no unpin, no update, and no version.
 * "Pinning a note back" is a **new note through `pin`**, addressed to the author of the
 * one being read, and is therefore not on this list at all.
 *
 * **No procedure takes an identifier for its caller.** `pin` takes a `recipientId`, which
 * names the other party and is a claim the server authorizes; `getById` takes a `noteId`,
 * which names a row and is a claim the server authorizes; `list` takes nothing at all,
 * because there is exactly one note list a caller may read (ADR-0002 §5a).
 * `tests/fitness/viewer-id-provenance.fitness.test.ts` walks this router to prove it.
 *
 * Every procedure is `authenticatedProcedure`: each one either writes state attached to an
 * actor or reads state scoped to one, so there is no version of any of them a signed-out
 * caller could sensibly be given.
 */
export function createNotesRouter(dependencies: NotesRouterDependencies) {
  return router({
    /**
     * Pin a note to a direct connection's board.
     *
     * The author is the caller and cannot be anybody else. A recipient who is not a
     * first-degree connection — or is nobody at all — gets 404
     * `NOTE_RECIPIENT_UNREACHABLE` and leaves no row behind.
     *
     * ⚠ This is also the **pin-back** procedure (#176, decision D14). Answering a note is
     * writing a new one to its author, so it re-enters here and is authorized here — a
     * viewer whose author has since stopped being a direct connection is refused exactly
     * as any other unreachable recipient is, with nothing about the note being answered
     * changing that.
     */
    pin: authenticatedProcedure
      .input(pinNoteInput)
      .mutation(async ({ ctx, input }): Promise<PresentedNote> =>
        present(async () =>
          presentNote(
            await dependencies.pinNote.pin({
              authorId: ctx.actor.userId,
              ...pinNoteCommandFields(input),
            }),
          ),
        ),
      ),

    /**
     * The notes pinned to the caller's own board, newest first.
     *
     * `ctx.viewerId` is minted by the `authenticatedProcedure` middleware from the
     * resolved `Actor` and is the only `ViewerId` in the system — there is exactly one
     * note list a caller may read, so there is no parameter that could name a different
     * one (ADR-0002 §5a).
     */
    list: authenticatedProcedure.query(
      async ({ ctx }): Promise<readonly PresentedVisibleNote[]> =>
        present(async () =>
          (await dependencies.listNotes.list({ viewerId: ctx.viewerId })).map(presentVisibleNote),
        ),
    ),

    /**
     * One note, if the caller is the person it was addressed to (#176, decision D14).
     *
     * The expanded view's read. Not yours, and never existent, are one answer — 404
     * `NOTE_GONE` — because visibility is the product and "does this exist" is itself
     * protected information (ADR-0002 §10, B17).
     *
     * ⚠ **The author is the one who cannot read it here.** `app.visible_notes` gates on
     * `recipient_id = viewer_id`, so an author asking for their own pinned note gets the
     * same `NOTE_GONE` a stranger gets. That is the product statement PDF §6 asks for — a
     * note is left on somebody else's board, not posted to a shared one — and it is why
     * this procedure is not a way to read back what you sent.
     */
    getById: authenticatedProcedure
      .input(noteIdInput)
      .query(async ({ ctx, input }): Promise<PresentedVisibleNote> =>
        present(async () =>
          presentVisibleNote(
            await dependencies.getNote.getById({ viewerId: ctx.viewerId, noteId: input.noteId }),
          ),
        ),
      ),
  });
}

/** The notes router's type, for the root router to mount it by. */
export type NotesRouter = ReturnType<typeof createNotesRouter>;
