import type { Actor, AuthenticatedPrincipal } from '../../../shared/auth/actor';
import type { ActorResolver } from '../../../shared/auth/actor-resolver';
import { isActorEligible } from '../domain/user';
import type { UserRepository } from '../domain/user.repository';

/** Collaborators, injected rather than resolved (addendum §12, ADR-0003). */
export interface ResolveActorDependencies {
  readonly users: UserRepository;
}

/**
 * The real {@link ActorResolver} — ADR-0008 rule 8, ADR-0011 Verification rows 3-4.
 *
 * Replaces `createNoOnboardedUsersResolver`, which was a true statement about a
 * schema with no `app.users` and is deleted in the same change. Wired once into the
 * container, called once per request by `authenticateRequest`, and the only place the
 * `auth_user_id → app.users.id` hop happens.
 *
 * **One answer for four situations.** No row, `deactivated`, `suspended`, `erased` —
 * and anything unrecognised — all return `null`, which the transport renders as 403
 * `ONBOARDING_REQUIRED`. Distinguishing them would tell a caller about an account
 * state that is the account holder's private business (ADR-0002 §10), and failing
 * closed on an unknown status is what keeps a future lifecycle state from silently
 * becoming "allowed" (ADR-0002 B11).
 *
 * A verified token is a prerequisite, never re-checked here: this receives a
 * {@link AuthenticatedPrincipal} and never a token.
 */
export function createResolveActorQuery(dependencies: ResolveActorDependencies): ActorResolver {
  return {
    async resolve(principal: AuthenticatedPrincipal): Promise<Actor | null> {
      const user = await dependencies.users.findByAuthUserId(principal.authUserId);

      if (user === null || !isActorEligible(user)) {
        return null;
      }

      return { userId: user.id, handle: user.handle };
    },
  };
}
