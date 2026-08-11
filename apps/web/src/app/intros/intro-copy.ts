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
 * What the **target** reads after answering an introduction, keyed by their answer (#166).
 *
 * Its own map rather than two more keys on the one above, because the two actors' answers
 * mean different things and share only the word "decline" — and because a single map
 * keyed by four strings is one rename away from putting a via's confirmation on a
 * target's row.
 *
 * ⚠ **The acceptance line does not claim the connection has already happened.** It has
 * not: the server records the answer and forms the edge from it moments later (decision
 * D12), so "you are now connected" would be false for as long as it takes and would send
 * somebody to a graph that has not caught up. Saying what is about to happen costs
 * nothing and is true when it is read.
 *
 * ⚠ **The decline line says who is told, because the answer is nobody.** That is the
 * whole reason declining is safe — the requester cannot tell a refusal from an
 * introduction nobody has opened — and somebody deciding whether to press it is exactly
 * who needs to know.
 */
export const INTRO_RESPONSE_CONFIRMATION_LINE = {
  accept: 'Accepted — you are being connected. They will appear on your graph shortly.',
  decline: 'Declined. Nobody is told, and nothing is connected.',
} as const;

/** The target's accept control. */
export const INTRO_ACCEPT_LABEL = 'Accept';

/** The target's decline control. */
export const INTRO_TARGET_DECLINE_LABEL = 'Not now';

/**
 * The line above the target's two controls, before either is pressed.
 *
 * ⚠ **Load-bearing, and the second sentence more than the first.** An introduction
 * arrives from somebody the reader knows, about somebody they do not, and the pressure to
 * be polite is the thing that makes an intro product turn into an obligation. Saying
 * plainly that a refusal reaches nobody is what makes "no" a real option — the same
 * property `INTRO_CONSENT_LINE` states from the other end, where saying yes is what the
 * reader has to understand before they act.
 */
export const INTRO_ANSWER_LINE =
  'Accepting connects you. Declining tells nobody — not them, and not whoever passed it on.';

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
 * The label on the via's own note field, naming who will read it.
 *
 * "for {name}" rather than "about {name}": the note goes *to* the target, and a via who
 * thinks they are annotating the requester for the app's benefit writes a different — and
 * more careless — sentence than one who knows the person they are vouching to will read
 * it word for word.
 */
export function viaNoteLabel(targetName: string | null): string {
  return targetName === null ? 'Add your own note for them' : `Add your own note for ${targetName}`;
}

/**
 * The line above that field.
 *
 * ⚠ **It says the note is required before the button says so.** The rule is the product
 * decision behind #175 — passing an intro on is a vouch, not a forward — and a person who
 * meets it first as a disabled submit reads it as a bug in the app rather than as a thing
 * being asked of them.
 */
export const INTRO_VIA_NOTE_LINE =
  'Passing this on means putting your name to it, so a note of your own is required. Say why you think they should meet — they will read it beside the note you were sent.';

/** The via's submit, once the note field is open. */
export const PASS_ON_WITH_NOTE_LABEL = 'Pass on with your note';

/**
 * What follows the via's card, above their half of an introduction.
 *
 * Its own lede rather than a clause hung off the requester's, because the two notes have
 * two authors and this line is what makes the second one attributable. It names the act
 * and nothing else: anything warmer would put the app's opinion in the via's mouth
 * alongside the words they actually wrote.
 */
export const INTRO_VOUCHED_LINE = 'passed it on:';

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
 * The three server codes these surfaces can actually provoke, in words.
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
  /*
   * Reachable only from a client that got the wire shape wrong — the decline control
   * sends no note and `DecideIntroRequest`'s union will not let it — so this is a
   * developer's mistake surfacing where a user can see it. It says what happened rather
   * than apologising, because there is nothing for the reader to do about it.
   */
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
