import type { BoardQuery } from '../domain/board-query-grammar';

/**
 * One saved Notify Me query, projected for evaluation.
 *
 * **This is the read model `modules/notifications` consumes, and it is deliberately
 * narrower than {@link import('../domain/notify-me-query').NotifyMeQuery}**: the
 * evaluator needs to know *who* saved a filter and *what it narrows to*, and nothing
 * else. `sourceText` is absent because a consumer that can see the text a person typed
 * can put it in a log line or a payload, and `version`/`updatedAt` are this module's
 * concurrency bookkeeping rather than anybody else's business.
 *
 * Exporting a projection rather than the entity is addendum §19's rule for cross-module
 * reads — importing another module's domain entity would make every consumer a boundary
 * violation — and the same shape ratified decision (c) gives `modules/graph`'s
 * `VisiblePerson`.
 */
export interface SavedNotifyMeQuery {
  /** `app.users.id` of the person who saved it, and who would be notified. */
  readonly ownerId: string;
  /** The validated AST, already narrowed to the current grammar's shape. */
  readonly query: BoardQuery;
}

/**
 * The port onto the saved Notify Me queries, as a *reader*.
 *
 * Declared in `application/` rather than `domain/` for `modules/graph`'s reason: this
 * is a read model with no aggregate to reconstruct. It is the small public application
 * interface (addendum §19) through which `modules/notifications` reaches these queries
 * — **`app.notify_me_queries` belongs to this module and is read by this module's SQL
 * only.** A repository in another module selecting from that table is the reach-in the
 * boundary rules exist to forbid, and it is the one this seam closes.
 */
export interface NotifyMeQueryDirectory {
  /**
   * Every saved query stored under the grammar the running code speaks.
   *
   * ⚠ Queries carrying a different `ast_version` are **excluded, not reinterpreted**
   * (ADR-0007:70-72). A future grammar ships with a migration that re-validates the
   * stored ASTs; until it runs, the honest behaviour is to notify nobody rather than
   * to guess at a shape this evaluator does not understand.
   *
   * @returns Empty when nobody has saved a query — the common case early on.
   */
  findAllCurrent(): Promise<readonly SavedNotifyMeQuery[]>;
}
