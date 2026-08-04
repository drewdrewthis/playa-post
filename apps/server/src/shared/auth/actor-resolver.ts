import type { Actor, AuthenticatedPrincipal } from './actor';

/**
 * Maps a verified auth identity onto the product user it belongs to.
 *
 * ADR-0008 rule 8, expressed as a port so the auth boundary can be complete before
 * `modules/identity` exists. Lane L0 ships this interface and the context that calls
 * it; **lane L1 implements it** as `modules/identity/application/resolve-actor.query.ts`
 * over `app.users`, and composition swaps the implementation in with no change to any
 * caller.
 *
 * The implementation owns the whole "is this user allowed to be here" question:
 *
 * - no `app.users` row for this `auth_user_id` → **`null`** (onboarding incomplete);
 * - `status` is `erased` or `suspended` → **`null`** (ADR-0008 rule 8 says reject, and
 *   an erased user must fail closed everywhere — ADR-0002 B11);
 * - `deactivated` → **`null`** while deactivated; sign-in restores the row's status
 *   first (ADR-0008 lifecycle table).
 *
 * Returning `null` for all of them rather than distinguishing them is deliberate:
 * every one of those states means "there is no actor", and the differences are the
 * user's private business, not something the transport layer should be able to
 * report back (ADR-0002 §10).
 */
export interface ActorResolver {
  /**
   * @param principal - A verified auth identity. Verification has already happened;
   *   an implementation must never re-check a token, and never receives one.
   * @returns the onboarded {@link Actor}, or `null` when this auth identity has no
   *   usable product user.
   */
  resolve(principal: AuthenticatedPrincipal): Promise<Actor | null>;
}
