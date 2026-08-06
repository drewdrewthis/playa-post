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
 * `NOTIFY_ME_QUERY_CONFLICT` is `CONFLICT`, which is the one status that tells a
 * client to re-read and re-submit rather than to fix its input. Everything else this
 * module raises is `INVALID_BOARD_QUERY` — the caller's own text being malformed,
 * which is a **bad request** and may name the offending token without disclosing
 * anything (ADR-0007:53-56 requires exactly that of a refused query).
 *
 * ⚠ The conflict response carries the stable code and nothing else. ADR-0005 allows a
 * `currentVersion`/`currentState` envelope for `bulletin.update`, where both parties
 * are the author; it must not appear here, because the actor who lost the comparison
 * may be an actor who has no saved query at all (M2-AC19).
 */
function asTrpcError(error: ApplicationError): TRPCError {
  const code = error instanceof NotifyMeQueryConflictError ? 'CONFLICT' : 'BAD_REQUEST';

  return new TRPCError({ code, message: error.message, cause: error });
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
 * **One procedure, nested under `notifyMe` so the path spells the ADR-0005 mutation
 * type.** `views.notifyMe.update` is `notifyMe.update` in ADR-0005's conflict matrix
 * (ADR-0005:98) and in M2-AC19's B13 row — the same convention
 * `connections.trust.set` already follows for `trust.set`. The saved-views half of
 * that matrix row (`view.save`) is M5 and arrives as a sibling sub-router, which is
 * why the namespace exists now rather than a flat `views.updateNotifyMe`.
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
