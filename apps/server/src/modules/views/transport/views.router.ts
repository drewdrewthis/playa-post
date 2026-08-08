import { TRPCError } from '@trpc/server';

import { ApplicationError } from '../../../shared/errors/application-error';
import { authenticatedProcedure, router } from '../../../shared/trpc/trpc';
import type { DeleteSavedViewService, SavedViewDeletion } from '../application/delete-saved-view.service';
import type { ListSavedViewsQuery } from '../application/list-saved-views.query';
import type { RenameSavedViewService } from '../application/rename-saved-view.service';
import type { SaveViewService } from '../application/save-view.service';
import type {
  NotifyMeDesignation,
  SetSavedViewNotifyService,
} from '../application/set-saved-view-notify.service';
import type { UpdateNotifyMeQueryService } from '../application/update-notify-me-query.service';
import { NotifyMeQueryConflictError } from '../domain/notify-me-query.errors';
import { SavedViewConflictError, SavedViewUnavailableError } from '../domain/saved-view.errors';

import { presentNotifyMeQuery, type PresentedNotifyMeQuery } from './notify-me-query.presenter';
import {
  renameSavedViewInput,
  savedViewTargetInput,
  saveViewInput,
  setSavedViewNotifyInput,
} from './saved-view.input';
import {
  presentSavedView,
  presentSavedViewListing,
  type PresentedSavedView,
  type PresentedSavedViewListing,
} from './saved-view.presenter';
import { updateNotifyMeQueryInput } from './update-notify-me-query.input';

/** The application operations this router speaks for. One use case, one procedure. */
export interface ViewsRouterDependencies {
  readonly updateNotifyMeQuery: UpdateNotifyMeQueryService;
  readonly listSavedViews: ListSavedViewsQuery;
  readonly saveView: SaveViewService;
  readonly renameSavedView: RenameSavedViewService;
  readonly deleteSavedView: DeleteSavedViewService;
  readonly setSavedViewNotify: SetSavedViewNotifyService;
}

/**
 * Give an {@link ApplicationError} the transport status it deserves.
 *
 * `NOTIFY_ME_QUERY_CONFLICT` and `SAVED_VIEW_CONFLICT` are `CONFLICT`, which is the one
 * status that tells a client to re-read and re-submit rather than to fix its input.
 *
 * **`SAVED_VIEW_UNAVAILABLE` is `NOT_FOUND`, and never `FORBIDDEN`.** A 403 would confirm
 * that the identifier names a real view belonging to somebody else; 404 is the same
 * answer an invented one gets, which is what M5-AC16 asks for and the identical decision
 * `bulletins.router.ts` makes for `BULLETIN_GONE`.
 *
 * `SAVED_VIEW_LIMIT_REACHED` is `BAD_REQUEST` rather than `CONFLICT`: nothing about the
 * stored state changed under the caller, and re-reading and re-submitting would fail
 * identically. The fix is theirs — delete a view — which is what a bad request means.
 *
 * Everything else this module raises is `INVALID_BOARD_QUERY` or
 * `SAVED_VIEW_NAME_INVALID` — the caller's own input being malformed, which is a **bad
 * request** and may name the offending token without disclosing anything (ADR-0007:53-56
 * requires exactly that of a refused query).
 *
 * ⚠ Every conflict response carries the stable code and nothing else. ADR-0005 allows a
 * `currentVersion`/`currentState` envelope for `bulletin.update`, where both parties
 * are the author; it must not appear here, because the actor who lost the comparison
 * may be an actor who has no saved query and no view at all (M2-AC19, M5-AC16).
 */
function asTrpcError(error: ApplicationError): TRPCError {
  if (error instanceof SavedViewUnavailableError) {
    return new TRPCError({ code: 'NOT_FOUND', message: error.message, cause: error });
  }

  const conflict =
    error instanceof NotifyMeQueryConflictError || error instanceof SavedViewConflictError;

  return new TRPCError({
    code: conflict ? 'CONFLICT' : 'BAD_REQUEST',
    message: error.message,
    cause: error,
  });
}

/**
 * Run one application operation and map its refusals onto the wire.
 *
 * The same three steps `bulletins.router.ts` factors out, for the same reason: a
 * forgotten `catch` is a 500 carrying a message written for a log rather than for a
 * caller.
 */
async function present<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof ApplicationError) {
      throw asTrpcError(error);
    }
    throw error;
  }
}

/**
 * The views module's tRPC surface.
 *
 * **Two sub-routers, each named for the ADR-0005 mutation type its path spells.**
 * `views.notifyMe.update` is `notifyMe.update` in ADR-0005's conflict matrix
 * (ADR-0005:98) and `views.saved.*` is that matrix's other views row, `view.save`
 * (ADR-0005:102) — the same convention `connections.trust.set` follows for `trust.set`.
 * The `notifyMe` namespace existed for exactly this: the sibling arrived.
 *
 * The board grammar reaches clients through `bulletins.board`'s `query` argument, not
 * through a procedure here: it is a pure function bulletins imports directly
 * (ADR-0013), and a procedure that only parses text would be a validator exposed as an
 * endpoint. That is also why no procedure here reports a view's **match count** — the
 * client asks `bulletins.board` per view, so the number on a card is provably the number
 * the board shows when that card is opened (ADR-0016 decision D2).
 *
 * ⚠ `delete` and `setNotify` return their application results **unprojected**, unlike
 * every other procedure in this module. A presenter exists to keep a *domain entity* off
 * the wire — to turn a `Date` into a string and to drop fields a client has no business
 * with — and these two carry neither: `{ viewId, deleted }` and `{ notifyingViewId }` are
 * already the whole answer, in primitives. An identity-mapping presenter would be
 * ceremony that reads like a promise of translation it does not perform.
 * `tests/fitness/contracts-api-parity.fitness.test.ts` pins both shapes either way.
 */
