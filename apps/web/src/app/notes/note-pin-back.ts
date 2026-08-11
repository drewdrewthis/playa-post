import type { Note, NoteAuthor, Person } from '@playa-post/contracts';

import { describeNoteReach } from './note-reach';

/**
 * Whether the expanded view offers to answer a note, and with what (#176, decision D14).
 *
 * "Pin a note back" is **a new note to the note's author**, through the same `notes.pin`
 * and the same first-degree gate any other pin goes through. It is not an operation on the
 * note being read: notes have no unpin, no archive, and no update, and D14 revisited that
 * and deliberately kept it. Nothing here writes, and nothing here names the note.
 */
export type NotePinBack =
  /**
   * There is nobody to write to, so nothing is offered — not a disabled control, not an
   * explanation.
   *
   * ⚠ **This is the case that must never be filled in.** An absent author card is the
   * server saying "you may read this message and you may not be told who it is from"
   * (`note-author.ts`, ADR-0002 §6a); the note carries no `userId` at all, so there is no
   * identifier to address even if the screen wanted one. Offering a control here would
   * require inventing the recipient, which is the B5 person-projection bug on the surface
   * where the reader is most likely to believe they already know the answer.
   */
  | { readonly kind: 'no-author' }
  /**
   * The graph read has not landed, so the distance is not yet known.
   *
   * Silence rather than a guess: rendering "not connected" while the read is in flight
   * would flash a refusal at somebody who is in fact a direct connection — the same
   * four-states discipline `people/person-sheet.tsx` and `bulletin-detail-sheet.tsx` keep.
   */
  | { readonly kind: 'unsettled' }
  /** Ready to answer. `label` is the control's copy, `recipientId` is who it addresses. */
  | { readonly kind: 'can-pin'; readonly recipientId: string; readonly label: string }
  /** Too far to write to. `hint` is the one line explaining the distance. */
  | { readonly kind: 'out-of-reach'; readonly hint: string };

/**
 * The author as **this note** discloses them, standing where the graph says they stand.
 *
 * ⚠ **Two payloads, two questions, and neither may answer the other's.** The graph is the
 * only payload carrying a `degree`, so it answers "how far away are they". The note's
 * author card is the §6a projection attached to *this message*, so it answers "what may I
 * call them" — and `note-author.ts` states the rule that makes this function necessary:
 * *never fill the gap in, not from the local graph*. Handing {@link describeNoteReach} the
 * graph's own row would let a name the note withheld reach the control's label, and the
 * screen would render "Private connection" over a button that names them.
 *
 * ⚠ Fields are copied one by one rather than spread over the graph row. A spread would
 * leave `displayName` and `handle` in place whenever the note omits them, which is exactly
 * the case this exists to close — the leak survives the fix and nothing type-checks it.
 *
 * `trust` is the viewer's own directional setting, read by nothing on this path and
 * neutral here rather than carried, so no reader mistakes it for something the label
 * depends on.
 */
function asAuthorAtTheirDistance(author: NoteAuthor, person: Person): Person {
  return {
    userId: author.userId,
    degree: person.degree,
    trust: null,
    disclosure: author.disclosure,
    ...(author.displayName === undefined ? {} : { displayName: author.displayName }),
    ...(author.handle === undefined ? {} : { handle: author.handle }),
    ...(author.avatarUrl === undefined ? {} : { avatarUrl: author.avatarUrl }),
  };
}

/**
 * Read a note and the viewer's graph as an answer about pinning back.
 *
 * ⚠ **A UX gate and never an authorization one.** The real gate is inside
 * `postgres-note.repository.ts`'s insert, which refuses a non-first-degree recipient
 * identically to one who does not exist. This decides whether to *offer* a control, using
 * the graph the app is already holding — so an author whose degree changed between this
 * read and the submit still gets the server's answer, rendered by the compose screen.
 *
 * ⚠ **An author card is necessary but not sufficient.** `app.visible_notes` LEFT-joins the
 * whole authorized person set, not just direct connections, so a card can belong to
 * somebody now two or six hops away — pinning required degree 1 *at the time*, and the
 * read never re-derives it. Presence answers "is there anyone to address"; the degree
 * answers "may I write to them", and both have to be asked.
 *
 * ⚠ **The graph says how far; the note says who.** Every string this returns is built from
 * the note's own author card via {@link asAuthorAtTheirDistance}, never from the graph row
 * the degree came out of. Without that, a note whose author card §6a withheld would render
 * "Private connection" on its author line and name them on the control directly beneath —
 * which is the same leak in two payloads' clothing.
 *
 * ⚠ **No intro control here, unlike `bulletin-detail-sheet.tsx`.** Past the first degree
 * this renders the hint and stops. A bulletin is a stranger's post and reaching its author
 * is the sheet's whole purpose; a note is already a message from somebody who was a direct
 * connection, and answering "ask a third person to introduce you to the person who wrote
 * to you" is a different feature (#89) on a surface that does not need it.
 *
 * @param note - The note being read, as the server projected it.
 * @param people - `graph.list`'s people, or `undefined` while that read is unsettled.
 */
export function describeNotePinBack(
  note: Note,
  people: readonly Person[] | undefined,
): NotePinBack {
  const author = note.author;

  if (author === undefined) {
    return { kind: 'no-author' };
  }

  if (people === undefined) {
    return { kind: 'unsettled' };
  }

  const person = people.find((candidate) => candidate.userId === author.userId);
  const reach = describeNoteReach(
    person === undefined ? undefined : asAuthorAtTheirDistance(author, person),
  );

  if (reach.kind === 'can-pin') {
    return { kind: 'can-pin', recipientId: author.userId, label: reach.label };
  }

  return { kind: 'out-of-reach', hint: reach.hint };
}
