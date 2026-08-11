/**
 * The mutation types `sync.submitMutations` recognises.
 *
 * The write operations the M2 slice exposes are `bulletin.create`, `bulletin.archive`,
 * `bulletin.report`, `bulletin.dismiss`, `connection.accept`, `trust.set` and
 * `notifyMe.update` — the same seven M2-AC19's B13 matrix walks "whether submitted via
 * tRPC or via `sync.submitMutations`". `note.pin` joined them with the private-note
 * channel (issue #88, decision D6), and `bulletin.undismiss` with the Dismissed category
 * (issue #170) — a dismissal that can be taken back is a second write on the same
 * subject, and leaving it off this list would have made an unrelated actor's queued
 * un-dismissal refused for the wrong reason.
 * ADR-0005's v1 conflict matrix names more (`bulletin.update`, `connection.invite`,
 * `connection.remove`, `block.create`, `view.save`, `intro.request`); each of those
 * arrives with the milestone that builds the mutation, because a type listed here with
 * nothing behind it is a type an actorship gate cannot check and a handler cannot serve.
 *
 * ⚠ **Recognised is not the same as implemented.** Two of these have *replayable*
 * handlers — `bulletin.create` and `note.pin`. Every other member is recognised so that
 * the type-agnostic actorship gate has something to check *before* dispatch discovers
 * there is no handler; without that, an unrelated actor submitting `bulletin.archive`
 * would be refused for the wrong reason and B13's sync column would be vacuously green
 * (`m2-lane-briefs.md` §"The sync half of B13 is not vacuously green").
 *
 * ⚠ `note.pin` has **no** entry in the actorship-check registry, and that is correct
 * rather than an omission: like `bulletin.create` it names no pre-existing subject the
 * actor could be unrelated *to* — the author is the acting actor and the note does not
 * exist yet. Its one authorization question, "may I write to this recipient", is decided
 * inside the insert statement itself (`postgres-note.repository.ts`), so it is settled
 * before any row lands rather than by a gate that could be removed.
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
  'note.pin',
] as const;

/** One of {@link MUTATION_TYPES}. */
export type MutationType = (typeof MUTATION_TYPES)[number];

/**
 * Is this wire string a mutation type this server recognises?
 *
 * The envelope's `mutationType` is a plain `string` on the wire on purpose: refusing an
 * unknown one at the transport would make the tRPC input schema an oracle for which
 * mutations this server has shipped, and would hand a client a generic `BAD_REQUEST`
 * instead of the per-envelope `rejected` / `UNSUPPORTED_MUTATION_TYPE` ADR-0005's
 * response shape requires (there is no `unsupported` outcome — ADR-0005:32 fixes the
 * vocabulary at `applied | replayed | conflict | rejected | expired`).
 */
export function isMutationType(value: string): value is MutationType {
  return (MUTATION_TYPES as readonly string[]).includes(value);
}
