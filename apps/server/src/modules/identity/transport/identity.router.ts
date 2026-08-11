import { TRPCError } from '@trpc/server';

import { ApplicationError } from '../../../shared/errors/application-error';
import { authenticatedProcedure, router, signedInProcedure } from '../../../shared/trpc/trpc';
import type { CompleteOnboardingService } from '../application/complete-onboarding.service';
import type { UpdateDisplayNameService } from '../application/update-display-name.service';
import type { VisibilitySettingService } from '../application/visibility-setting.service';
import { HandleImmutableError } from '../domain/user.errors';
import type { VisibleToDistance } from '../domain/visible-to-distance';

import { completeOnboardingInput } from './complete-onboarding.input';
import { setVisibilityInput } from './set-visibility.input';
import { updateDisplayNameInput } from './update-display-name.input';
import { presentUser, type PresentedUser } from './user.presenter';

/** The application operations this router speaks for. */
export interface IdentityRouterDependencies {
  readonly completeOnboarding: CompleteOnboardingService;
  readonly visibilitySetting: VisibilitySettingService;
  readonly updateDisplayName: UpdateDisplayNameService;
}

/** `identity.visibility.*`'s output — the caller's own setting, nothing else. */
export interface PresentedVisibilitySetting {
  readonly visibleToDistance: VisibleToDistance;
}

/**
 * `identity.updateDisplayName`'s output — the stored name, echoed back.
 *
 * The name and nothing more, following `PresentedVisibilitySetting` rather than
 * `PresentedUser`: the caller already knows its own handle and id, and the smallest
 * payload that answers "what is stored now" is the one that cannot leak the next
 * field by accident (`user.presenter.ts`).
 */
export interface PresentedDisplayName {
  readonly displayName: string;
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
 * **There is deliberately no handle-availability
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

    /*
     * The caller renames themselves, and there is deliberately **no matching read**:
     * a person's own display name already arrives on `graph.list` (they are on their
     * own graph at degree 0 with `full` disclosure), and a second answer to "what am
     * I called" is a second thing that can disagree.
     *
     * `authenticatedProcedure`, so `ctx.actor.userId` is the only identifier this
     * procedure ever sees. Together with an input carrying no identity field, that is
     * the whole of AC2: the caller cannot express renaming anybody but themselves,
     * rather than being checked against a target they supplied (ADR-0002:180-181).
     *
     * **`identity.updateDisplayName`, not `identity.displayName.set`.** The sibling
     * dial is a namespace because it genuinely has two operations; a one-procedure
     * namespace would be a placeholder for a `get` that must not exist (addendum §4).
     */
    updateDisplayName: authenticatedProcedure
      .input(updateDisplayNameInput)
      .mutation(async ({ ctx, input }): Promise<PresentedDisplayName> => {
        return {
          displayName: await dependencies.updateDisplayName.update(
            ctx.actor.userId,
            input.displayName,
          ),
        };
      }),

    // The caller's own "who can see you at all" dial. `authenticatedProcedure`, not
    // `signedInProcedure`: a privacy setting belongs to an onboarded actor, and
    // `ctx.actor.userId` is the only identifier either operation ever sees — there is
    // no input field that could name somebody else (ADR-0002:180-181).
    visibility: router({
      get: authenticatedProcedure.query(
        async ({ ctx }): Promise<PresentedVisibilitySetting> => ({
          visibleToDistance: await dependencies.visibilitySetting.get(ctx.actor.userId),
        }),
      ),

      set: authenticatedProcedure
        .input(setVisibilityInput)
        .mutation(async ({ ctx, input }): Promise<PresentedVisibilitySetting> => {
          return {
            visibleToDistance: await dependencies.visibilitySetting.set(
              ctx.actor.userId,
              input.visibleToDistance,
            ),
          };
        }),
    }),
  });
}

/** The identity router's type, for the root router to mount it by. */
export type IdentityRouter = ReturnType<typeof createIdentityRouter>;
