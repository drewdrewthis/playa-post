import type { ActorResolver } from './actor-resolver';

/**
 * The {@link ActorResolver} in force until `app.users` exists.
 *
 * **Not a stub, and not a mock — a true statement about the current schema.** No
 * product user table has been created yet (lane L1 owns the `app.users` migration,
 * ADR-0008:22-34), so there is no auth identity that could resolve to an onboarded
 * actor. Returning `null` is the correct answer, not a placeholder for one.
 *
 * What that buys today: the auth boundary is provably complete before identity
 * exists. A request with no token is 401, a forged or expired token is 401, and a
 * *valid* token is 403 `ONBOARDING_REQUIRED` — the three outcomes M2-AC2 requires,
 * all reachable and all tested. L1 then has one job on this path: make the positive
 * case return an actor.
 *
 * **Delete this in the L1 PR** that registers
 * `modules/identity/application/resolve-actor.query.ts` in the container. Leaving it
 * behind is worse than useless: it is a working implementation of "nobody is signed
 * in" sitting next to the real one, one wiring mistake away from locking every user
 * out with a green test suite.
 */
export function createNoOnboardedUsersResolver(): ActorResolver {
  return {
    resolve: () => Promise.resolve(null),
  };
}
