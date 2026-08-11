import type { GraphNodeIdentity } from '../graph/graph-node-identity';
import { requestIntroLabel } from '../intros/intro-copy';

import { composeNoteTitle, noteRecipientName } from './note-recipient';

/**
 * The two things reachability is decided from: how far away they are, and what this
 * viewer may call them.
 *
 * ⚠ **Narrower than `Person` on purpose.** A `Person` also carries a `userId`, a
 * `disclosure` and the viewer's `trust`, none of which this file reads — and a caller
 * holding a name from one payload and a degree from another (`note-pin-back.ts`, where
 * the note's §6a author card names the author and only the graph knows the distance) had
 * to fabricate the other three to call in. Asking for exactly what is read means such a
 * caller assembles two fields instead of five, and the compiler stops it carrying a name
 * it did not mean to.
 *
 * `Person` satisfies this structurally, so every existing caller passes one unchanged.
 */
export type ReachablePerson = GraphNodeIdentity & { readonly degree: number };

/**
 * How far this viewer can reach a person: pin a note, ask for an intro, or neither.
 *
 * ⚠ **This is a UX gate and never an authorization one.** The real gates are inside the
 * statements — `postgres-note.repository.ts`'s insert refuses a non-first-degree
 * recipient identically to one who does not exist, and
 * `app.intro_via_candidates` decides eligibility for an intro the same way. This decides
 * whether to *offer* a control, using the same graph read the screen is already holding
 * — so a person whose degree changed between the read and the write still gets the
 * server's answer, rendered (`pin-note-outcome.ts`, `intro-copy.ts`), rather than a
 * client that thought it knew better.
 *
 * ⚠ **Do not build a reachability probe from the hint.** It says only what this viewer's
 * own graph already showed them: a person on their graph, at a distance they can already
 * see. It never speaks about somebody absent from that graph.
 */
export type NoteReach =
  /** Ready to pin. `label` is the button's copy. */
  | { readonly kind: 'can-pin'; readonly label: string }
  /**
   * Too far to write to, close enough to be introduced. `hint` explains the distance and
   * `label` is the copy on the control that opens the intro sheet.
   */
  | { readonly kind: 'can-request-intro'; readonly hint: string; readonly label: string }
  /** Not ready, and nothing to offer. `hint` is the one line explaining why. */
  | { readonly kind: 'needs-connection'; readonly hint: string };

/**
 * Read a person off the viewer's graph as an answer about pinning.
 *
 * @param person - The author, found in the **settled** `graph.list` payload. `undefined`
 *   means the settled read did not contain them; call this only once that read has
 *   landed, or a loading graph renders as "not connected".
 */
export function describeNoteReach(person: ReachablePerson | undefined): NoteReach {
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

  const name = noteRecipientName(person);
  const subject = name === null ? 'they are' : `${name} is`;

  /*
   * The comp's second-degree hint (`design/Playa Post.dc.html:746`), now with the button
   * it always wanted: #89 gave requesting an intro a procedure behind it.
   */
  if (degree === 2) {
    return {
      kind: 'can-request-intro',
      hint: `Pinning a note needs a direct connection — ${subject} ${ordinal(degree)} degree.`,
      label: requestIntroLabel(name),
    };
  }

  /*
   * ⚠ **No control past the second degree**, which is a rule and not a layout choice:
   * `app.intro_via_candidates` returns nothing at degree 3 or beyond, so a button here
   * would open a sheet with an empty chip row and no way to send. An intro travels one
   * hop — the copy says the same thing the eligibility SQL does.
   */
  return {
    kind: 'needs-connection',
    hint: `Too far for an intro — intros travel one hop, and ${subject} ${ordinal(degree)} degree.`,
  };
}

/**
 * `1st`, `2nd`, `3rd`, `4th` — the comp stops at `3rd` because its graph does; ours does
 * not, since a person's own reach setting can carry the graph out to six hops
 * (`20260810090000_visibility_ceiling_sixth.sql`). Exported for the person sheet's
 * degree line (`person-context.ts`), which spells distance the same way.
 */
export function ordinal(value: number): string {
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
