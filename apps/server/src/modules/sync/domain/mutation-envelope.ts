/**
 * How many envelopes one `sync.submitMutations` call may carry.
 *
 * ADR-0005's "Transport" section: "an ordered batch (max 50) of envelopes". An
 * **application** bound rather than a `z.array(...).max(50)` at the transport, for the
 * reason `bulletins/transport/create-bulletin.input.ts` gives about title and body: a
 * 51-envelope batch must come back as the stable `MUTATION_BATCH_TOO_LARGE` code
 * M2-AC18 asks for, not as a generic transport `BAD_REQUEST`, and restating the number
 * in a schema would put the rule in two places for one of them to drift.
 */
export const MAX_MUTATION_BATCH_SIZE = 50;

/**
 * One queued mutation as a client submits it — addendum §14's envelope.
 *
 * ⚠ **There is no `actorId` field, and there must never be one.** ADR-0005's envelope
 * lists one, but ADR-0002:180-181 and B14 forbid a procedure input from carrying a
 * viewer, user, actor, or owner identifier, and an offline queue is exactly where such
 * a field would be most convenient and most catastrophic: a replayed envelope naming
 * its own author is total silent impersonation. The acting actor is resolved at the
 * tRPC context boundary and travels beside the batch
 * ({@link import('../application/submit-mutations.service').SubmitMutationsCommand}).
 *
 * `expectedVersion` is absent for the same reason it is unused: M2 implements no
 * version-comparing mutation (ADR-0005's matrix gives `bulletin.create` and
 * `bulletin.archive` `expectedVersion: no`), and `offline-replay.feature` cuts the
 * `expectedVersion` paths to M5.
 */
export interface MutationEnvelope {
  /**
   * Client-generated, and the identity of "have I seen this mutation before".
   *
   * ADR-0005 specifies UUID v7 for k-sortability. Nothing here enforces the *version* —
   * a v4 is still a perfectly good idempotency key, and refusing one would fail a
   * correct client over an ordering property this milestone does not use.
   */
  readonly mutationId: string;
  /** A wire string; {@link import('./mutation-type').isMutationType} decides. */
  readonly mutationType: string;
  /** ISO-8601, as the client's clock read it. */
  readonly clientCreatedAt: string;
  /** The owning module's command, shaped by whatever the handler expects. */
  readonly payload: unknown;
}
