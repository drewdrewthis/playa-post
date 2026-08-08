import type { DatabaseConnection } from '@playa-post/database';

import { createDeleteSavedViewService } from './application/delete-saved-view.service';
import { createListSavedViewsQuery } from './application/list-saved-views.query';
import type { NotifyMeQueryDirectory } from './application/notify-me-query.directory';
import { createRenameSavedViewService } from './application/rename-saved-view.service';
import { createSaveViewService } from './application/save-view.service';
import { createSetSavedViewNotifyService } from './application/set-saved-view-notify.service';
import { createUpdateNotifyMeQueryService } from './application/update-notify-me-query.service';
import { createPostgresNotifyMeQueryRepository } from './persistence/postgres-notify-me-query.repository';
import { createPostgresSavedViewRepository } from './persistence/postgres-saved-view.repository';
import { createViewsRouter, type ViewsRouter } from './transport/views.router';

/**
 * `modules/views`' public surface: the board grammar, and — since M2.10 — a factory.
 *
 * It was a set of pure functions with nothing to wire while the grammar owned no
 * table. Notify Me is what that file's own note said would change it ("Saved views and
 * Notify Me are what give this module state, a table, and procedures; the factory
 * arrives with them"), and it has: `app.notify_me_queries` is this module's, and
 * `views.notifyMe.update` is its first procedure.
 *
 * **This file is the whole of what other modules may import.** `modules/bulletins`'
 * board query consumes `parseBoardQuery`; `modules/notifications`' evaluator consumes
 * {@link createNotifyMeQueryDirectory}. Both are addendum §19's "shared contract with
 * clear ownership" rather than a reach-in: views owns the grammar and the saved
 * queries, and the consumers arriving over three milestones is exactly why neither may
 * be re-derived per caller.
 *
 * ⚠ Re-export additions belong here only if another module genuinely needs them.
 * Widening this barrel is how a module's internals become everyone's dependency.
 */
export {
  EMPTY_BOARD_QUERY,
  InvalidBoardQueryError,
  parseBoardQuery,
} from './domain/board-query-grammar';
export type { BoardQuery } from './domain/board-query-grammar';
export type {
  NotifyMeQueryDirectory,
  SavedNotifyMeQuery,
} from './application/notify-me-query.directory';

/** What the composition root has to hand this module. */
export interface ViewsModuleDependencies {
  /** Connected as `app_rw` and nothing else (ADR-0002 §2). */
  readonly database: DatabaseConnection;
}

/** What the composition root gets back: a router to mount, and one shared read model. */
export interface ViewsModule {
  readonly router: ViewsRouter;
  /**
   * The saved Notify Me queries, as a reader — this module's cross-module export.
   *
   * Leaves the module the way `modules/graph`'s `visiblePeople` does, and for the same
   * reason: `app.notify_me_queries` is this module's table, and the evaluator in
   * `modules/notifications` needs what is in it. Exporting the *query* rather than the
   * repository means a consumer gets the projection and no way to reach a write.
   */
  readonly notifyMeQueries: NotifyMeQueryDirectory;
}

/**
 * The saved Notify Me queries, wired.
 *
 * Exported beside {@link createViewsModule} because `modules/notifications` needs this
 * one collaborator and nothing else this module builds — its own factory receives
 * `database`, not a bag of other modules' ports, so it composes this itself rather
 * than taking a router it would never mount. Building the whole module for one reader
 * would hand a consumer a tRPC surface as a side effect of asking a question.
 *
 * Constructing it touches no socket: the pool connects lazily.
 */
export function createNotifyMeQueryDirectory(
  dependencies: ViewsModuleDependencies,
): NotifyMeQueryDirectory {
  return createPostgresNotifyMeQueryRepository({ database: dependencies.database });
}

/**
 * Wire the views module.
 *
 * **This file is the module's only wiring point**, the same shape
 * `identity.module.ts` establishes: `application/` may not import `persistence/`
 * (`no-domain-to-infrastructure`), so somebody outside both layers builds the
 * repository and injects it.
 *
 * One repository instance serves both ports, because they are two questions over one
 * table on one connection pool — see
 * `persistence/postgres-notify-me-query.repository.ts`.
 *
 * Called once per process from `composition/container.ts`. Constructing it touches no
 * socket: the pool connects lazily and the router is a data structure.
 */
export function createViewsModule(dependencies: ViewsModuleDependencies): ViewsModule {
  const notifyMeQueries = createPostgresNotifyMeQueryRepository({
    database: dependencies.database,
  });
  // A second repository over the same connection, not a second module: `app.saved_views`
  // and `app.notify_me_queries` are both this module's, and the Notify Me *designation*
  // is a fact spanning them (ADR-0016). They are separate objects because they answer
  // separate questions — `notifyMeQueries` is also the cross-module read model
  // `modules/notifications` consumes, and that consumer must not acquire a way to write
  // somebody's saved views as a side effect.
  const savedViews = createPostgresSavedViewRepository({ database: dependencies.database });

  return {
    router: createViewsRouter({
      updateNotifyMeQuery: createUpdateNotifyMeQueryService({ notifyMeQueries }),
      listSavedViews: createListSavedViewsQuery({ savedViews }),
      saveView: createSaveViewService({ savedViews }),
      renameSavedView: createRenameSavedViewService({ savedViews }),
      deleteSavedView: createDeleteSavedViewService({ savedViews }),
      setSavedViewNotify: createSetSavedViewNotifyService({ savedViews }),
    }),
    notifyMeQueries,
  };
}
