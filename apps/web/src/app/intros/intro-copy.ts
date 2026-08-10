import type { IntroPerson } from '@playa-post/contracts';

import { nodeLabel } from '../graph/graph-node-identity';

/**
 * Every sentence the intro surfaces say, and the one function that decides what a
 * person on them may be called.
 *
 * Each string has two forms, and the second is not a degraded one: §6a lets a person be
 * visible at second degree — or be a candidate via — with no name disclosed at all, and
 * an intro is exactly where a reader is most likely to believe they already know who
 * they are looking at. "them" is the copy for it.
 *
 * ⚠ **The name comes from {@link nodeLabel} and from nowhere else**, the rule
 * `notes/note-recipient.ts` states for a note recipient. A second spelling of a privacy
 * rule is how two spellings drift.
 */

/**
 * What this viewer may call a person on an intro surface, or `null` when the projection
 * disclosed nothing.
 *
 * `undefined` in — an absent card on an inbox or outbox row, which the wire sends when
 * the request has outlived the relationship that carried it — is also `null`: **not** a
 * placeholder, and never the `userId`.
 */
export function introPersonName(person: IntroPerson | undefined): string | null {
  return (person === undefined ? undefined : nodeLabel(person)) ?? null;
}

/** The intro sheet's heading. */
export function introSheetTitle(name: string | null): string {
  return name === null ? 'Intro to them' : `Intro to ${name}`;
}

/**
 * The control that opens the sheet.
 *
 * One function, so the bulletin detail sheet and the person sheet cannot end up offering
 * the same gesture under two different words.
 */
export function requestIntroLabel(name: string | null): string {
  return name === null ? 'Request an intro' : `Request an intro to ${name}`;
}

/** The sheet's submit, naming the person being asked to make the introduction. */
export function askViaLabel(viaName: string | null): string {
  return viaName === null ? 'Ask them to introduce you' : `Ask ${viaName} to introduce you`;
}

/** The requester's own surfaces, while the via has not decided. */
export function introPendingLabel(viaName: string | null): string {
  return viaName === null ? 'Intro pending' : `Intro pending via ${viaName}`;
}

/**
 * What a requester is told when the via declined.
 *
 * ⚠ **No reason, and no re-ask control beside it** — the wire carries no reason because
 * there is none to send (the via's rationale is theirs), and a button here would turn a
 * decline into a prompt. Softening this into "not yet" would be the same mistake with
 * better manners.
 */
export const INTRO_NOT_PASSED_ON_LINE = 'Your ask was not passed on.';

/** What a requester is told once the via passed it on. */
export const INTRO_PASSED_ON_LINE = 'Passed on — they have your note now.';

/**
 * What the *via* reads after deciding, keyed by the decision they made.
 *
 * The inbox row disappears when a decision lands (the re-read finds it decided), and a
 * card that vanishes under the finger, silently, reads as a failure — especially to a
 * screen-reader user, whose focus was on the button that just left the tree. One short
 * sentence in a live region says the decision took.
 */
export const INTRO_DECISION_CONFIRMATION_LINE = {
  pass_on: 'Passed on.',
  decline: 'Declined.',
} as const;

/**
 * The line above the note field, before anything is sent.
 *
 * ⚠ **Load-bearing, not decoration.** Sending an intro request *is* consent to be seen:
 * if the via passes it on, the target is shown the requester's identity and note even
 * when the requester's own `visible_to_distance` would hide them from somebody two hops
 * away. The server does that deliberately; this sentence is where the person doing it
 * finds out first.
 */
export const INTRO_CONSENT_LINE =
  'Asking is consent to be seen. If it is passed on, they see who you are and read your note — even if your own visibility setting would otherwise hide you from them.';

/**
 * The no-candidates state.
 *
 * `intros.viaCandidates` answers an empty list for every reason at once — nobody shared,
 * every intermediate withheld by their own settings, a person who is not there — so this
 * says what the viewer can act on and names no cause.
 */
export const INTRO_NO_CANDIDATES_LINE =
  'Nobody you both know can make this introduction right now.';

/**
 * The two server codes these surfaces can actually provoke, in words.
 *
 * ⚠ `INTRO_UNAVAILABLE` is rendered as the server's own flat sentence and **never
 * elaborated**. It comes back identically for a target at the wrong distance, a via who
 * does not know them, a person who does not exist, an ask already open, a request that
 * is not yours to decide, one already decided, and one whose eligibility lapsed. Any
 * added detail here would be this client inventing the one distinction the server spent
 * its design refusing to make.
 */
const REFUSAL_MESSAGE: Readonly<Record<string, string>> = {
  INTRO_UNAVAILABLE: 'That introduction is not available.',
  INTRO_CONTENT_INVALID: 'The server refused this note’s text. Shorten it and ask again.',
};

/**
 * Read a refused call as something to say.
 *
 * @param code - the application code off the error envelope, or `null` when the failure
 *   was not the server refusing (a dropped connection has no code, and must not be
 *   rendered as one).
 */
export function introRefusalMessage(code: string | null): string {
  if (code === null) {
    return 'That did not send. Try again.';
  }

  return REFUSAL_MESSAGE[code] ?? `The server refused this: ${code}`;
}
