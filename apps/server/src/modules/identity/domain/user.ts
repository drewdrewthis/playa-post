import type { VisibleToDistance } from './visible-to-distance';

/**
 * The lifecycle states ADR-0008's table names.
 *
 * A frozen object rather than a bare union so the values have one home and a
 * comparison cannot be written against a typo'd literal.
 */
export const USER_STATUS = {
  /** Normal. The only state that can act. */
  active: 'active',
  /** User-initiated and reversible; sign-in restores it. */
  deactivated: 'deactivated',
  /** Operator action (PDF §5). */
  suspended: 'suspended',
  /** GDPR erasure, irreversible. The row survives as a tombstone. */
  erased: 'erased',
} as const;

/** One of {@link USER_STATUS}'s values. */
export type UserStatus = (typeof USER_STATUS)[keyof typeof USER_STATUS];

/**
 * A product user, as `app.users` stores one (ADR-0008:22-34).
 *
 * `id` is the internal identifier every product foreign key points at (rule 1);
 * `authUserId` is the only bridge to Supabase Auth (rule 2). There is no email here
 * and there never will be (rule 3).
 */
export interface User {
  /** `app.users.id` — internal, immutable, never reused. */
  readonly id: string;
  /** `auth.users.id`. Never use it as a product identifier. */
  readonly authUserId: string;
  /** Chosen at onboarding and immutable in v1 (rule 4). */
  readonly handle: string;
  readonly displayName: string;
  /** Private storage bucket key. Never a public URL. */
  readonly avatarPath: string | null;
  /**
   * Typed as `string`, not {@link UserStatus}, on purpose.
   *
   * The column is `text` with no check constraint, so an unrecognised value is
   * reachable — and narrowing it in the mapper would mean either an unchecked cast or
   * a throw that turns one bad row into a 500. Leaving it wide lets
   * {@link isActorEligible} fail **closed** on anything it does not recognise, which
   * is the behaviour ADR-0002 B11 wants from a state it has never seen.
   */
  readonly status: string;
  /**
   * How far away somebody may stand and still see this user at all.
   *
   * Narrowed here, unlike {@link User.status}, because {@link toVisibleToDistance}
   * fails closed on an unrecognised value rather than throwing — so the narrowing costs
   * nothing and buys exhaustiveness at every call site.
   */
  readonly visibleToDistance: VisibleToDistance;
  readonly createdAt: Date;
  readonly deactivatedAt: Date | null;
  readonly erasedAt: Date | null;
  /** Optimistic-concurrency counter (ADR-0005). */
  readonly version: number;
}

/**
 * May this user be resolved into an `Actor` for a request?
 *
 * ADR-0008 rule 8 and the lifecycle table: only `active` may act. `deactivated`,
 * `suspended`, `erased`, and anything unrecognised all mean "there is no actor" —
 * one answer, because the differences are the user's private business and not
 * something a caller should be able to read off a response (ADR-0002 §10).
 */
export function isActorEligible(user: User): boolean {
  return user.status === USER_STATUS.active;
}