export function createViewsRouter(dependencies: ViewsRouterDependencies) {
  return router({
    /**
     * The named board queries the Saved tab lists (issue #45, ADR-0007:77).
     *
     * ⚠ **There is no `get` by id.** `list` returns everything the caller may see —
     * their own views and nothing else — so a single-view read could only ever answer a
     * question `list` has already answered, while adding the one endpoint through which
     * an actor could probe whether an id names a real view (M5-AC16).
     */
    saved: router({
      /**
       * The caller's own saved views, oldest first, and which one the bell is lit on.
       *
       * **No input at all**, the same statement `graph.list` and `notifications.list`
       * make: there is exactly one person's views a caller may read, so there is no
       * parameter that could name a different one (ADR-0002 §5a).
       */
      list: authenticatedProcedure.query(
        async ({ ctx }): Promise<PresentedSavedViewListing> =>
          present(async () =>
            presentSavedViewListing(
              await dependencies.listSavedViews.list({ viewerId: ctx.viewerId }),
            ),
          ),
      ),

      /**
       * Save the board query you are looking at, under a name.
       *
       * ADR-0005's `view.save`. No `expectedVersion`: a new view has no stored state for
       * a caller to have an opinion about. Saving the same query twice makes two views,
       * deliberately — the comp's own "Save as view" seeds a name from the query text,
       * and de-duplicating would silently discard the second name somebody chose.
       */
      save: authenticatedProcedure
        .input(saveViewInput)
        .mutation(async ({ ctx, input }): Promise<PresentedSavedView> =>
          present(async () =>
            presentSavedView(
              await dependencies.saveView.save({
                actorId: ctx.actor.userId,
                name: input.name,
                sourceText: input.sourceText,
              }),
            ),
          ),
        ),

      /**
       * Change a view's name. Its query is untouched — see `rename-saved-view.service.ts`.
       */
      rename: authenticatedProcedure
        .input(renameSavedViewInput)
        .mutation(async ({ ctx, input }): Promise<PresentedSavedView> =>
          present(async () =>
            presentSavedView(
              await dependencies.renameSavedView.rename({
                actorId: ctx.actor.userId,
                viewId: input.viewId,
                name: input.name,
                expectedVersion: input.expectedVersion,
              }),
            ),
          ),
        ),

      /**
       * Remove one of your own views.
       *
       * Idempotent, and answers the same `deleted: false` whether the view was already
       * gone or was never yours — see `delete-saved-view.service.ts` for why that is the
       * only answer that gives nothing away.
       *
       * ⚠ Deleting the view the bell is lit on **stops the notifications**, in the same
       * transaction. The bell that turned them on is on the card being removed.
       */
      delete: authenticatedProcedure
        .input(savedViewTargetInput)
        .mutation(async ({ ctx, input }): Promise<SavedViewDeletion> =>
          present(async () =>
            dependencies.deleteSavedView.delete({
              actorId: ctx.actor.userId,
              viewId: input.viewId,
            }),
          ),
        ),

      /**
       * Light the Notify Me bell on this view, or clear it.
       *
       * ⚠ **Lighting it on view B clears it on view A** — decision D1: there is exactly
       * one Notify Me query per user, and the bell designates which view's query that is.
       * The answer names the view the bell is now on, so a client never has to infer it.
       */
      setNotify: authenticatedProcedure
        .input(setSavedViewNotifyInput)
        .mutation(async ({ ctx, input }): Promise<NotifyMeDesignation> =>
          present(async () =>
            dependencies.setSavedViewNotify.set({
              actorId: ctx.actor.userId,
              viewId: input.viewId,
              notify: input.notify,
            }),
          ),
        ),
    }),

    notifyMe: router({
      /**
       * Save the caller's one Notify Me query.
       *
       * Not `create`/`update` as two procedures: there is at most one query per user
       * (D1, ADR-0007:79), so "which one" is never a question and the second call is
       * the same operation as the first with a version attached.
       */
      update: authenticatedProcedure
        .input(updateNotifyMeQueryInput)
        .mutation(async ({ ctx, input }): Promise<PresentedNotifyMeQuery> =>
          present(async () =>
            presentNotifyMeQuery(
              await dependencies.updateNotifyMeQuery.update({
                actorId: ctx.actor.userId,
                sourceText: input.sourceText,
                ...(input.expectedVersion === undefined
                  ? {}
                  : { expectedVersion: input.expectedVersion }),
              }),
            ),
          ),
        ),
    }),
  });
}

/** The views router's type, for the root router to mount it by. */
export type ViewsRouter = ReturnType<typeof createViewsRouter>;
