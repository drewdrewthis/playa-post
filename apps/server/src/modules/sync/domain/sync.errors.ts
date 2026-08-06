import { ApplicationError } from '../../../shared/errors/application-error';

/**
 * The batch carries more envelopes than {@link
 * import('./mutation-envelope').MAX_MUTATION_BATCH_SIZE} allows.
 *
 * The one failure here that is **batch-fatal rather than per-envelope**, and
 * deliberately so: an oversized batch is a malformed *request*, not fifty-one refused
 * mutations, and answering it with a per-envelope array would invite a client to retry
 * the same too-large batch forever while reading a plausible-looking response.
 *
 * @param maximum - The bound that was exceeded, passed in rather than imported: the
 *   constant's module has no reason to know about this class, and the message is the
 *   only place the number is user-facing.
 */
export class MutationBatchTooLargeError extends ApplicationError {
  static readonly code = 'MUTATION_BATCH_TOO_LARGE';

  constructor(maximum: number) {
    super(
      MutationBatchTooLargeError.code,
      `A sync batch may carry at most ${String(maximum)} mutations.`,
    );
    this.name = 'MutationBatchTooLargeError';
  }
}

/**
 * The acting actor has no relationship to the subject of this mutation.
 *
 * **ADR-0005 precedence rule 1, and the reason the sync half of B13 is not vacuously
 * green.** Actorship is verified *before* type dispatch and *before* any version
 * comparison, so an unrelated actor receives this code rather than
 * {@link UnsupportedMutationTypeError}'s — which would prove only "M2 has not built
 * this mutation" — and never receives a conflict envelope carrying `currentVersion` or
 * `currentState` (ADR-0005:69-76).
 *
 * ⚠ The message must never name the subject or say why. "That bulletin belongs to
 * someone else" answers "yes, that ID names something real" to anyone willing to ask,
 * which is the existence oracle ADR-0002 §10 closes and `BulletinGoneError` already
 * establishes the house style for.
 */
export class MutationActorshipError extends ApplicationError {
  static readonly code = 'MUTATION_ACTOR_UNAUTHORIZED';

  constructor() {
    super(MutationActorshipError.code, 'That change is not available to you.');
    this.name = 'MutationActorshipError';
  }
}

/**
 * This server recognises the mutation type but has no handler for it in this milestone.
 *
 * ⚠ **It is reached only after the actorship gate has run.** Reversing that order would
 * make the six non-replayable M2 types answer "not implemented" to an unrelated actor,
 * and M2-AC19's sync column would pass while asserting nothing — blocking finding B-2
 * in `m2-lane-briefs.md`'s revision log.
 *
 * @param mutationType - Echoed back so a client can tell which envelope it was. Safe:
 *   the caller sent it, and naming a type discloses nothing about anybody's data.
 */
export class UnsupportedMutationTypeError extends ApplicationError {
  static readonly code = 'UNSUPPORTED_MUTATION_TYPE';

  constructor(mutationType: string) {
    super(
      UnsupportedMutationTypeError.code,
      `This server cannot apply "${mutationType}" mutations yet.`,
    );
    this.name = 'UnsupportedMutationTypeError';
  }
}

/**
 * A `mutationId` already used by this actor has come back carrying a different payload.
 *
 * ADR-0005: "a client bug or an attack; never silently apply the second one". The
 * alternative — treating it as a fresh mutation — makes the idempotency key mean
 * nothing, and treating it as a replay would answer a request the client never made
 * with a result belonging to a different one.
 */
export class IdempotencyKeyReuseError extends ApplicationError {
  static readonly code = 'IDEMPOTENCY_KEY_REUSE';

  constructor() {
    super(
      IdempotencyKeyReuseError.code,
      'That mutation id has already been used for a different change.',
    );
    this.name = 'IdempotencyKeyReuseError';
  }
}

/**
 * The envelope's `payload` is not the shape its `mutationType` requires.
 *
 * `payload` is `unknown` on the wire — one procedure carries every mutation type, so
 * there is no single schema the transport could validate it against — which makes shape
 * checking a job for the adapter that knows the type. Raised as an `ApplicationError`
 * rather than left as a thrown parse failure so it comes back as one refused envelope
 * with a stable code instead of a 500 for the whole batch.
 */
export class MutationPayloadInvalidError extends ApplicationError {
  static readonly code = 'MUTATION_PAYLOAD_INVALID';

  constructor(mutationType: string) {
    super(
      MutationPayloadInvalidError.code,
      `That payload is not a valid "${mutationType}" mutation.`,
    );
    this.name = 'MutationPayloadInvalidError';
  }
}
