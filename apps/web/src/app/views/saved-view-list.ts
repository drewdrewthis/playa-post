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

/** The bell chip's visible text — the comp's `v.bellLabel`. */
export function bellLabel(notifying: boolean): string {
  return notifying ? '◉ NOTIFY ON' : '○ NOTIFY OFF';
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
