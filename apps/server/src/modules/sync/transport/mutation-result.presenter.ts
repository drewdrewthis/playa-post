import type {
  MutationBatchResult,
  MutationOutcome,
  MutationOutcomeName,
} from '../domain/mutation-outcome';

/**
 * One envelope's answer as this API renders it — ADR-0005's per-envelope response.
 *
 * The same shape as the {@link MutationOutcome} read model, restated here rather than
 * re-exported, because the wire is a contract and the domain type is an implementation
 * (the argument every other presenter in this repo makes).
 *
 * ⚠ Optional fields are **absent rather than null** when they do not apply, which is
 * what makes "no conflict envelope was returned" assertable at all. A `conflict: null`
 * would serialise a key an unrelated actor could read as "there is a conflict I am not
 * being shown", and `currentVersion`/`currentState` are the leak channel ADR-0005:73-76
 * closes by never producing one.
 */
export interface PresentedMutationOutcome {
  readonly mutationId: string;
  readonly outcome: MutationOutcomeName;
  readonly result?: unknown;
  readonly conflict?: {
    readonly reason: string;
    readonly currentVersion: number;
    readonly currentState: unknown;
  };
  readonly error?: { readonly code: string; readonly message: string };
}

/** One answer per submitted envelope, in the order they were sent. */
export interface PresentedMutationBatch {
  readonly results: readonly PresentedMutationOutcome[];
}

/**
 * Project one outcome onto the wire.
 *
 * A field-by-field copy rather than a spread of the domain object: a spread would carry
 * whatever the outcome grows next into every client payload without anyone deciding it
 * should be there, and for a type whose optional halves are a disclosure channel that
 * is not a risk worth taking twice.
 */
function presentMutationOutcome(outcome: MutationOutcome): PresentedMutationOutcome {
  return {
    mutationId: outcome.mutationId,
    outcome: outcome.outcome,
    ...(outcome.result === undefined ? {} : { result: outcome.result }),
    ...(outcome.conflict === undefined
      ? {}
      : {
          conflict: {
            reason: outcome.conflict.reason,
            currentVersion: outcome.conflict.currentVersion,
            currentState: outcome.conflict.currentState,
          },
        }),
    ...(outcome.error === undefined
      ? {}
      : { error: { code: outcome.error.code, message: outcome.error.message } }),
  };
}

/** Project a whole batch's answers. */
export function presentMutationBatch(batch: MutationBatchResult): PresentedMutationBatch {
  return { results: batch.results.map(presentMutationOutcome) };
}
