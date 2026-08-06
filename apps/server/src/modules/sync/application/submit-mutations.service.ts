import { ApplicationError } from '../../../shared/errors/application-error';
import {
  MAX_MUTATION_BATCH_SIZE,
  type MutationEnvelope,
} from '../domain/mutation-envelope';
import type {
  MutationActorshipCheckRegistry,
  MutationEffect,
  MutationHandlerRegistry,
} from '../domain/mutation-handler';
import type { MutationBatchResult, MutationOutcome } from '../domain/mutation-outcome';
import { hashMutationRequest } from '../domain/mutation-request-hash';
import type { MutationResultRepository } from '../domain/mutation-result.repository';
import { isMutationType, type MutationType } from '../domain/mutation-type';
import {
  IdempotencyKeyReuseError,
  MutationBatchTooLargeError,
  UnsupportedMutationTypeError,
} from '../domain/sync.errors';

/**
 * One `sync.submitMutations` call.
 *
 * ⚠ `actorId` is the actor resolved at the tRPC context boundary and travels *beside*
 * the envelopes rather than inside them (ADR-0002 §5a, B14). One batch is one actor:
 * ADR-0005's ordering rule is "per-actor FIFO", and a batch that could name two actors
 * would have no meaningful order and no single subject for the actorship gate.
 */
export interface SubmitMutationsCommand {
  readonly actorId: string;
  /** Applied in the order received (ADR-0005 "Ordering"). */
  readonly envelopes: readonly MutationEnvelope[];
}

export interface SubmitMutationsService {
  submit(command: SubmitMutationsCommand): Promise<MutationBatchResult>;
}

/** Collaborators, injected rather than resolved (addendum §12, ADR-0003). */
export interface SubmitMutationsDependencies {
  readonly mutationResults: MutationResultRepository;
  /** Assembled in `composition/`. See {@link MutationHandlerRegistry}. */
  readonly handlers: MutationHandlerRegistry;
  /** Assembled in `composition/`. See {@link MutationActorshipCheckRegistry}. */
  readonly actorshipChecks: MutationActorshipCheckRegistry;
}

/** A refused envelope, in ADR-0005's per-envelope response shape. */
function rejected(mutationId: string, error: ApplicationError): MutationOutcome {
  // No `conflict` key, and that absence is load-bearing rather than incidental: a
  // conflict envelope carries `currentVersion`/`currentState`, which for a refusal an
  // unrelated actor triggered would disclose a resource they are not party to
  // (ADR-0005:73-76).
  return { mutationId, outcome: 'rejected', error: { code: error.code, message: error.message } };
}

/**
 * The offline sync envelope (M2.13) — ADR-0005's transport, idempotency, and precedence
 * in one place, because they are one decision made in one order.
 *
 * **The order is the security property, and it is this:**
 *
 * 1. **Batch bound.** Over {@link MAX_MUTATION_BATCH_SIZE} envelopes is a malformed
 *    request and throws before anything is read, written, or dispatched.
 * 2. **Actorship, per envelope, type-agnostic and pre-dispatch** — ADR-0005 precedence
 *    rule 1, "evaluated before any handler" (ADR-0005:68-72). An actor with no
 *    relationship to the subject is refused *here*, with
 *    {@link import('../domain/sync.errors').MutationActorshipError}'s code, before
 *    anything discovers whether a handler exists.
 * 3. **Idempotency.** Same `mutationId` for this actor with a matching payload hash and
 *    type → the stored result, `replayed`. A different hash → `IDEMPOTENCY_KEY_REUSE`,
 *    never a silent second application.
 * 4. **Dispatch.** A recognised type with no M2 handler → `rejected` /
 *    `UNSUPPORTED_MUTATION_TYPE`.
 *
 * ⚠ **Do not move step 2 below step 4.** M2 wires exactly one replayable handler, so
 * every other M2 mutation type would answer "not implemented" to an unrelated actor and
 * M2-AC19's sync column would be green for the wrong reason — blocking finding B-2 in
 * `m2-lane-briefs.md`'s revision log, and the property
 * `offline-replay.integration.test.ts`'s third scenario asserts by *code* rather than
 * by mere rejection.
 *
 * ⚠ **Known deviation from ADR-0005:50-51, recorded rather than hidden.** The ADR
 * requires the `mutation_results` row to be written "inside the same transaction as the
 * effect and the outbox event — one commit". A handler here calls the owning module's
 * public application interface, which opens and commits its own transaction, and
 * joining it would mean sync holding another module's transaction handle — a reach-in
 * §19 forbids and which `m2-lane-briefs.md` §L4 forbids this lane explicitly ("must not
 * touch `modules/bulletins/persistence/`"). The residual window is a crash between the
 * handler's commit and {@link MutationResultRepository.save}, which would let a replay
 * apply the effect twice. Closing it needs a unit-of-work seam across module
 * boundaries; that is an ADR amendment, not a local fix.
 */
