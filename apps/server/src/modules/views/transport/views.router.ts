import { TRPCError } from '@trpc/server';

import { ApplicationError } from '../../../shared/errors/application-error';
import { authenticatedProcedure, router } from '../../../shared/trpc/trpc';
import type { UpdateNotifyMeQueryService } from '../application/update-notify-me-query.service';
import { NotifyMeQueryConflictError } from '../domain/notify-me-query.errors';

import { presentNotifyMeQuery, type PresentedNotifyMeQuery } from './notify-me-query.presenter';
import { updateNotifyMeQueryInput } from './update-notify-me-query.input';

/** The application operations this router speaks for. One use case, one procedure. */
export interface ViewsRouterDependencies {
  readonly updateNotifyMeQuery: UpdateNotifyMeQueryService;
}

/**
 * Give an {@link ApplicationError} the transport status it deserves.
 *
 * `NOTIFY_ME_QUERY_CONFLICT` is `CONFLICT`, which is the one status that tells a client
 * to re-read and re-submit rather than to fix its input. Everything else this module
 * raises is `INVALID_BOARD_QUERY` — the caller's own input being malformed, which is a
 * **bad request** and may name the offending token without disclosing anything
 * (ADR-0007:53-56 requires exactly that of a refused query).
 *
 * ⚠ Every conflict response carries the stable code and nothing else. ADR-0005 allows a
 * `currentVersion`/`currentState` envelope for `bulletin.update`, where both parties
 * are the author; it must not appear here, because the actor who lost the comparison
 * may be an actor who has no saved query at all (M2-AC19).
 */
function asTrpcError(error: ApplicationError): TRPCError {
  return new TRPCError({
    code: error instanceof NotifyMeQueryConflictError ? 'CONFLICT' : 'BAD_REQUEST',
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
 * The views module's tRPC surface: one procedure, `views.notifyMe.update` — ADR-0005's
 * `notifyMe.update` (ADR-0005:98). The `views.saved.*` sub-router that once sat beside
 * it went with the Saved Views feature (issue #208, ADR-0019).
 *
 * The board grammar reaches clients through `bulletins.board`'s `query` argument, not
 * through a procedure here: it is a pure function bulletins imports directly
 * (ADR-0013), and a procedure that only parses text would be a validator exposed as an
 * endpoint.
 */
export function createViewsRouter(dependencies: ViewsRouterDependencies) {
  return router({
    notifyMe: router({
      /**
       * Save the caller's Notify Me query.
       *
       * Not `create`/`update` as two procedures, and taking no identifier: "which one"
       * is never a question here because a person has at most one saved query
       * (`app.notify_me_queries`' `unique (owner_id)`), so the actor is the address and
       * the second call is the first with a version attached.
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
