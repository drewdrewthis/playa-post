import {
  DEGREE_MAX,
  DEGREE_MIN,
  TRUST_FLOOR_MAX,
  TRUST_FLOOR_MIN,
  type DisclosureLimit,
  type PrivacyLimits,
} from './privacy-limits';
import { PrivacyLimitOutOfRangeError } from './privacy.errors';

/** A limit as it arrives, before anything has vouched for the numbers in it. */
export interface SubmittedDisclosureLimit {
  readonly minTrust: number | null;
  readonly maxDegree: number;
}

/** Both limits as they arrive. */
export interface SubmittedPrivacyLimits {
  readonly name: SubmittedDisclosureLimit;
  readonly note: SubmittedDisclosureLimit;
}

function validateLimit(limit: SubmittedDisclosureLimit, label: string): DisclosureLimit {
  // `null` short-circuits before any comparison. Folding it into the range check as
  // `(limit.minTrust ?? 0)` would make ANYONE and a floor of zero the same value, which
  // is the one distinction this type exists to keep.
  if (
    limit.minTrust !== null &&
    (!Number.isInteger(limit.minTrust) ||
      limit.minTrust < TRUST_FLOOR_MIN ||
      limit.minTrust > TRUST_FLOOR_MAX)
  ) {
    throw new PrivacyLimitOutOfRangeError(
      `${label} trust floor must be null or an integer ${TRUST_FLOOR_MIN}-${TRUST_FLOOR_MAX}`,
    );
  }

  if (
    !Number.isInteger(limit.maxDegree) ||
    limit.maxDegree < DEGREE_MIN ||
    limit.maxDegree > DEGREE_MAX
  ) {
    throw new PrivacyLimitOutOfRangeError(
      `${label} degree limit must be an integer ${DEGREE_MIN}-${DEGREE_MAX}`,
    );
  }

  return { minTrust: limit.minTrust, maxDegree: limit.maxDegree };
}

/**
 * Accept submitted limits, or refuse them.
 *
 * The **only** constructor of {@link PrivacyLimits}. The repository takes this type, so
 * an unvalidated number cannot reach the column's check constraint — where it would
 * surface as a driver-level 500 instead of the stable `PRIVACY_LIMIT_OUT_OF_RANGE`
 * M2-AC18 asks for.
 *
 * Both halves go through the same rule. The stored vocabulary is deliberately wider than
 * the three choices the picker offers: the option list is a UI decision, and pinning it
 * here would make the next design iteration a migration.
 *
 * @throws {PrivacyLimitOutOfRangeError} for a non-integer or an out-of-range value in
 *   either limit.
 */
export function validatePrivacyLimits(submitted: SubmittedPrivacyLimits): PrivacyLimits {
  return {
    name: validateLimit(submitted.name, 'name'),
    note: validateLimit(submitted.note, 'note'),
  };
}
