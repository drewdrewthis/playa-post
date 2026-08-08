/**
 * One standing limit: who, of the people who can already reach you, gets this.
 *
 * Two dimensions, ANDed — a person outside either is outside the limit. The You screen
 * draws them as two rows under one heading.
 */
export interface DisclosureLimit {
  /**
   * The trust floor, expressed in the owner's **own** directional trust in the viewer.
   *
   * `null` is the screen's `ANYONE`: no trust requirement at all. It is **not** `0` — a
   * floor of zero still excludes everyone the owner has never rated, because unset trust
   * is `null` and `null >= 0` is not true. A client that collapses the two into one
   * falsy branch has changed the user's rule.
   */
  readonly minTrust: number | null;
  /** `1`-`3`: the screen's `1ST° ONLY` … `UP TO 3RD°`. */
  readonly maxDegree: number;
}

/**
 * `privacy.getLimits` output and `privacy.setLimits` input/output — the caller's own two
 * limits, and never anybody else's.
 *
 * `name` is "who sees your name", enforced server-side wherever a person is projected.
 *
 * ⚠ `note` is "who can pin to your board" and **nothing enforces it yet**: a bulletin has
 * no recipient, so nobody can pin to any board at all. The value is stored so the feature
 * that adds addressed bulletins inherits a real choice rather than defaulting everyone to
 * open. A client may present it as a live setting — it is one, it just currently
 * constrains a capability nobody has.
 */
export interface PrivacyLimits {
  readonly name: DisclosureLimit;
  readonly note: DisclosureLimit;
}
