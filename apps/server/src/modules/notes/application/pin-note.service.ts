import type { Note } from '../domain/note';
import { validateNoteBody } from '../domain/note-content.policy';
import type { NoteRepository } from '../domain/note.repository';

/**
 * What pinning a note is given.
 *
 * `authorId` comes from the `Actor` resolved at the tRPC context boundary and is
 * **never** a field on a procedure input (ADR-0002:180-181, B14). `recipientId` is the
 * one identifier a caller legitimately supplies — and the reason this mutation, unlike
 * `bulletin.create`, has a real refusal path: naming somebody you are not connected to
 * is a case the repository's statement decides, not a case the type system rules out.
 */
export interface PinNoteCommand {
  readonly authorId: string;
  /** Who the note is for. Must be a first-degree connection of the author. */
  readonly recipientId: string;
  readonly body: string;
}

export interface PinNoteService {
  pin(command: PinNoteCommand): Promise<Note>;
}

/** Collaborators, injected rather than resolved (addendum §12, ADR-0003). */
export interface PinNoteDependencies {
  readonly notes: NoteRepository;
  /** Reads the wall clock. Overridable so a test can pin `created_at`. */
  readonly now?: (() => Date) | undefined;
}

/**
 * The pin-a-note use case (issue #88).
 *
 * Two steps and no third: validate the body, then hand one atomic write to the
 * repository. The policy runs here rather than at the transport, so
 * `sync.submitMutations`' offline replay reaches the same rule by running the same use
 * case — a second copy at either boundary is a second answer for one of the two paths.
 * The `NotePinned` outbox row is written **inside that same transaction** — see
 * {@link NoteRepository.pin} — rather than published from here, because publishing after
 * a commit is the dual-write bug ADR-0006 exists to prevent.
 *
 * ⚠ **Authorization is deliberately absent from this file.** "Is the recipient a direct
 * connection" is decided by the `WHERE EXISTS` inside the repository's insert, not by a
 * check here, because a check here would be a read that the write could then race. This
 * service is not where that rule is enforced and must never grow a copy of it: two
 * places deciding who may receive a note is two answers, and the cheaper one always
 * wins the race.
 *
 * There is deliberately no per-author rate limit and no `mutationId` idempotency: replay
 * idempotency is the sync envelope's job (ADR-0005), and a second implementation here
 * would give the two paths two answers for one duplicated pin.
 */
export function createPinNoteService(dependencies: PinNoteDependencies): PinNoteService {
  const readClock = dependencies.now ?? ((): Date => new Date());

  return {
    async pin(command: PinNoteCommand): Promise<Note> {
      const body = validateNoteBody(command.body);
      // One clock reading, taken after validation so a refused note never advances it.
      const createdAt = readClock();

      return dependencies.notes.pin({
        authorId: command.authorId,
        recipientId: command.recipientId,
        body,
        createdAt,
      });
    },
  };
}
