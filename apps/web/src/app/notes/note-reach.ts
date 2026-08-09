import type { Person } from '@playa-post/contracts';

import { composeNoteTitle, noteRecipientName } from './note-recipient';

/**
 * Whether this viewer may pin a note to a person, and what to say when they may not.
 *
 * ⚠ **This is a UX gate and never an authorization one.** The real gate is inside the
 * insert statement (`postgres-note.repository.ts`), which refuses a non-first-degree
 * recipient identically to one who does not exist. This decides whether to *offer* the
 * control, using the same graph read the screen is already holding — so a person whose
 * degree changed between the read and the write still gets the server's answer, rendered
 * (`pin-note-outcome.ts`), rather than a client that thought it knew better.
 *
 * ⚠ **Do not build a reachability probe from the hint.** It says only what this viewer's
 * own graph already showed them: a person on their graph, at a distance they can already
 * see. It never speaks about somebody absent from that graph.
 */
export type NoteReach =
  /** Ready to pin. `label` is the button's copy. */
  | { readonly kind: 'can-pin'; readonly label: string }
  /** Not ready. `hint` is the one line explaining why. */
  | { readonly kind: 'needs-connection'; readonly hint: string };

/**
 * Read a person off the viewer's graph as an answer about pinning.
 *
 * @param person - The author, found in the **settled** `graph.list` payload. `undefined`
 *   means the settled read did not contain them; call this only once that read has
 *   landed, or a loading graph renders as "not connected".
 */
export function describeNoteReach(person: Person | undefined): NoteReach {
  if (person !== undefined && person.degree === 1) {
    return { kind: 'can-pin', label: composeNoteTitle(noteRecipientName(person)) };
  }

  const degree = person?.degree;

  /*
   * No degree to name: somebody absent from the graph, or the viewer's own row at
   * degree 0. Saying "0th degree" would be nonsense and "2nd degree" would be a guess —
   * the requirement stands on its own without either.
   */
  if (degree === undefined || degree < 2) {
    return { kind: 'needs-connection', hint: 'Pinning a note needs a direct connection.' };
  }

  /*
   * The comp's hint (`design/Playa Post.dc.html:746`) — text, and deliberately no
   * button: requesting an intro is issue #89 and has no procedure behind it yet. A
   * control here would be an affordance for a thing that cannot happen.
   */
  const name = noteRecipientName(person);
  const subject = name === null ? 'they are' : `${name} is`;

  return {
    kind: 'needs-connection',
    hint: `Pinning a note needs a direct connection — ${subject} ${ordinal(degree)} degree. Request an intro to reach them.`,
  };
}

/**
 * `1st`, `2nd`, `3rd`, `4th` — the comp stops at `3rd` because its graph does; ours does
 * not, since a person's own reach setting can carry the graph out to six hops
 * (`20260810090000_visibility_ceiling_sixth.sql`).
 */
function ordinal(value: number): string {
  const teens = value % 100;

  if (teens >= 11 && teens <= 13) {
    return `${String(value)}th`;
  }

  switch (value % 10) {
    case 1:
      return `${String(value)}st`;
    case 2:
      return `${String(value)}nd`;
    case 3:
      return `${String(value)}rd`;
    default:
      return `${String(value)}th`;
  }
}
