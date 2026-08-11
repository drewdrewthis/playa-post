import type { Note, NoteAuthor, Person } from '@playa-post/contracts';

import { describeNoteReach, type ReachablePerson } from './note-reach';

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
   * The distance is not known, so nothing is offered and nothing is claimed.
   *
   * ⚠ **Two causes, one answer, and the name says the answer rather than either cause.**
   * The graph read may still be in flight, or it may have settled with an error — the
   * screen holds `undefined` in both, and this used to be called `unsettled`, which named
   * only the first and quietly mislabelled the second as loading forever.
   *
   * They are deliberately not split. What the screen may say is decided by what it knows,
   * and it knows the same nothing either way: rendering "not connected" would flash a
   * refusal at somebody who may well be a direct connection, and rendering a control would
   * offer a write whose recipient nobody has confirmed is reachable. A retry belongs to
   * the graph read that failed, not to the sheet reporting it — the same four-states
   * discipline `people/person-sheet.tsx` and `bulletin-detail-sheet.tsx` keep.
   */
  | { readonly kind: 'unknown-distance' }
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
 * The return type is `ReachablePerson` and not `Person` precisely so this cannot be
 * written the other way: the three fields that would have had to be invented to satisfy
 * `Person` are the three nobody downstream reads.
 */
function asAuthorAtTheirDistance(author: NoteAuthor, person: Person): ReachablePerson {
  return {
    degree: person.degree,
    ...(author.displayName === undefined ? {} : { displayName: author.displayName }),
    ...(author.handle === undefined ? {} : { handle: author.handle }),
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
 * @param people - `graph.list`'s people, or `undefined` when that read has not landed —
 *   whether it is still in flight or settled with an error. The caller holds one value for
 *   both, and {@link NotePinBack} explains why one answer is right for them.
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
    return { kind: 'unknown-distance' };
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
