import type { DatabaseConnection } from '@playa-post/database';

import type { ActorResolver } from '../../shared/auth/actor-resolver';

import { createCompleteOnboardingService } from './application/complete-onboarding.service';
import { createResolveActorQuery } from './application/resolve-actor.query';
import { createPostgresUserRepository } from './persistence/postgres-user.repository';
import { createIdentityRouter, type IdentityRouter } from './transport/identity.router';

/** What the composition root has to hand this module. */
export interface IdentityModuleDependencies {
  /** Connected as `app_rw` and nothing else (ADR-0002 §2). */
  readonly database: DatabaseConnection;
}

/** What the composition root gets back: a router to mount, and one shared port. */
export interface IdentityModule {
  readonly router: IdentityRouter;
  /**
   * The system-wide {@link ActorResolver}.
   *
   * Identity owns "who is this" for every module (ADR-0008 rule 8), so this port
   * leaves the module while the repository behind it does not — that is the
   * "small public application interface" addendum §19 requires instead of a reach-in.
   */
  readonly actorResolver: ActorResolver;
}

/**
 * Wire the identity module.
 *
 * **This file is the module's only wiring point, and that is what keeps the boundary
 * rules satisfiable.** `application/` may not import `persistence/`
 * (`no-domain-to-infrastructure`), so somebody outside both layers has to build the
 * repository and inject it — that somebody is here. Nothing above `modules/identity/`
 * learns that `UserRepository` has a Postgres implementation.
 *
 * Called once per process from `composition/container.ts`. Constructing it touches no
 * socket: the pool connects lazily and the router is a data structure, so the whole
 * graph can be built before the database is reachable.
 */
export function createIdentityModule(dependencies: IdentityModuleDependencies): IdentityModule {
  const users = createPostgresUserRepository({ database: dependencies.database });

  return {
    router: createIdentityRouter({
      completeOnboarding: createCompleteOnboardingService({ users }),
    }),
    actorResolver: createResolveActorQuery({ users }),
  };
}
