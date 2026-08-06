import type { DatabaseConnection } from '@playa-post/database';

import { createArchiveBulletinService } from './application/archive-bulletin.service';
import { createCreateBulletinService } from './application/create-bulletin.service';
import { createGetBulletinQuery } from './application/get-bulletin.query';
import { createListBoardQuery } from './application/list-board.query';
import { createListMyBulletinsQuery } from './application/list-my-bulletins.query';
import { createPostgresBulletinRepository } from './persistence/postgres-bulletin.repository';
import { createBulletinsRouter, type BulletinsRouter } from './transport/bulletins.router';

/** What the composition root has to hand this module. */
export interface BulletinsModuleDependencies {
  /** Connected as `app_rw` and nothing else (ADR-0002 §2). */
  readonly database: DatabaseConnection;
}

/** What the composition root gets back: a router to mount. */
export interface BulletinsModule {
  readonly router: BulletinsRouter;
}

/**
 * Wire the bulletins module.
 *
 * **This file is the module's only wiring point**, the same shape
 * `identity.module.ts` establishes: `application/` may not import `persistence/`
 * (`no-domain-to-infrastructure`), so somebody outside both layers builds the
 * repository and injects it.
 *
 * One repository instance serves all five operations, because it is one connection
 * pool over one pair of ports — `BulletinRepository` for the author's own rows and
 * `VisibleBulletinsRepository` for the §6a-projected authorized set. Each service takes
 * only the port it needs, so nothing here hands a create service a board read.
 *
 * Nothing leaves this module besides the router. The board grammar it consumes comes
 * *in* from `modules/views` (ADR-0007's one grammar, one validator), and the authorized
 * bulletin set is `app.visible_bulletins` — SQL, not a TypeScript export — so there is
 * no read model here for another lane to reach for instead of composing the function.
 *
 * Called once per process from `composition/container.ts`. Constructing it touches no
 * socket: the pool connects lazily and the router is a data structure.
 */
export function createBulletinsModule(dependencies: BulletinsModuleDependencies): BulletinsModule {
  const bulletins = createPostgresBulletinRepository({ database: dependencies.database });

  return {
    router: createBulletinsRouter({
      createBulletin: createCreateBulletinService({ bulletins }),
      archiveBulletin: createArchiveBulletinService({ bulletins }),
      getBulletin: createGetBulletinQuery({ bulletins }),
      listMyBulletins: createListMyBulletinsQuery({ bulletins }),
      listBoard: createListBoardQuery({ bulletins }),
    }),
  };
}
