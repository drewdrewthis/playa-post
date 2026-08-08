import type { PrivacyLimits } from './privacy-limits';

/** One user's limits, and when they last said so. */
export interface PrivacyLimitsAssignment {
  readonly ownerId: string;
  readonly limits: PrivacyLimits;
  readonly assignedAt: Date;
}

/**
 * `app.privacy_settings`, as the domain needs it.
 *
 * ⚠ **Every method is keyed on the owner, and none of them can be written otherwise** —
 * there is no read that takes a viewer, and there must not be. "Would this person see my
 * name" is `app.visible_people`'s question and ADR-0002 §6a says it has exactly one
 * answer; a second read path here would be a second place for that answer to be derived,
 * and the two would eventually disagree.
 */
export interface PrivacyLimitsRepository {
  /**
   * The owner's limits.
   *
   * Returns `null` for a user who has never tightened anything — *not* the permissive
   * default. The absent row and the loosest setting mean the same thing to a viewer, but
   * only the application layer should be substituting one for the other, and it does so
   * in one place (`GetPrivacyLimitsQuery`).
   */
  findOwn(ownerId: string): Promise<PrivacyLimits | null>;

  /** Upsert. An owner has one current policy, not a history of them. */
  set(assignment: PrivacyLimitsAssignment): Promise<void>;
}
