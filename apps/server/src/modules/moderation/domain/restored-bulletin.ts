/**
 * One bulletin one viewer has taken back out of their Dismissed category (#170).
 *
 * The mirror of {@link import('./hidden-bulletin').HiddenBulletin}, and deliberately one
 * field shorter. A hide has a moment — `hiddenAt`, the row's `created_at`, which a repeat
 * returns unchanged so a replay looks like the replay it is. A restore has no moment to
 * report: the row is gone, so there is nothing left holding a timestamp, and a
 * `restoredAt` minted here would be a fact about when the server ran rather than about
 * anything stored. A field nothing reads is a field every log and offline mirror on the
 * way back would carry anyway.
 *
 * ⚠ **There is no "was it actually dismissed" flag, and there must not be one.**
 * Un-dismissing something never dismissed converges rather than failing, so the two cases
 * are one outcome; a flag distinguishing them would be a difference a client could render,
 * and the only honest thing to render is that the bulletin is back.
 */
export interface RestoredBulletin {
  readonly bulletinId: string;
  /** The person whose board it returns to. Nobody else is affected. */
  readonly viewerId: string;
}
