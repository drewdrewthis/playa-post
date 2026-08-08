/**
 * The two privacy rows' pickers, as the comp draws them.
 *
 * ⚠ **The option lists live here, not in the contract.** `privacy.setLimits` accepts any
 * 0-100 floor and any 1-3 degree; these three-a-piece are the choices *this client*
 * offers, which is a design decision and belongs on the client. Pinning them
 * server-side would make the next design iteration a migration.
 */

/** The comp's `trustOpts`, as values. `null` is `ANYONE`. */
export const TRUST_CHOICES: readonly (number | null)[] = [null, 50, 75];

/** The comp's `distOpts`, as values, loosest first. */
export const DEGREE_CHOICES: readonly number[] = [3, 2, 1];

/** The loosest degree, and therefore where the cycle wraps to. */
const WIDEST_DEGREE = 3;

/**
 * What a trust floor reads as.
 *
 * ⚠ `null` and `0` never share a label. `null` asks nothing of anybody; `0` is a floor
 * the owner chose, and it still excludes everyone they have never rated — because unset
 * trust is `null`, not zero. Collapsing them would tell a user their rule is the opposite
 * of what the server will enforce.
 */
export function trustFloorLabel(minTrust: number | null): string {
  return minTrust === null ? 'ANYONE' : `TRUST ${String(minTrust)}+`;
}

/** What a degree limit reads as — the comp's `UP TO 3RD°` / `UP TO 2ND°` / `1ST° ONLY`. */
export function degreeLabel(maxDegree: number): string {
  if (maxDegree <= 1) {
    return '1ST° ONLY';
  }

  return maxDegree === 2 ? 'UP TO 2ND°' : 'UP TO 3RD°';
}

/**
 * The next floor a tap produces: **the tightest option looser than none, moving tighter,
 * wrapping to `ANYONE` at the top.**
 *
 * Stated as "the smallest choice strictly greater than the current value" rather than as
 * an index cycle, which is the same thing for the three values the picker produces and is
 * also right for a value it cannot — 60 advances to 75 rather than jumping to `ANYONE`.
 * An index cycle would not find 60 at all and would have to guess, and every available
 * guess loosens somebody's privacy without them asking.
 */
export function nextTrustFloor(minTrust: number | null): number | null {
  const tighter = TRUST_CHOICES.filter(
    (choice): choice is number => choice !== null && (minTrust === null || choice > minTrust),
  );

  return tighter.length === 0 ? null : Math.min(...tighter);
}

/**
 * The next degree a tap produces: tighter each time, wrapping to the widest.
 *
 * The mirror of {@link nextTrustFloor} — tighter means a *smaller* degree — so the same
 * "strictly tighter, else wrap" rule reads as a maximum here rather than a minimum.
 */
export function nextDegree(maxDegree: number): number {
  const tighter = DEGREE_CHOICES.filter((choice) => choice < maxDegree);

  return tighter.length === 0 ? WIDEST_DEGREE : Math.max(...tighter);
}
