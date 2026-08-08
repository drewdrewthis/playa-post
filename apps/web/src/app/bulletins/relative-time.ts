/**
 * Age and countdown, in the comp's two-tier shorthand.
 *
 * `design/Playa Post.dc.html` writes a bulletin's age as `2h`, `5h`, `1d`, `3d` — whole
 * hours under a day, whole days above it, no "ago" suffix and no minute granularity.
 * The prototype ships those as literal strings in its seed data and never computes one,
 * so the format is product evidence and the arithmetic below is this app's.
 *
 * Pure, and taking `now` as an argument rather than reading the clock: a formatter that
 * reads the clock cannot be tested at a boundary, and every boundary here (the hour
 * mark, the day mark, a timestamp in the future) is a place this kind of code goes
 * wrong.
 */

const MILLISECONDS_PER_HOUR = 3_600_000;
const HOURS_PER_DAY = 24;

/**
 * Whole hours from one instant to another, floored.
 *
 * ⚠ Directional, and `Math.floor` is not symmetric about zero — `floor(-2.5)` is `-3`,
 * not `-2`. The two callers therefore pass their instants in opposite orders rather
 * than negating one result.
 */
function wholeHoursBetween(fromMilliseconds: number, toMilliseconds: number): number {
  return Math.floor((toMilliseconds - fromMilliseconds) / MILLISECONDS_PER_HOUR);
}

/** Whole hours, or whole days once there are at least 24 of them. */
function shorthand(hours: number): string {
  return hours < HOURS_PER_DAY
    ? `${String(hours)}h`
    : `${String(Math.floor(hours / HOURS_PER_DAY))}d`;
}

/**
 * How long ago `iso` was — `2h`, `3d`, or `now`.
 *
 * `now` covers everything under an hour, *including* a timestamp in the future: a
 * device clock and a server clock disagree by seconds routinely, and "-1h" on a card
 * reads as a bug in a way "now" does not. It is also the only state below the comp's
 * smallest unit — adding a minutes tier would invent a granularity the design does not
 * have, and "0h" reads as broken.
 *
 * @param iso - An ISO-8601 instant. An offset (`-07:00`) is read as written.
 * @param now - The moment to measure against.
 * @returns The shorthand, or `null` when `iso` is unparseable — render nothing at all
 *   for `null`, never a placeholder.
 */
export function relativeTime(iso: string, now: Date): string | null {
  const instant = Date.parse(iso);

  if (Number.isNaN(instant)) {
    return null;
  }

  const hours = wholeHoursBetween(instant, now.getTime());

  return hours < 1 ? 'now' : shorthand(hours);
}

/**
 * How long until `iso` — `2h`, `3d`, or `<1h`.
 *
 * The countdown half of {@link relativeTime}, for `expiresAt`. It reads `<1h` rather
 * than `now` under the hour, because "now" said of something still to come says the
 * opposite of what is true.
 *
 * @param iso - An ISO-8601 instant, expected to be in the future.
 * @param now - The moment to measure from.
 * @returns The shorthand, or `null` when `iso` is unparseable **or already past**.
 *   `VisibleBulletin.expiresAt` is always in the future, so a past one is clock skew,
 *   and no countdown is better than a wrong one.
 */
export function timeUntil(iso: string, now: Date): string | null {
  const instant = Date.parse(iso);

  if (Number.isNaN(instant)) {
    return null;
  }

  const hours = wholeHoursBetween(now.getTime(), instant);

  if (hours < 0) {
    return null;
  }

  return hours < 1 ? '<1h' : shorthand(hours);
}
