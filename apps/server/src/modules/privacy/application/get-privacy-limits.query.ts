import { PERMISSIVE_LIMITS, type PrivacyLimits } from '../domain/privacy-limits';
import type { PrivacyLimitsRepository } from '../domain/privacy-limits.repository';

/** Whose limits. `actorId` comes from the resolved `Actor`, never the request body. */
export interface GetPrivacyLimitsCommand {
  readonly actorId: string;
}

export interface GetPrivacyLimitsQuery {
  get(command: GetPrivacyLimitsCommand): Promise<PrivacyLimits>;
}

/** Collaborators, injected rather than resolved (addendum §12, ADR-0003). */
export interface GetPrivacyLimitsDependencies {
  readonly limits: PrivacyLimitsRepository;
}

/**
 * The caller's own two limits (You screen, issue #49).
 *
 * **The absent row becomes {@link PERMISSIVE_LIMITS} here, and only here.** Most users
 * have no row — one is written the first time they tighten something — and the screen
 * still has to render two pickers with a current value in each. Substituting the default
 * at the read is what lets the repository keep "no row" honest and keeps the client from
 * having to know that absence is a state at all.
 *
 * ⚠ That substitution has to agree with `app.visible_people`'s SQL, which spells the same
 * default out as `coalesce(limits.name_max_degree, 3)` / `limits.name_min_trust is null`.
 * If they ever disagreed, the screen would show one policy while the database enforced
 * another. `privacy-limits.integration.test.ts` pins them against each other.
 *
 * No authorization branch: the only readable limits are the caller's own, because
 * `actorId` is the only identifier this query accepts.
 */
export function createGetPrivacyLimitsQuery(
  dependencies: GetPrivacyLimitsDependencies,
): GetPrivacyLimitsQuery {
  return {
    async get(command: GetPrivacyLimitsCommand): Promise<PrivacyLimits> {
      return (await dependencies.limits.findOwn(command.actorId)) ?? PERMISSIVE_LIMITS;
    },
  };
}
