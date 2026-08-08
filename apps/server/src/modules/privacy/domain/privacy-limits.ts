/** The loosest degree the design's picker offers — `UP TO 3RD°`. */
export const DEGREE_MAX = 3;

/** The tightest — `1ST° ONLY`. Zero would hide the viewer from themselves. */
export const DEGREE_MIN = 1;

/** The trust scale, shared with `app.connection_trust` and its check constraint. */
export const TRUST_FLOOR_MIN = 0;
export const TRUST_FLOOR_MAX = 100;

/**
 * One standing limit: who, of the people who can already reach me, may have this.
 *
 * Two independent dimensions, ANDed, because the design's screen offers two rows under
 * one heading and a person outside *either* is outside the limit.
 */
export interface DisclosureLimit {
  /**
   * The owner's **own** directional trust in the viewer, at or above which the limit
   * admits them. `null` is the design's `ANYONE`: no trust requirement at all.
   *
   * ⚠ `null` is not `0`. Unset trust is NULL rather than zero (ADR-0004:70-71), so a
   * floor of `0` still excludes everyone the owner has never rated — `null >= 0` is
   * null. Two different rules, and only one of them is a row on the screen.
   */
  readonly minTrust: number | null;
  /** {@link DEGREE_MIN}-{@link DEGREE_MAX}: how far out the limit still admits. */
  readonly maxDegree: number;
}

/**
 * A user's two standing limits, as the You screen presents them.
 *
 * `name` is "who sees your name" — enforced in `app.visible_people`, which is the one
 * place disclosure is decided (ADR-0002 §6a).
 *
 * ⚠ `note` is "who can pin to your board", and **nothing enforces it in M2**:
 * `app.bulletins` has no recipient column, so no one can pin to anyone's board at all.
 * The stored value therefore cannot be violated; it is recorded now so the migration
 * that gives a bulletin a recipient inherits a real choice instead of defaulting
 * everyone to open. That migration owes the enforcement point.
 */
export interface PrivacyLimits {
  readonly name: DisclosureLimit;
  readonly note: DisclosureLimit;
}

/**
 * What a user who has never opened the screen has.
 *
 * ⚠ **Absence of a row means exactly this, and `app.visible_people` says so in SQL**
 * (`coalesce(limits.name_max_degree, 3)` and `limits.name_min_trust is null`) rather
 * than relying on a backfill. Both spellings have to agree or the privacy of a user who
 * never chose would depend on whether a row happened to exist.
 *
 * Permissive rather than the demo's `TRUST 50+ / UP TO 2ND°`: real trust defaults to
 * unset, so shipping the demo's value as the product default would withhold every name
 * from every viewer on day one. See the module README.
 */
export const PERMISSIVE_LIMITS: PrivacyLimits = {
  name: { minTrust: null, maxDegree: DEGREE_MAX },
  note: { minTrust: null, maxDegree: DEGREE_MAX },
};
