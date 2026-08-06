import type { DatabaseConnection } from '@playa-post/database';

import { createArchiveBulletinService } from './application/archive-bulletin.service';
import {
  createCreateBulletinService,
  type CreateBulletinService,
} from './application/create-bulletin.service';
import {
  createFindVisibleBulletinAuthorQuery,
  type FindVisibleBulletinAuthor,
} from './application/find-visible-bulletin-author.query';
import { createGetBulletinQuery } from './application/get-bulletin.query';
import type { HiddenBulletinsRepository } from './application/hidden-bulletins.repository';
import { createListBoardQuery } from './application/list-board.query';
import { createListMyBulletinsQuery } from './application/list-my-bulletins.query';
import { createPostgresBulletinRepository } from './persistence/postgres-bulletin.repository';
import { createBulletinsRouter, type BulletinsRouter } from './transport/bulletins.router';

/** What the composition root has to hand this module. */
export interface BulletinsModuleDependencies {
  /** Connected as `app_rw` and nothing else (ADR-0002 §2). */
  readonly database: DatabaseConnection;
  /**
   * What each viewer has reported or dismissed, implemented by `modules/moderation`
   * (M2.12). See {@link HiddenBulletinsRepository}.
   *
   * ⚠ **Optional, and a board built without it hides nothing.** It is optional because
   * the two modules need each other — moderation asks this one whether an actor may
   * moderate a bulletin at all — and because a board with no moderation behind it is a
   * real configuration rather than a broken one. The production wiring in
   * `composition/container.ts` always passes it; a suite that is not about moderation
   * does not have to.
   */
  readonly hiddenBulletins?: HiddenBulletinsRepository | undefined;
}

/** What the composition root gets back: a router to mount, and one shared read. */
export interface BulletinsModule {
  readonly router: BulletinsRouter;
  /**
   * "Can this actor see that bulletin, and whose is it" — the module's one public
   * application interface for other modules (§19), consumed by `modules/moderation`.
   *
   * The *query* is exported rather than the repository, the same way
   * `modules/graph` exports its projection: a consumer gets one answer and no way to
   * reach the authorized read behind it, so there is no seam where a caller could ask
   * for one more column or one fewer predicate.
   */
  readonly findVisibleBulletin: FindVisibleBulletinAuthor;
  /**
   * The create use case, for the composition root to register as
   * `sync.submitMutations`' `bulletin.create` handler (ADR-0005: an envelope is
   * dispatched "to the owning module's application service ... so `sync` depends on
   * modules' public application interfaces and never on their internals").
   *
   * The **service**, not the repository: the offline path and the tRPC path must apply
   * the same content policy and write the same outbox event, and they do that by
   * running the same use case rather than by two callers agreeing to.
   */
  readonly createBulletin: CreateBulletinService;
}

/**
 * Wire the bulletins module.
 *
 * **This file is the module's only wiring point**, the same shape
 * `identity.module.ts` establishes: `application/` may not import `persistence/`
 * (`no-domain-to-infrastructure`), so somebody outside both layers builds the
 * repository and injects it.
 *
 * One repository instance serves every operation, because it is one connection pool
 * over one pair of ports — `BulletinRepository` for the author's own rows and
 * `VisibleBulletinsRepository` for the §6a-projected authorized set. Each service takes
 * only the port it needs, so nothing here hands a create service a board read.
 *
 * What leaves this module is the router and one authorization answer
 * ({@link BulletinsModule.findVisibleBulletin}). The board grammar it consumes comes
 * *in* from `modules/views` (ADR-0007's one grammar, one validator), and the authorized
 * bulletin set is `app.visible_bulletins` — SQL, not a TypeScript export — so there is
 * still no read model here for another lane to reach for instead of composing the
 * function.
 *
 * Called once per process from `composition/container.ts`. Constructing it touches no
 * socket: the pool connects lazily and the router is a data structure.
 */
export function createBulletinsModule(dependencies: BulletinsModuleDependencies): BulletinsModule {
  const bulletins = createPostgresBulletinRepository({ database: dependencies.database });
  // Built once and mounted twice on purpose: the tRPC procedure and the offline
  // envelope's handler are two transports over one use case, not two use cases.
  const createBulletin = createCreateBulletinService({ bulletins });

  return {
    router: createBulletinsRouter({
      createBulletin,
      archiveBulletin: createArchiveBulletinService({ bulletins }),
      getBulletin: createGetBulletinQuery({ bulletins }),
      listMyBulletins: createListMyBulletinsQuery({ bulletins }),
      listBoard: createListBoardQuery({
        bulletins,
        ...(dependencies.hiddenBulletins === undefined
          ? {}
          : { hiddenBulletins: dependencies.hiddenBulletins }),
      }),
    }),
    findVisibleBulletin: createFindVisibleBulletinAuthorQuery({ bulletins }),
    createBulletin,
  };
}
