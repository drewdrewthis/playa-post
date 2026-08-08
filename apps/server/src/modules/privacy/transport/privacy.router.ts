import { TRPCError } from '@trpc/server';

import { ApplicationError } from '../../../shared/errors/application-error';
import { authenticatedProcedure, router } from '../../../shared/trpc/trpc';
import type { GetPrivacyLimitsQuery } from '../application/get-privacy-limits.query';
import type { SetPrivacyLimitsService } from '../application/set-privacy-limits.service';

import { presentPrivacyLimits, type PresentedPrivacyLimits } from './privacy-limits.presenter';
import { setPrivacyLimitsInput } from './set-privacy-limits.input';

/** The application operations this router speaks for. One use case, one procedure. */
export interface PrivacyRouterDependencies {
  readonly getPrivacyLimits: GetPrivacyLimitsQuery;
  readonly setPrivacyLimits: SetPrivacyLimitsService;
}

/**
 * Give an {@link ApplicationError} the transport status it deserves.
 *
 * `PRIVACY_LIMIT_OUT_OF_RANGE` is the only failure this router can raise, and it is a
 * `BAD_REQUEST`: the caller sent a value outside the vocabulary, they own the picker
 * that produced it, and naming the reason discloses nothing about anybody else. The
 * stable application code travels either way (`trpc.ts`'s `errorFormatter` lifts it into
 * `data.applicationCode`), so this decides the HTTP status and nothing else.
 */
function asTrpcError(error: ApplicationError): TRPCError {
  return new TRPCError({ code: 'BAD_REQUEST', message: error.message, cause: error });
}

/** Run one application operation and map its refusals onto the wire. */
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
 * The privacy module's tRPC surface — the You screen's two standing limits (issue #49).
 *
 * **Neither procedure takes an identifier for anybody.** `getLimits` takes no input at
 * all and `setLimits` takes only the four values; the limits are always the caller's own.
 * ADR-0002:180-181 forbids a caller-supplied identity field and
 * `tests/fitness/viewer-id-provenance.fitness.test.ts` walks this router to prove it.
 *
 * **There is deliberately no procedure that reads somebody else's limits, and no
 * procedure that answers "does this person's limit admit me".** That question has exactly
 * one answer and `app.visible_people` gives it (ADR-0002 §6a); a second surface for it
 * would let a caller probe another user's trust threshold directly, which is the value
 * B6 keeps inside its holder.
 *
 * Both are `authenticatedProcedure`: a signed-out caller has no limits to read and none
 * to set.
 */
export function createPrivacyRouter(dependencies: PrivacyRouterDependencies) {
  return router({
    /**
     * The caller's own limits, with the permissive default substituted for a user who
     * has never tightened anything — the screen always has two pickers to draw.
     */
    getLimits: authenticatedProcedure.query(
      async ({ ctx }): Promise<PresentedPrivacyLimits> =>
        present(async () =>
          presentPrivacyLimits(
            await dependencies.getPrivacyLimits.get({ actorId: ctx.actor.userId }),
          ),
        ),
    ),

    /**
     * Replace both limits.
     *
     * Returns what was stored rather than nothing, because the pickers have to settle on
     * the value the server accepted rather than the one the client optimistically drew.
     */
    setLimits: authenticatedProcedure
      .input(setPrivacyLimitsInput)
      .mutation(
        async ({ ctx, input }): Promise<PresentedPrivacyLimits> =>
          present(async () =>
            presentPrivacyLimits(
              await dependencies.setPrivacyLimits.set({
                actorId: ctx.actor.userId,
                limits: input,
              }),
            ),
          ),
      ),
  });
}

/** The privacy router's type, for the root router to mount it by. */
export type PrivacyRouter = ReturnType<typeof createPrivacyRouter>;
