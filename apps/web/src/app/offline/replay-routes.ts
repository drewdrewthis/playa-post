/**
 * Which way home each queued mutation takes.
 *
 * Data rather than a condition inside the drainer, so the routing table can be held
 * against `QUEUED_MUTATION_TYPES` by a test (`replay-routes.unit.test.ts`). A type queued
 * with no route is a row that sits `pending` forever with no affordance to clear it — a
 * failure that is invisible until somebody's write is already lost in it.
 */

/**
 * The types replayed through `sync.submitMutations`, the idempotent path.
 *
 * The server stores each result against `(actorId, mutationId, request_hash)`, so a
 * second submission of the same envelope comes back `replayed` carrying the original
 * result and writes nothing twice. Membership here is a fact about
 * `composition/container.ts`'s handler registry, not a preference: a type with no handler
 * there comes back `rejected` / `UNSUPPORTED_MUTATION_TYPE`.
 */
export const SYNC_REPLAYED_MUTATION_TYPES: readonly string[] = ['bulletin.create', 'note.pin'];

/**
 * The types replayed through their own tRPC procedure.
 *
 * ⚠ `bulletin.archive` has an *actorship check* registered in `composition/container.ts`
 * but **no handler**, so submitting it through `sync.submitMutations` would return
 * `rejected` / `UNSUPPORTED_MUTATION_TYPE` and the archive would silently never happen.
 * Queuing it (so the offline affordance and the badge are real) while replaying it
 * directly is the honest shape until that registry gains the entry — see the L5 PR body.
 */
export const DIRECTLY_REPLAYED_MUTATION_TYPES: readonly string[] = ['bulletin.archive'];
