import { TRPCError } from '@trpc/server';

import { ApplicationError } from '../../../shared/errors/application-error';
import { authenticatedProcedure, router } from '../../../shared/trpc/trpc';
import type { ListNotesQuery } from '../application/list-notes.query';
import type { PinNoteService } from '../application/pin-note.service';
import { NoteRecipientUnreachableError } from '../domain/note.errors';

import {
  presentNote,
  presentVisibleNote,
  type PresentedNote,
  type PresentedVisibleNote,
} from './note.presenter';
import { pinNoteCommandFields, pinNoteInput } from './pin-note.input';

/** The application operations this router speaks for. One use case, one procedure. */
export interface NotesRouterDependencies {
  readonly pinNote: PinNoteService;
  readonly listNotes: ListNotesQuery;
}

/**
 * Give an {@link ApplicationError} the transport status it deserves.
 *
 * Without this, an application error escapes as tRPC's default
 * `INTERNAL_SERVER_ERROR` — a 500 for a recipient you are not connected to. The stable
 * application code travels either way (`trpc.ts`'s `errorFormatter` lifts it into
 * `data.applicationCode`), so this decides the HTTP status and nothing else.
 *
 * **`NOTE_RECIPIENT_UNREACHABLE` is `NOT_FOUND`, and never `FORBIDDEN`.** A 403 says
 * "that person is real, you just may not write to them", which in a product with no
 * people search is the whole of what an attacker wanted to know; 404 is the same answer a
 * UUID naming nobody gets. The uniformity only holds because the domain raises one error
 * class for every reason the pin failed — see
 * {@link NoteRecipientUnreachableError} — so this mapping cannot become an oracle by
 * someone later giving one of those cases its own code.
 *
 * `NOTE_CONTENT_INVALID` is the caller's own submission being malformed, which is a **bad
 * request** and may name what they sent without disclosing anything.
 */
function asTrpcError(error: ApplicationError): TRPCError {
  const code = error instanceof NoteRecipientUnreachableError ? 'NOT_FOUND' : 'BAD_REQUEST';

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
 * ⚠ **Two procedures, and there is deliberately no third.** There is no `getById`, no
 * `listSent`, and no `archive`: a note has one reader and one moment. `getById` would
 * add a second authorized read of the same rows for no surface that needs it, and a
 * "sent" list would turn a thing you leave into a thread you keep — which is the
 * fixed-recipient *messaging* PDF §6 keeps out of this product until it is designed
 * deliberately.
 *
 * **No procedure takes an identifier for its caller.** `pin` takes a `recipientId`, which
 * names the other party and is a claim the server authorizes; `list` takes nothing at
 * all, because there is exactly one note list a caller may read (ADR-0002 §5a).
 * `tests/fitness/viewer-id-provenance.fitness.test.ts` walks this router to prove it.
 *
 * Both procedures are `authenticatedProcedure`: one writes state attached to an actor and
 * the other reads state scoped to one, so there is no version of either a signed-out
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
  });
}

/** The notes router's type, for the root router to mount it by. */
export type NotesRouter = ReturnType<typeof createNotesRouter>;
