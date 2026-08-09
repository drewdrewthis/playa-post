import type { VisibleNote, VisibleNoteAuthor } from '../application/visible-note';
import type { Note } from '../domain/note';

/**
 * A note as this API renders one **to its author** — `notes.pin`'s answer.
 *
 * Carries `recipientId`, which {@link PresentedVisibleNote} does not: the author is the
 * only person for whom "who is this for" is information rather than an echo of
 * themselves.
 *
 * ⚠ It carries **no author card**, and that is not an omission: the author is the caller.
 * Projecting a person here would mean building one outside `app.visible_people`, which is
 * exactly what ADR-0002 §6a forbids.
 *
 * Timestamps are ISO-8601 strings rather than `Date`s. tRPC without a serializer turns a
 * `Date` into a string on the wire anyway, so declaring the string is declaring what a
 * client actually receives instead of a type that is true only in-process.
 */
export interface PresentedNote {
  readonly id: string;
  readonly recipientId: string;
  readonly body: string;
  readonly createdAt: string;
}

/**
 * A note's author as this API renders one.
 *
 * The same shape as the {@link VisibleNoteAuthor} read model, restated here rather than
 * re-exported, because the wire is a contract and the read model is an implementation
 * (the same argument `modules/bulletins`' and `modules/graph`'s presenters make).
 *
 * ⚠ Nothing is *added* here, and that is the rule ADR-0002 §6a states: every person
 * representation is projected through `app.visible_people`'s disclosure level, no
 * exceptions. A presenter that filled in a missing name from anywhere else — the
 * recipient's own graph, a cache, the connection they remember being made — would be
 * exactly the bug B5's person-projection sub-case asserts against, and on the one surface
 * where the recipient is most likely to believe they already know the answer.
 */
export interface PresentedNoteAuthor {
  readonly userId: string;
  readonly disclosure: string;
  readonly displayName?: string;
  readonly handle?: string;
  readonly avatarUrl?: string;
}

/**
 * One note a viewer is authorized to read — `notes.list`'s rows.
 *
 * No `recipientId`, unlike {@link PresentedNote}: the only person who can receive one of
 * these is the recipient, so the field could only ever say "you".
 */
export interface PresentedVisibleNote {
  readonly id: string;
  readonly body: string;
  readonly createdAt: string;
  readonly author: PresentedNoteAuthor;
}

/** Project the author's own note onto the wire. */
export function presentNote(note: Note): PresentedNote {
  return {
    id: note.id,
    recipientId: note.recipientId,
    body: note.body,
    createdAt: note.createdAt.toISOString(),
  };
}

/**
 * Project one already-projected author onto the wire.
 *
 * A field-by-field copy rather than a spread: a spread would carry whatever the read
 * model grows next into every client payload without anyone deciding it should be there,
 * and "the field appeared in the response because someone added it upstream" is how §6a
 * gets violated by accident.
 */
function presentAuthor(author: VisibleNoteAuthor): PresentedNoteAuthor {
  return {
    userId: author.userId,
    disclosure: author.disclosure,
    ...(author.displayName === undefined ? {} : { displayName: author.displayName }),
    ...(author.handle === undefined ? {} : { handle: author.handle }),
    ...(author.avatarUrl === undefined ? {} : { avatarUrl: author.avatarUrl }),
  };
}

/** Project one authorized note onto the wire. */
export function presentVisibleNote(note: VisibleNote): PresentedVisibleNote {
  return {
    id: note.id,
    body: note.body,
    createdAt: note.createdAt.toISOString(),
    author: presentAuthor(note.author),
  };
}
