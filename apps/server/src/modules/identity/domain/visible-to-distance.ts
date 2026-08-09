/**
 * How far away somebody may stand and still see that you exist.
 *
 * ⚠ **"Who can see you at all", not "who sees your name".** Past this limit you are not
 * an unnamed node on the other person's graph — you are not on it. `app.visible_people`
 * enforces that by not emitting a row, which is why the setting is meaningful even
 * though ADR-0004 decision 4's ghost surrogate IDs are not built: there is no ghost to
 * correlate.
 *
 * Declared here rather than imported from `@playa-post/contracts` because no module
 * under `apps/server/src/modules/` imports that package — the client contract and the
 * domain vocabulary are allowed to agree without one owning the other, and
 * `visibility.input.ts` is the single place the two are checked against each other.
 *
 * Ordered least-permissive first, which is the order the You screen's dial cycles.
 */
export const VISIBLE_TO_DISTANCE = {
  /** Only people directly connected to you. */
  first: 'first',
  second: 'second',
  third: 'third',
  /** The whole small world — six degrees of separation, the scale's ceiling. */
  sixth: 'sixth',
} as const;

/** One of {@link VISIBLE_TO_DISTANCE}'s values. */
export type VisibleToDistance = (typeof VISIBLE_TO_DISTANCE)[keyof typeof VISIBLE_TO_DISTANCE];

/**
 * Narrow a stored value, failing **closed**.
 *
 * The column is `text` with a check constraint, but a future migration widening that
 * constraint would reach this code before anyone updated it. An unrecognised value
 * therefore reads as `first` — the most private setting — matching the identical
 * fail-closed `case` inside `app.visible_people`. A privacy setting whose unknown state
 * is "visible to everybody" fails in the one direction that matters.
 */
export function toVisibleToDistance(stored: string): VisibleToDistance {
  // Object.hasOwn, not `in`: `in` also matches Object.prototype members, so a stored
  // value of 'constructor' would defeat the narrowing instead of failing closed.
  return Object.hasOwn(VISIBLE_TO_DISTANCE, stored)
    ? VISIBLE_TO_DISTANCE[stored as VisibleToDistance]
    : VISIBLE_TO_DISTANCE.first;
}
