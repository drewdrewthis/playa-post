import { BulletinExpiryInvalidError } from './bulletin.errors';

/**
 * Accept a submitted expiry, or refuse it.
 *
 * **The only rule is that an expiry must be in the future when it is set.** A bulletin
 * created already expired would be written, emit its `BulletinCreated` event, notify
 * everyone whose saved query matches it — and then be invisible on every board,
 * including its author's own. That is indistinguishable from a bug from the outside, so
 * it is refused at the boundary instead of being stored and quietly ignored.
 *
 * ⚠ There is deliberately **no maximum horizon**. The prototype offers 24h / 3 days /
 * 1 week as *presets*, not as a closed vocabulary, and enforcing a ceiling here would
 * make the three chips a wire contract that a fourth preset breaks. Retention is
 * ADR-0006's job, and expiry is the author's statement about their own bulletin.
 *
 * @param expiresAt - The submitted moment, or `undefined`/`null` for a bulletin that
 *   never expires — which is the default, and is why absence is not an error.
 * @param now - The clock, passed in rather than read, so the boundary case ("expiring
 *   exactly now") is a test rather than a race.
 * @returns The expiry to store, or `null` when the bulletin never expires.
 * @throws {BulletinExpiryInvalidError} when the moment has already passed.
 */
export function validateBulletinExpiry(
  expiresAt: Date | null | undefined,
  now: Date,
): Date | null {
  if (expiresAt === undefined || expiresAt === null) {
    return null;
  }

  // `<=`, so an expiry of exactly `now` is refused: a bulletin whose visibility
  // predicate (`expires_at > now()`) is already false the instant it commits is the
  // very state this policy exists to prevent.
  if (expiresAt.getTime() <= now.getTime()) {
    throw new BulletinExpiryInvalidError();
  }

  return expiresAt;
}
