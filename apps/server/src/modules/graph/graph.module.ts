import type { DatabaseConnection } from '@playa-post/database';

import {
  createListVisibleGraphQuery,
  type ListVisibleGraphQuery,
} from './application/list-visible-graph.query';
import { createPostgresVisiblePeopleRepository } from './persistence/postgres-visible-people.repository';
import { createGraphRouter, type GraphRouter } from './transport/graph.router';

/** What the composition root has to hand this module. */
export interface GraphModuleDependencies {
  /** Connected as `app_rw` and nothing else (ADR-0002 §2). */
  readonly database: DatabaseConnection;
}

/** What the composition root gets back: a router to mount, and one shared read model. */
export interface GraphModule {
  readonly router: GraphRouter;
  /**
   * The ADR-0002 §6a person projection — **lane-brief C8's export** (ratified (c)).
   *
   * Leaves the module the way identity's `ActorResolver` does, and for the same
   * reason: "who can this viewer see, and how much of them" is one question the whole
   * system asks, and three lanes answering it three times is R2, the plan's only
   * Critical-severity risk. Bulletin author cards (L3a) and notification recipients
   * (L3b-notify) consume this rather than joining `app.users`.
   *
   * The *query* is exported rather than the repository: a consumer gets the projected
   * read model and no way to reach the SQL behind it, so there is no seam where a
   * caller could add "just one more column" to the function's result.
   *
   * **The signature is not frozen.** L2 designed it with one consumer in mind and will
   * have got it slightly wrong; the first consuming PR is explicitly allowed to change
   * it, which is cheaper than a consumer working around a bad fit and re-deriving what
   * it needs.
   */
  readonly visiblePeople: ListVisibleGraphQuery;
}

/**
 * Wire the graph module.
 *
 * **This file is the module's only wiring point**, the same shape
 * `identity.module.ts` establishes: `application/` may not import `persistence/`
 * (`no-domain-to-infrastructure`), so somebody outside both layers builds the
 * repository and injects it.
 *
 * Called once per process from `composition/container.ts`. Constructing it touches no
 * socket: the pool connects lazily and the router is a data structure.
 */
export function createGraphModule(dependencies: GraphModuleDependencies): GraphModule {
  const visiblePeople = createListVisibleGraphQuery({
    visiblePeople: createPostgresVisiblePeopleRepository({ database: dependencies.database }),
  });

  return {
    router: createGraphRouter({ listVisibleGraph: visiblePeople }),
    visiblePeople,
  };
}
