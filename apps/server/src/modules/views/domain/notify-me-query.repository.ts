import type { BoardQuery } from './board-query-grammar';
import type { NotifyMeQuery } from './notify-me-query';

/**
 * What saving a Notify Me query is given.
 *
 * ⚠ **There is no target-owner field, and that absence is the authorization design.**
 * `ownerId` is the *actor*, taken from the `Actor` resolved at the tRPC context
 * boundary and never from request input (ADR-0002:180-181, B14), and the write is
 * scoped `WHERE owner_id = ownerId` unconditionally. There is therefore no identifier
 * through which one actor could name another's query — the same "no unrelated-actor
 * case exists" property `create-bulletin.service.ts` states for `bulletin.create`,
 * and what makes ADR-0005 precedence rule 1 hold *by construction* here rather than
 * by an ordering a future edit could get wrong (M2-AC19).
 */
export interface SaveNotifyMeQuery {
  /** The actor, who is also the owner. See this interface's own warning. */
  readonly ownerId: string;
  readonly sourceText: string;
  readonly query: BoardQuery;
  readonly astVersion: number;
  readonly updatedAt: Date;
  /**
   * The version the caller believes is stored, or absent for a first save.
   *
   * ADR-0005:98 — mismatch is a conflict. Absent means "I believe I have no query
   * yet"; one already existing is itself the mismatch.
   */
  readonly expectedVersion?: number | undefined;
}

/**
 * The Notify Me query port.
 *
 * Declared here in `domain/` and implemented in `persistence/` (addendum §2).
 *
 * Everything behind this port addresses the actor's own query — the one row
 * `unique (owner_id)` allows them, so `views.notifyMe.update` names no row and needs to
 * name none.
 */
export interface NotifyMeQueryRepository {
  /**
   * Write the actor's own query and its `NotifyMeQueryChanged` event, **atomically**.
   *
   * One transaction covering both writes, because a saved query nobody was told about
   * and an announcement about a query that was not saved are both worse than neither
   * (addendum §10, ADR-0006).
   *
   * @throws {import('./notify-me-query.errors').NotifyMeQueryConflictError} when
   *   `expectedVersion` does not match the actor's stored query — including the
   *   case where they have none, which is how an actor supplying somebody else's version
   *   is refused without reading that somebody's row.
   */
  save(write: SaveNotifyMeQuery): Promise<NotifyMeQuery>;
}
