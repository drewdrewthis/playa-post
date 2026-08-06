import { TRPCError } from '@trpc/server';

import { ApplicationError } from '../../../shared/errors/application-error';
import { authenticatedProcedure, router } from '../../../shared/trpc/trpc';
import type { SubmitMutationsService } from '../application/submit-mutations.service';

import { presentMutationBatch, type PresentedMutationBatch } from './mutation-result.presenter';
import { submitMutationsInput } from './submit-mutations.input';

/** The application operations this router speaks for. One use case, one procedure. */
export interface SyncRouterDependencies {
  readonly submitMutations: SubmitMutationsService;
}

/**
 * The sync module's tRPC surface.
 *
 * **One procedure, and that is the design** (ADR-0005: "Not a per-feature offline path:
 * the queue is a cross-cutting concern and belongs to `modules/sync`"). A second
 * procedure here would be a second place for the retention, idempotency, and precedence
 * rules to be applied — or forgotten.
 *
 * **No procedure takes an identifier for its caller.** The acting actor is
 * `ctx.actor.userId`, resolved once at the context boundary; the envelope carries
 * `mutationId`, `mutationType`, `clientCreatedAt`, and an opaque `payload` and nothing
 * else (ADR-0002:180-181, B14).
 */
export function createSyncRouter(dependencies: SyncRouterDependencies) {
  return router({
    /**
     * Apply an ordered batch of queued mutations.
     *
     * **Refusals are data, not status codes.** Every per-envelope outcome — `applied`,
     * `replayed`, `rejected` — comes back inside a 200, because one refused envelope
     * must not fail the other forty-nine (ADR-0005: "The response is per-envelope,
     * never batch-fatal"). The only thing that throws is a malformed *request*: a batch
     * over the size bound, which is `MUTATION_BATCH_TOO_LARGE`.
     */
    submitMutations: authenticatedProcedure
      .input(submitMutationsInput)
      .mutation(async ({ ctx, input }): Promise<PresentedMutationBatch> => {
        try {
          return presentMutationBatch(
            await dependencies.submitMutations.submit({
              actorId: ctx.actor.userId,
              // Rebuilt field by field rather than passed through: the parsed input's
              // `payload` is optional (a `z.unknown()` key may be absent), and an
              // envelope reaching the application layer without one would be a shape
              // the service has to re-check. Naming the four fields here is also what
              // keeps a future input field from silently becoming an envelope field.
              envelopes: input.mutations.map((envelope) => ({
                mutationId: envelope.mutationId,
                mutationType: envelope.mutationType,
                clientCreatedAt: envelope.clientCreatedAt,
                payload: envelope.payload,
              })),
            }),
          );
        } catch (error) {
          if (error instanceof ApplicationError) {
            // `BAD_REQUEST`, never `INTERNAL_SERVER_ERROR`: the caller sent too many
            // envelopes, which is their submission being malformed and may be named
            // without disclosing anything. The stable code travels beside it —
            // `trpc.ts`'s `errorFormatter` lifts it into `data.applicationCode`.
            throw new TRPCError({ code: 'BAD_REQUEST', message: error.message, cause: error });
          }
          throw error;
        }
      }),
  });
}

/** The sync router's type, for the root router to mount it by. */
export type SyncRouter = ReturnType<typeof createSyncRouter>;
