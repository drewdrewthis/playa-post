/**
 * The bulletins their authors have removed, as something that can be swept away
 * (issue #169).
 *
 * ⚠ **`archived_at` is the soft delete, and always was.** Decision D9 renamed the action
 * to "Remove", kept `archivedAt` as the mechanism's name on the wire, and deferred *how
 * long a removed bulletin lives* to #169. This port is that answer and nothing more: the
 * write path is untouched, `bulletin.archive` still stamps the column, and the author's
 * own `bulletins.listMine` still shows the row — until it is older than the retention
 * window, at which point it stops existing for everybody including them.
 *
 * ⚠ **A second port beside {@link import('../domain/bulletin.repository').BulletinRepository}
 * rather than a method on it**: that
 * one is the author's own rows, addressed by an actor, and this one is addressed by a
 * clock. Composition can therefore hand the purge a capability that deletes old rows and
 * cannot read, create, or archive a bulletin.
 *
 * ⚠ **This interface is not imported by the entrypoint that drives it.**
 * `entrypoints/purge/` declares its own narrower structural port and this satisfies it —
 * a scheduler that named this type would know which module it is sweeping.
 */
export interface RemovedBulletinsRepository {
  /**
   * Hard-delete every bulletin removed strictly before `removedBefore`.
   *
   * ⚠ **Its reports and dismissals go with it, by cascade.** Both are facts about one
   * bulletin, held by `modules/moderation`, and neither has any meaning once the bulletin
   * is gone — so the `ON DELETE CASCADE` added in
   * `20260812150000_soft_delete_and_purge.sql` is what removes them, rather than a
   * statement here reaching into another module's tables (addendum §19).
   *
   * ⚠ **Expiry is not removal.** A bulletin whose `expires_at` has passed is absent from
   * every viewer's board and still its author's; only `archived_at` — the thing a person
   * deliberately did — is swept. Widening this to expiry would delete content nobody
   * asked to be rid of.
   *
   * Idempotent — a second call with the same cutoff removes nothing — and emits no
   * outbox event: retention housekeeping is not a fact about anybody's state, and a
   * consumer told "your bulletin was removed" thirty days after its author removed it has
   * nothing to do with that.
   *
   * @returns How many rows were removed, not counting the cascaded dependents.
   */
  purge(removedBefore: Date): Promise<number>;
}
