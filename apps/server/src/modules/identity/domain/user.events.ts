import type { User } from './user';

/** Event type name. Stable — it is what a consumer subscribes to. */
export const USER_ONBOARDED = 'identity.user-onboarded';

/**
 * A person finished onboarding: they now have an `app.users` row and a handle.
 *
 * Carries **`userId` and `handle` only**. `displayName` is personal data and an
 * outbox row is a durable, widely-read log; the addendum's redaction rules (M1-AC11)
 * are about the same hazard one layer up. A consumer that needs the display name
 * reads it under its own authorization rules, projected through ADR-0002 §6a.
 *
 * Returned by {@link import('../application/complete-onboarding.service').CompleteOnboardingService}
 * rather than published: `app.outbox_events` does not exist until lane L2's migration,
 * and writing to a table that is not there yet is not a seam, it is a bug. The caller
 * that persists this in the same transaction as the insert is M2.14's drainer work.
 */
export interface UserOnboarded {
  readonly type: typeof USER_ONBOARDED;
  readonly occurredAt: Date;
  readonly userId: string;
  readonly handle: string;
}

/** Build the event for a user who has just been written. */
export function userOnboarded(user: User): UserOnboarded {
  return {
    type: USER_ONBOARDED,
    occurredAt: user.createdAt,
    userId: user.id,
    handle: user.handle,
  };
}
