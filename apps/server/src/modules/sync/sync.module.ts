import type { DatabaseConnection } from '@playa-post/database';

import { createSubmitMutationsService } from './application/submit-mutations.service';
import type {
  MutationActorshipCheckRegistry,
  MutationHandlerRegistry,
} from './domain/mutation-handler';
import { createPostgresMutationResultRepository } from './persistence/postgres-mutation-result.repository';
import { createSyncRouter, type SyncRouter } from './transport/sync.router';

/** What the composition root has to hand this module. */
export interface SyncModuleDependencies {
  /** Connected as `app_rw` and nothing else (ADR-0002 §2). */
  readonly database: DatabaseConnection;
  /**
   * `MutationType → handler`, assembled by the composition root.
   *
   * ⚠ **They come in; they are never built here.** A handler adapts one envelope onto
   * the *owning* module's public application interface, so a registry built inside
   * `modules/sync` would make sync import every module that has a mutation — which is
   * the coupling ADR-0005's registry exists to avoid and §19 forbids outright.
   */
  readonly handlers: MutationHandlerRegistry;
  /** `MutationType → pre-dispatch actorship check`, assembled the same way. */
  readonly actorshipChecks: MutationActorshipCheckRegistry;
}

/** What the composition root gets back: a router to mount. */
export interface SyncModule {
  readonly router: SyncRouter;
}

/**
 * Wire the sync module.
 *
 * **This file is the module's only wiring point**, the same shape `identity.module.ts`
 * establishes: `application/` may not import `persistence/`
 * (`no-domain-to-infrastructure`), so somebody outside both layers builds the
 * repository and injects it.
 *
 * Nothing leaves this module but the router. There is no exported "apply a mutation"
 * service, deliberately: a second caller would be a second offline path, and ADR-0005's
 * whole argument against per-module offline endpoints is that the precedence invariants
 * need exactly one place to be enforced.
 *
 * Called once per process from `composition/container.ts`. Constructing it touches no
 * socket: the pool connects lazily and the router is a data structure.
 */
export function createSyncModule(dependencies: SyncModuleDependencies): SyncModule {
  const mutationResults = createPostgresMutationResultRepository({
    database: dependencies.database,
  });

  return {
    router: createSyncRouter({
      submitMutations: createSubmitMutationsService({
        mutationResults,
        handlers: dependencies.handlers,
        actorshipChecks: dependencies.actorshipChecks,
      }),
    }),
  };
}
