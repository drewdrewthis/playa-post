import { TRPCError } from '@trpc/server';

import { ApplicationError } from '../../../shared/errors/application-error';
import { authenticatedProcedure, router } from '../../../shared/trpc/trpc';
import type { DismissBulletinService } from '../application/dismiss-bulletin.service';
import type { ReportBulletinService } from '../application/report-bulletin.service';
import { ModerationTargetUnavailableError } from '../domain/moderation.errors';

import { presentHiddenBulletin, type PresentedHiddenBulletin } from './hidden-bulletin.presenter';
import { moderationReportInput } from './moderation-report.input';
import { moderationTargetInput } from './moderation-target.input';

/** The application operations this router speaks for. One use case, one procedure. */
export interface ModerationRouterDependencies {
  readonly reportBulletin: ReportBulletinService;
  readonly dismissBulletin: DismissBulletinService;
}

/**
 * Give an {@link ApplicationError} the transport status it deserves.
 *
 * **`MODERATION_TARGET_UNAVAILABLE` is `NOT_FOUND`, and never `FORBIDDEN`.** A 403
 * would confirm that the bulletin exists and belongs to somebody else; 404 is the same
 * answer the caller would get for a UUID that never existed, which is what ADR-0002 §10
 * asks for and what B17 measures — the identical decision
 * `bulletins.router.ts` makes for `BULLETIN_GONE`.
 *
 * `BULLETIN_REPORT_OWN_NOT_ALLOWED` and `REPORT_DETAIL_INVALID` are both **bad
 * requests**: each describes the caller's own submission, so naming the problem
 * discloses only what they already know, and a 404 for either would be a confusing lie.
 * `REPORT_DETAIL_INVALID` is safe here *because* `report-bulletin.service.ts` settles
 * authorization before it can be raised — it is never the answer to a caller who may not
 * see the bulletin.
 */
function asTrpcError(error: ApplicationError): TRPCError {
  const code = error instanceof ModerationTargetUnavailableError ? 'NOT_FOUND' : 'BAD_REQUEST';

  return new TRPCError({ code, message: error.message, cause: error });
}

/**
 * Run one application operation and map its refusals onto the wire.
 *
 * The translation lives here once rather than in each procedure body: a `try`/`catch`
 * copied into two procedures is two places for the next `catch` to be forgotten, and a
 * forgotten one is a 500 carrying a message written for a log rather than for a caller.
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
 * The moderation module's tRPC surface.
 *
 * **Two procedures, both writes, and no read.** There is deliberately no
 * `moderation.list`, no "what have I reported", and no board of its own: the only
 * observable effect of either operation is a bulletin's absence from
 * `bulletins.board`, and a second read surface would be a second place for the
 * exclusion to be computed — and, for reports, a surface an author might one day be
 * pointed at (M2-AC10, B9).
 *
 * **No procedure takes an identifier for its caller.** `report` takes a bulletin, a
 * reason and an account; `dismiss` takes a bulletin and nothing else; neither takes a
 * reporter — the acting viewer is `ctx.actor.userId` (ADR-0002:180-181, B14).
 *
 * Every procedure is `authenticatedProcedure`: each writes state attached to one actor
 * and changes what exactly one board shows, so there is no version of either a
 * signed-out caller could sensibly be given.
 */
export function createModerationRouter(dependencies: ModerationRouterDependencies) {
  return router({
    /**
     * Privately report a bulletin, saying what kind of abuse it is and what happened.
     * It leaves your board immediately, stays on everybody else's, and the author is
     * never told (M2-AC10).
     *
     * Idempotent: reporting the same bulletin twice returns the first `hiddenAt`
     * (ADR-0005's matrix — one open report per reporter/bulletin), and keeps the first
     * reason and account rather than overwriting them.
     *
     * ⚠ The response is {@link PresentedHiddenBulletin} and echoes back neither the
     * reason nor the account. A client already knows what it sent, and a field on the
     * response is a field a log, a cache, or an offline mirror then carries.
     */
    report: authenticatedProcedure
      .input(moderationReportInput)
      .mutation(async ({ ctx, input }): Promise<PresentedHiddenBulletin> =>
        present(async () =>
          presentHiddenBulletin(
            await dependencies.reportBulletin.report({
              actorId: ctx.actor.userId,
              bulletinId: input.bulletinId,
              reason: input.reason,
              detail: input.detail,
            }),
          ),
        ),
      ),

    /**
     * Take a bulletin off your own board. Viewer-local and nothing else (M2-AC11):
     * no effect on the bulletin, its author, or any other viewer.
     */
    dismiss: authenticatedProcedure
      .input(moderationTargetInput)
      .mutation(async ({ ctx, input }): Promise<PresentedHiddenBulletin> =>
        present(async () =>
          presentHiddenBulletin(
            await dependencies.dismissBulletin.dismiss({
              actorId: ctx.actor.userId,
              bulletinId: input.bulletinId,
            }),
          ),
        ),
      ),
  });
}

/** The moderation router's type, for the root router to mount it by. */
export type ModerationRouter = ReturnType<typeof createModerationRouter>;
