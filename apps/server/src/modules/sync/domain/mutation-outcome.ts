/**
 * ADR-0005:32's fixed outcome vocabulary.
 *
 * **Five values, and no sixth.** "Unsupported" is not one of them — an in-matrix type
 * with no handler in this milestone is a `rejected` carrying
 * {@link import('./sync.errors').UnsupportedMutationTypeError}'s code, which is what
 * keeps the response shape stable as handlers arrive rather than growing a state
 * clients must learn and then unlearn.
 */
export const MUTATION_OUTCOMES = ['applied', 'replayed', 'conflict', 'rejected', 'expired'] as const;

/** One of {@link MUTATION_OUTCOMES}. */
export type MutationOutcomeName = (typeof MUTATION_OUTCOMES)[number];

/**
 * What a version mismatch tells a client so it can show both sides and let the person
 * pick (ADR-0005: "Never last-write-wins").
 *
 * ⚠ **Declared, and never produced in M2.** `offline-replay.feature` cuts the conflict
 * paths to M5, and no M2 mutation compares a version. It is declared anyway because it
 * is the half of ADR-0005's response shape that is a *leak channel*: returning
 * `currentVersion`/`currentState` to an actor who is not party to the resource would
 * disclose a third party's state through an error path (ADR-0005:73-76). A test can
 * only assert that absence against a field that exists, which is exactly what
 * `offline-replay.integration.test.ts`'s actorship scenario does.
 */
export interface MutationConflict {
  readonly reason: string;
  readonly currentVersion: number;
  readonly currentState: unknown;
}

/**
 * A refusal, in the same stable-code shape every other surface uses.
 *
 * The code, the message, and nothing else — no stack, no cause chain, no internal
 * detail (M2-AC18). It is
 * {@link import('../../../shared/errors/application-error').ApplicationError}'s own
 * `toJSON()` shape, restated here because this is a payload field rather than a thrown
 * error: the envelope's failures are *data* in a 200 response, since one bad envelope
 * must not fail the batch (ADR-0005: "The response is per-envelope, never
 * batch-fatal").
 */
export interface MutationFailure {
  readonly code: string;
  readonly message: string;
}

/** ADR-0005's per-envelope response. */
export interface MutationOutcome {
  readonly mutationId: string;
  readonly outcome: MutationOutcomeName;
  /** What the handler produced, or what a previous run of it produced on a replay. */
  readonly result?: unknown;
  /** Present only with `outcome: 'conflict'`. See {@link MutationConflict}. */
  readonly conflict?: MutationConflict;
  /** Present only with `outcome: 'rejected'` or `'expired'`. */
  readonly error?: MutationFailure;
}

/**
 * One response per envelope, in the order the batch was received.
 *
 * A wrapper rather than a bare array so that a future batch-level fact — a server
 * clock, a retention horizon — has somewhere to land without changing every call site,
 * the same argument `bulletins`' `BoardPage` makes.
 */
export interface MutationBatchResult {
  readonly results: readonly MutationOutcome[];
}
