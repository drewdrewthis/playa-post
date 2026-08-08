import type { PrivacyLimits } from '../domain/privacy-limits';

/** One limit as this API renders one. */
export interface PresentedDisclosureLimit {
  /** `null` is the design's `ANYONE` — no trust requirement. Not `0` (M2-AC4). */
  readonly minTrust: number | null;
  readonly maxDegree: number;
}

/**
 * The caller's two limits, **for the caller and nobody else**.
 *
 * ⚠ Not a general privacy projection. There is no version of this that renders another
 * person's limits, and there must not be: `name.minTrust` is a threshold on the owner's
 * own directional trust, so telling a viewer what it is would let them read a trust value
 * ADR-0002 B6 keeps inside its holder. The one bit a viewer legitimately learns is
 * whether they cleared it, and they learn that from whether a name arrived — which
 * `app.visible_people` decides.
 */
export interface PresentedPrivacyLimits {
  readonly name: PresentedDisclosureLimit;
  readonly note: PresentedDisclosureLimit;
}

/** Project the limits for the owner reading them. */
export function presentPrivacyLimits(limits: PrivacyLimits): PresentedPrivacyLimits {
  return {
    name: { minTrust: limits.name.minTrust, maxDegree: limits.name.maxDegree },
    note: { minTrust: limits.note.minTrust, maxDegree: limits.note.maxDegree },
  };
}
