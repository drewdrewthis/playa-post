import type { DatabaseConnection } from '@playa-post/database';

import { createGetPrivacyLimitsQuery } from './application/get-privacy-limits.query';
import { createSetPrivacyLimitsService } from './application/set-privacy-limits.service';
import { createPostgresPrivacyLimitsRepository } from './persistence/postgres-privacy-limits.repository';
import { createPrivacyRouter, type PrivacyRouter } from './transport/privacy.router';

/** What the composition root has to hand this module. */
export interface PrivacyModuleDependencies {
  /** Connected as `app_rw` and nothing else (ADR-0002 §2). */
  readonly database: DatabaseConnection;
}

/** What the composition root gets back: a router to mount. */
export interface PrivacyModule {
  readonly router: PrivacyRouter;
}

/**
 * Wire the privacy module.
 *
 * **This file is the module's only wiring point**, which is what keeps the boundary
 * rules satisfiable: `application/` may not import `persistence/`
 * (`no-domain-to-infrastructure`), so somebody outside both layers has to build the
 * repository and inject it.
 *
 * ⚠ Nothing leaves this module but the router, and the name limit is the reason. The
 * *enforcement* of "who sees your name" is `app.visible_people`'s — the one
 * person-projection rule (ADR-0002 §6a) — reached through `modules/graph`'s allowlisted
 * grant on `app.privacy_settings`. Exporting a repository here would give a second
 * module a way to evaluate the same policy independently, and the day the two disagree
 * is the day somebody's name is disclosed against their settings.
 *
 * Called once per process from `composition/container.ts`. Constructing it touches no
 * socket: the pool connects lazily and the router is a data structure.
 */
export function createPrivacyModule(dependencies: PrivacyModuleDependencies): PrivacyModule {
  const { database } = dependencies;
  const limits = createPostgresPrivacyLimitsRepository({ database });

  return {
    router: createPrivacyRouter({
      getPrivacyLimits: createGetPrivacyLimitsQuery({ limits }),
      setPrivacyLimits: createSetPrivacyLimitsService({ limits }),
    }),
  };
}
