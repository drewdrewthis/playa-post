import type { Actor, AuthenticatedPrincipal } from './actor';

/**
 * Maps a verified auth identity onto the product user it belongs to.
 *
 * ADR-0008 rule 8, expressed as a port so `shared/auth` never depends on the module
 * that answers the question. Implemented by
 * `modules/identity/application/resolve-actor.query.ts` over `app.users`, and wired in
 * `composition/container.ts` — the only two files that need to know which module owns
 * identity.
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
