import { TRPCError } from '@trpc/server';

import { ApplicationError } from '../../../shared/errors/application-error';
import { router, signedInProcedure } from '../../../shared/trpc/trpc';
import type { CompleteOnboardingService } from '../application/complete-onboarding.service';
import { HandleImmutableError } from '../domain/user.errors';

import { completeOnboardingInput } from './complete-onboarding.input';
import { presentUser, type PresentedUser } from './user.presenter';

/** The application operations this router speaks for. One use case, one procedure. */
export interface IdentityRouterDependencies {
  readonly completeOnboarding: CompleteOnboardingService;
}

/**
 * Give an {@link ApplicationError} the transport status it deserves.
 *
 * Without this, an application error escapes as tRPC's default `INTERNAL_SERVER_ERROR`
 * — a 500 for a user typo. The stable application code still travels either way
 * (`trpc.ts`'s `errorFormatter` lifts it into `data.applicationCode`), so this decides
 * the HTTP status and nothing else.
 *
 * `HANDLE_IMMUTABLE` is a **conflict**, not a bad request: the submitted handle was
 * fine, the account's state is what refuses. Every other handle rule is a rejection of
 * the input itself.
 *
 * Messages are passed through because ADR-0002 §10 is already satisfied at the source:
 * `user.errors.ts` gives the two "already taken" refusals one identical, generic
 * sentence, so nothing here can leak which of them fired.
 */
function asTrpcError(error: ApplicationError): TRPCError {
  return new TRPCError({
    code: error instanceof HandleImmutableError ? 'CONFLICT' : 'BAD_REQUEST',
    message: error.message,
    cause: error,
  });
}

/**
 * The identity module's tRPC surface.
 *
 * **There is exactly one procedure, and there is deliberately no handle-availability
 * check** (escalation E5). An availability endpoint is a people-existence oracle, in a
 * product whose PDF §4 promises there is no people search: anyone could enumerate who
 * exists by guessing handles, without ever signing in. Submitting is how a handle
 * turns out to be taken, and the refusal says only "not available".
 *
 * The procedure takes no identifier for the caller. `authUserId` comes off the
 * verified token via `signedInProcedure` (ADR-0002:180-181, B14).
 */
export function createIdentityRouter(dependencies: IdentityRouterDependencies) {
  return router({
    completeOnboarding: signedInProcedure
      .input(completeOnboardingInput)
      .mutation(async ({ ctx, input }): Promise<PresentedUser> => {
        try {
          const { user } = await dependencies.completeOnboarding.complete({
            authUserId: ctx.principal.authUserId,
            handle: input.handle,
            displayName: input.displayName,
          });

          return presentUser(user);
        } catch (error) {
          if (error instanceof ApplicationError) {
            throw asTrpcError(error);
          }
          throw error;
        }
      }),
  });
}

/** The identity router's type, for the root router to mount it by. */
export type IdentityRouter = ReturnType<typeof createIdentityRouter>;
