/**
 * The Saved screen's copy and small decisions, as functions (issue #45).
 *
 * Everything here is pure, so the parts of this screen worth being sure about are
 * testable without a browser — the same split `board-query.ts` makes for the board. The
 * `.tsx` beside it renders; nothing in it decides.
 *
 * Copy is lifted from `design/Playa Post.dc.html` lines 123-139 verbatim, glyphs
 * included. Where the comp and grammatical instinct disagree — "3 match now" rather than
 * "3 matches now" — the comp wins: it is the owner-mandated design SSOT, and a card that
 * reads differently from the mock is a difference somebody has to notice and re-ratify.
 */

import { applicationErrorCode } from '../api/client';

/**
 * How much of a query the comp keeps when it seeds a name from it.
 *
 * The comp's `saveQuery`: `fullQ.length > 26 ? fullQ.slice(0, 26) + '…' : fullQ`.
 */
export const SAVED_VIEW_NAME_SEED_MAX_LENGTH = 26;

/**
 * The name the board's "Save as view" proposes for a query.
 *
 * A *seed*, not a rule: the server bounds a name at 80 characters, and a rename may use
 * all of them. This is only what a person gets if they save without choosing.
 */
export function seedSavedViewName(query: string): string {
  return query.length > SAVED_VIEW_NAME_SEED_MAX_LENGTH
    ? `${query.slice(0, SAVED_VIEW_NAME_SEED_MAX_LENGTH)}…`
    : query;
}

/**
 * The card's "N match now" line.
 *
 * @param count - What `bulletins.board` answered for this view's query, or `null` while
 *   that is unknown — still loading, or refused.
 * @returns `null` for an unknown count. Rendering nothing is the honest state: a `0`
 *   shown before the answer arrives tells somebody their view stopped matching.
 */
export function matchNowLabel(count: number | null): string | null {
  return count === null ? null : `${String(count)} match now`;
}

/** What the card shows in place of a count the server refused to give. */
export const MATCH_COUNT_UNAVAILABLE_LABEL = 'Count unavailable';

/** The bell chip's visible text — the comp's `v.bellLabel`. */
export function bellLabel(notifying: boolean): string {
  return notifying ? '◉ NOTIFY ON' : '○ NOTIFY OFF';
}

/**
 * The bell's accessible name.
 *
 * ⚠ **It names the view and deliberately does not change with the state.** A screen can
 * hold two dozen of these; without the name, a screen-reader user hears the identical
 * "NOTIFY OFF, toggle button" once per card with nothing to tell them apart. `aria-pressed` carries lit-ness — which is why this string must not
 * also carry it: a toggle whose *name* changes when it is pressed reads as a different
 * control each time, and the visible label already says which state it is in.
 *
 * The name matters more under D16 than it did under D1: several bells may be lit at once,
 * so "the lit one" is no longer a thing a listener can hold in their head.
 */
export function bellActionLabel(name: string): string {
  return `Notify me about ${name}`;
}

/**
 * What to say after the bell is tapped — the comp's two `say` lines.
 *
 * @param notifying - The state the bell has just moved *to*.
 */
export function notifyToast(notifying: boolean, name: string): string {
  return notifying ? 'You’ll hear when new bulletins match' : `Notifications off for ${name}`;
}

/**
 * The delete control's accessible name.
 *
 * ⚠ It says the second thing deleting does when that thing applies. The comp's DELETE is
 * a bare tap with no confirmation, which is right for a list somebody curates — but a
 * view carrying the Notify Me designation also carries the only switch that turns those
 * notifications off, so removing it silently ends them. Naming that in the control is
 * the smallest honest warning; a confirmation dialog would be a deviation from the comp.
 */
export function deleteActionLabel(name: string, notifying: boolean): string {
  return notifying
    ? `Delete ${name}, which also switches its notifications off`
    : `Delete ${name}`;
}

/**
 * The refusals of `views.saved.save` whose remedy is the person's own.
 *
 * ⚠ **Codes, not messages.** Each of these errors is constructed with a sentence that
 * already names the remedy — "Delete one to save another", the bound a name must fit,
 * the token the grammar refused — so the server's own message is passed through rather
 * than restated here. That is `boardErrorMessage`'s rule for `INVALID_BOARD_QUERY`
 * applied to the other two, and it is safe for exactly the reason those errors document:
 * none of them echoes the input, so none can carry user text onto the screen or into a
 * log (`views/domain/saved-view.errors.ts`).
 *
 * `SAVED_VIEW_CONFLICT` and `SAVED_VIEW_UNAVAILABLE` are absent on purpose: neither is
 * reachable from a *save*, which names no existing view.
 */
const SAVE_REFUSAL_CODES: readonly string[] = [
  'SAVED_VIEW_LIMIT_REACHED',
  'SAVED_VIEW_NAME_INVALID',
  'INVALID_BOARD_QUERY',
];

/**
 * What to tell someone whose "Save as view" did not take.
 *
 * ⚠ **A refusal must not be dressed as a connectivity problem.** Someone at the saved-view
 * cap who is told to check their connection will retry, and the retry fails identically
 * forever — the one thing they could have done instead (delete a view) is the thing the
 * server said and this screen threw away.
 *
 * @param error - Whatever the mutation rejected with: a tRPC envelope, or a transport
 *   failure with no envelope at all.
 */
export function saveViewFailureMessage(error: unknown): string {
  const code = applicationErrorCode(error);

  // No envelope means the request never got an answer — the only failure where "check
  // your connection" is the true and useful thing to say.
  return code !== null && SAVE_REFUSAL_CODES.includes(code) && error instanceof Error
    ? error.message
    : 'That view could not be saved. Check your connection and try again.';
}

/**
 * The refusals of `views.saved.setNotify` whose remedy is the person's own.
 *
 * One code, and it arrived with decision D16: switching a bell *on* can now be refused,
 * because several may be lit at once and the number the notification evaluator will read
 * per bulletin has to be bounded somewhere. `SAVED_VIEW_UNAVAILABLE` is deliberately
 * absent — a card whose view has been deleted elsewhere is not something the person can
 * fix by reading a sentence, and the refetch that follows removes the card anyway.
 */
const SET_NOTIFY_REFUSAL_CODES: readonly string[] = ['NOTIFY_ME_QUERY_LIMIT_REACHED'];

/**
 * What to tell someone whose bell tap did not take.
 *
 * ⚠ **A refusal must not be dressed as a connectivity problem** — `saveViewFailureMessage`'s
 * rule, and it bites harder here: somebody at the notification cap who is told to check
 * their connection will tap again, and the tap fails identically forever, while the one
 * thing that would work (switching another bell off) is what the server said and this
 * screen threw away.
 *
 * The server's own message is passed through rather than restated, which is safe for the
 * reason the error documents: it names the bound and echoes none of the person's input
 * (`views/domain/notify-me-query.errors.ts`).
 *
 * @param error - Whatever the mutation rejected with: a tRPC envelope, or a transport
 *   failure with no envelope at all.
 * @param name - The view whose bell was tapped, for the connectivity message that has to
 *   say which of two dozen identical controls did not register.
 */
export function setNotifyFailureMessage(error: unknown, name: string): string {
  const code = applicationErrorCode(error);

  return code !== null && SET_NOTIFY_REFUSAL_CODES.includes(code) && error instanceof Error
    ? error.message
    : `Notifications for ${name} could not be changed. Check your connection and try again.`;
}
