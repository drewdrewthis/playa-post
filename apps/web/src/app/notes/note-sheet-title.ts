import type { Note } from '@playa-post/contracts';

import { nodeLabel } from '../graph/graph-node-identity';

import { noteAuthorCard } from './note-author';

/**
 * How much of the note the announced name carries before it is cut.
 *
 * A note has no title, so the name has to come from its body, and a body runs to
 * `note-content.policy.ts`'s full limit. A screen reader announces the accessible name
 * *before* the dialog's contents, so an uncut body would be read twice — once as a label
 * nobody can interrupt, then again as the text. Enough to tell two notes apart is the job.
 */
const TITLE_SNIPPET_LIMIT = 60;

/**
 * What the expanded view is announced as — "Note from Lena — Bring the good tarp…".
 *
 * A dialog needs a name, and the type pill was serving as one: it reads the literal word
 * "Note" for every note ever opened, so a screen reader user tabbing between two of them
 * hears the same label twice and learns nothing. `bulletin-detail-sheet.tsx` names its
 * dialog by the bulletin's title; a note has no title, so it is named by who it is from
 * and how it starts.
 *
 * ⚠ **The name comes from the note's own author card and nowhere else** — the same §6a
 * rule `note-author.ts` states, applying here for the same reason it applies to the author
 * line. An author the note withheld is announced as "Note", not as whoever the local graph
 * happens to know; a label is as much a disclosure as a rendered name, and a name read
 * aloud is not a lesser one for being read aloud.
 */
export function noteSheetTitle(note: Note): string {
  const author = noteAuthorCard(note);
  const name = author === null ? undefined : nodeLabel(author);
  const opening = snippet(note.body);
  const from = name === undefined ? 'Note' : `Note from ${name}`;

  return opening === '' ? from : `${from} — ${opening}`;
}

/**
 * The body's opening, on one line and short enough to announce.
 *
 * Newlines become spaces because the body is `pre-wrap` on screen and a run of them would
 * otherwise be announced as one long pause in the middle of a label.
 */
function snippet(body: string): string {
  const oneLine = body.replace(/\s+/gu, ' ').trim();

  if (oneLine.length <= TITLE_SNIPPET_LIMIT) {
    return oneLine;
  }

  const cut = oneLine.slice(0, TITLE_SNIPPET_LIMIT);
  const lastSpace = cut.lastIndexOf(' ');

  // Cut on a word where there is one to cut on. A single unbroken 60-character run has no
  // space to fall back to, and half a word beats an empty label.
  return `${(lastSpace === -1 ? cut : cut.slice(0, lastSpace)).trimEnd()}…`;
}