export function createSubmitMutationsService(
  dependencies: SubmitMutationsDependencies,
): SubmitMutationsService {
  /**
   * Step 2. Returns the refusal rather than throwing it, because one refused envelope
   * must not fail the batch (ADR-0005: "never batch-fatal").
   */
  async function refuseUnlessActorship(
    actorId: string,
    mutationId: string,
    mutationType: MutationType,
    payload: unknown,
  ): Promise<MutationOutcome | null> {
    const check = dependencies.actorshipChecks[mutationType];
    if (check === undefined) {
      return null;
    }

    try {
      await check({ actorId, mutationId, mutationType, payload });
      return null;
    } catch (error) {
      if (error instanceof ApplicationError) {
        return rejected(mutationId, error);
      }
      // Not a refusal — a fault. Reporting it as a rejected envelope would tell a
      // client its change was refused on the merits and invite it to give up on a
      // mutation the server merely failed to evaluate.
      throw error;
    }
  }

  async function applyOne(
    actorId: string,
    envelope: MutationEnvelope,
  ): Promise<MutationOutcome> {
    const { mutationId, payload } = envelope;
    const mutationType = isMutationType(envelope.mutationType) ? envelope.mutationType : null;

    if (mutationType !== null) {
      const refusal = await refuseUnlessActorship(actorId, mutationId, mutationType, payload);
      if (refusal !== null) {
        return refusal;
      }
    }

    const requestHash = await hashMutationRequest(payload);
    const stored = await dependencies.mutationResults.findByActorAndMutationId(
      actorId,
      mutationId,
    );

    if (stored !== null) {
      return stored.requestHash === requestHash && stored.mutationType === envelope.mutationType
        ? { mutationId, outcome: 'replayed', result: stored.result }
        : rejected(mutationId, new IdempotencyKeyReuseError());
    }

    const handler = mutationType === null ? undefined : dependencies.handlers[mutationType];
    if (mutationType === null || handler === undefined) {
      return rejected(mutationId, new UnsupportedMutationTypeError(envelope.mutationType));
    }

    let effect: MutationEffect;
    try {
      effect = await handler.handle({ actorId, mutationId, mutationType, payload });
    } catch (error) {
      if (error instanceof ApplicationError) {
        return rejected(mutationId, error);
      }
      throw error;
    }

    await dependencies.mutationResults.save({
      mutationId,
      actorId,
      mutationType,
      requestHash,
      outcome: 'applied',
      result: effect.result,
    });

    return { mutationId, outcome: 'applied', result: effect.result };
  }

  return {
    async submit(command: SubmitMutationsCommand): Promise<MutationBatchResult> {
      if (command.envelopes.length > MAX_MUTATION_BATCH_SIZE) {
        throw new MutationBatchTooLargeError(MAX_MUTATION_BATCH_SIZE);
      }

      const results: MutationOutcome[] = [];
      // Sequential on purpose. ADR-0005: "the server applies a batch in the order
      // received"; a client sends per-actor FIFO and does not advance past an
      // unresolved envelope, so applying two of its mutations concurrently would
      // reorder a queue the client deliberately serialised.
      for (const envelope of command.envelopes) {
        results.push(await applyOne(command.actorId, envelope));
      }

      return { results };
    },
  };
}
