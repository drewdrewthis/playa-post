/**
 * The saved views somebody has deleted, as something that can be swept away (issue #169).
 *
 * ⚠ **Deliberately a second port beside {@link import('../domain/saved-view.repository').SavedViewRepository}
 * rather than a sixth method on it.** Every statement behind that port carries
 * `owner_id = <actor>`, and that is not a habit — it is what makes M5-AC16 true by
 * construction. A purge has no actor at all: it is retention housekeeping, scoped by a
 * clock rather than by a person. Putting it on the actor-scoped port would put one
 * unscoped statement among five scoped ones, where the next reader has to notice the
 * exception before trusting the rule.
 *
 * Separating them also keeps the capability separate: what composition hands the purge
 * entrypoint can delete old rows and cannot read, rename, or write anybody's views.
 *
 * ⚠ **This interface is not imported by the entrypoint that drives it.**
 * `entrypoints/purge/` declares its own narrower structural port and this satisfies it,
 * the same arrangement `NotificationFlusher` and `SendGroupedPushHandler` have: a
 * scheduler that named this type would know which module it is sweeping.
 */
export interface DeletedSavedViewsRepository {
  /**
   * Hard-delete every saved view deleted strictly before `deletedBefore`.
   *
   * Live views are untouched, and that follows from the comparison rather than from a
   * second predicate: `deleted_at` is `NULL` for a view nobody has deleted, and `NULL <
   * anything` is unknown, so a live row can never match however far back the cutoff is
   * moved.
   *
   * Idempotent — a second call with the same cutoff removes nothing, because the rows it
   * would have removed are gone. Emits no outbox event: nothing about a person's own
   * state changes here, and a consumer told "your view was deleted" thirty days after
   * they deleted it has nothing to do with that.
   *
   * @returns How many rows were removed. Reported by the purge, never by an API.
   */
  purge(deletedBefore: Date): Promise<number>;
}
