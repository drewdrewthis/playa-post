import { TRUST_MAX, TRUST_MIN, type Trust } from './connection-trust';
import { TrustOutOfRangeError } from './connection.errors';

/**
 * Accept a submitted number as a {@link Trust}, or refuse it.
 *
 * The **only** constructor of a `Trust`. Everything downstream — the repository, the
 * column's check constraint — takes the branded type, so an unvalidated number cannot
 * reach storage.
 *
 * Integers only. A trust of `72.4` is not a finer-grained opinion, it is a slider
 * reporting its pixel position; `smallint` would round it silently and two clients
 * would disagree about what was stored.
 *
 * @throws {TrustOutOfRangeError} for a non-integer or anything outside
 *   {@link TRUST_MIN}-{@link TRUST_MAX}.
 */
export function validateTrust(value: number): Trust {
  if (!Number.isInteger(value) || value < TRUST_MIN || value > TRUST_MAX) {
    throw new TrustOutOfRangeError();
  }

  return value as Trust;
}
