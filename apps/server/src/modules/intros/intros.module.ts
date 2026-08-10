import type { DatabaseConnection } from '@playa-post/database';

import { createDecideIntroService } from './application/decide-intro.service';
import { createListIntroInboxQuery } from './application/list-intro-inbox.query';
import { createListIntroOutboxQuery } from './application/list-intro-outbox.query';
import { createListIntroViaCandidatesQuery } from './application/list-intro-via-candidates.query';
import { createRequestIntroService } from './application/request-intro.service';
import { createPostgresIntroRequestRepository } from './persistence/postgres-intro-request.repository';
import { createIntrosRouter, type IntrosRouter } from './transport/intros.router';

/** What the composition root has to hand this module. */
export interface IntrosModuleDependencies {
  /** Connected as `app_rw` and nothing else (ADR-0002 §2). */
  readonly database: DatabaseConnection;
}

/**
 * What the composition root gets back: a router to mount, and nothing else.
 *
 * ⚠ **No use case is exported for `sync.submitMutations` to register**, unlike
 * `modules/notes`' `pinNote`, and the absence is a decision rather than an omission.
 * Intro eligibility is *time-varying*: a queued ask composed while three people were
 * connected could drain into a graph where they are not, and ADR-0005's conflict matrix
 * defines no resolution for that. `intros.request` is therefore online-only and absent
 * from `QUEUED_MUTATION_TYPES` — the same call `notifications.dismiss` makes. Exporting
 * a service here would invite the registration that makes it queueable.
 */
export interface IntrosModule {
  readonly router: IntrosRouter;
}

/**
 * Wire the intros module.
 *
 * **This file is the module's only wiring point**, the same shape `notes.module.ts`
 * establishes: `application/` may not import `persistence/`
 * (`no-domain-to-infrastructure`), so somebody outside both layers builds the repository
 * and injects it.
 *
 * One repository instance serves all five operations, because it is one connection pool
 * over one pair of ports — `IntroRequestRepository` for the two gated writes and
 * `VisibleIntrosRepository` for the three §6a-projected reads. Each service takes only
 * the port it needs, so nothing here hands the request service a way to read somebody's
 * inbox.
 *
 * ⚠ **This module depends on `modules/graph` nowhere, and that is deliberate.**
 * Eligibility composes `app.visible_people` *in SQL*, through
 * `app.intro_via_candidates` — so there is no TypeScript edge to draw and none may be
 * added. Injecting a graph repository here would put a second definition of reachability
 * one convenience method away (ADR-0002 §6, R2).
 *
 * Called once per process from `composition/container.ts`. Constructing it touches no
 * socket: the pool connects lazily and the router is a data structure.
 */
export function createIntrosModule(dependencies: IntrosModuleDependencies): IntrosModule {
  const intros = createPostgresIntroRequestRepository({ database: dependencies.database });

  return {
    router: createIntrosRouter({
      listIntroViaCandidates: createListIntroViaCandidatesQuery({ intros }),
      requestIntro: createRequestIntroService({ introRequests: intros }),
      listIntroInbox: createListIntroInboxQuery({ intros }),
      listIntroOutbox: createListIntroOutboxQuery({ intros }),
      decideIntro: createDecideIntroService({ introRequests: intros }),
    }),
  };
}
