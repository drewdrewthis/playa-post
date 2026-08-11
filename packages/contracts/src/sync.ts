/**
 * Every mutation type ADR-0005's conflict matrix defines.
 *
 * ⚠ **Not the set the server can currently replay.** The wire schema types
 * `mutationType` as a plain string on purpose — refusing an unknown one at the
 * transport would make the input schema an oracle for what has shipped, and would
 * return a batch-fatal `BAD_REQUEST` instead of the per-envelope
 * `rejected` / `UNSUPPORTED_MUTATION_TYPE` the response shape requires. A client may
 * therefore submit any of these and must handle `rejected` for the ones this server
 * has no handler for yet.
 */
export const MUTATION_TYPES = [
  'bulletin.create',
  'bulletin.archive',
  'bulletin.report',
  'bulletin.dismiss',
  'bulletin.undismiss',
  'connection.accept',
  'trust.set',
  'notifyMe.update',
] as const;

/** One of {@link MUTATION_TYPES}. */
export type MutationType = (typeof MUTATION_TYPES)[number];

/** Largest batch `sync.submitMutations` accepts. Enforced server-side, per batch. */
export const MAX_MUTATION_BATCH_SIZE = 50;

/**
 * One offline mutation, as the client stored it.
 *
 * ⚠ **`payload` is frozen at write time.** `request_hash` is a server-computed SHA-256
 * over canonical JSON, so a payload the client normalised, re-ordered, or
 * re-serialised between attempts comes back `rejected` / `IDEMPOTENCY_KEY_REUSE`
 * instead of `replayed`. Store the object; let the transport serialise it. Likewise
 * `mutationId` is minted once and never regenerated on retry — regenerating it is
 * exactly the duplicate idempotency exists to catch, and the server cannot detect it.
 */
export interface MutationEnvelope {
  readonly mutationId: string;
  readonly mutationType: string;
  /** ISO-8601. The client's clock, used for ordering only — never for conflict resolution. */
  readonly clientCreatedAt: string;
  readonly payload: unknown;
}

/** `sync.submitMutations` input. */
export interface SubmitMutationsRequest {
  readonly mutations: readonly MutationEnvelope[];
}

/** The fixed outcome vocabulary (ADR-0005). There is no `unsupported` — that is `rejected`. */
export const MUTATION_OUTCOMES = [
  'applied',
  'replayed',
  'conflict',
  'rejected',
  'expired',
] as const;

/** One of {@link MUTATION_OUTCOMES}. */
export type MutationOutcomeName = (typeof MUTATION_OUTCOMES)[number];

/**
 * What one envelope did.
 *
 * The three optional members are **omitted** when they do not apply, never sent as
 * `null` — with `exactOptionalPropertyTypes` on, read them as "absent" and never write
 * `{ result: undefined }`.
 *
 * `conflict` is never a silent revert: it keeps the local optimistic state visible and
 * surfaces a per-item UI state (ADR-0005 §Client).
 */
export interface MutationOutcome {
  readonly mutationId: string;
  readonly outcome: MutationOutcomeName;
  readonly result?: unknown;
  readonly conflict?: {
    readonly reason: string;
    readonly currentVersion: number;
    /**
     * Optional on the wire because an `unknown`-typed field is indistinguishable from
     * an absent one once serialised — the server always sends it with a conflict, and
     * a client should read "absent" as "the server told us nothing about current
     * state", not as a state of its own.
     */
    readonly currentState?: unknown;
  };
  readonly error?: { readonly code: string; readonly message: string };
}

/** `sync.submitMutations` output. One outcome per submitted envelope, same order. */
export interface MutationBatch {
  readonly results: readonly MutationOutcome[];
}
