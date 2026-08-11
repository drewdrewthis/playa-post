import type { NotifyMeQuery } from './notify-me-query';

/** Event type name, past tense (addendum §20). Stable — consumers subscribe to it. */
export const NOTIFY_ME_QUERY_CHANGED = 'NotifyMeQueryChanged';

/**
 * One of somebody's saved Notify Me queries is now different.
 *
 * ⚠ **The aggregate is the query, not the person, and D16 is why.** While a person had at
 * most one query the two were the same thing and this event routed on `ownerId`. They may
 * now hold several, so an event naming only the owner would say "something about your
 * notifications changed" — which no consumer can order against its own state or act on
 * without re-reading everything. {@link queryId} is `app.outbox_events.aggregate_id`;
 * `ownerId` stays as the actor and as the routing fact a consumer actually notifies on.
 *
 * **Identifiers and routing data only** — no source text, no AST, and not the saved
 * view's id either. ADR-0006 is explicit that a payload carries what a consumer needs to
 * *route*, never content, and a saved query is content: it is a statement about what a
 * person is interested in, which is exactly the sort of thing an outbox row must not leave
 * lying around in a log (M2-AC16). A consumer that needs the query re-reads it through
 * this module's own read path, which also means it can never act on a query the owner has
 * since changed.
 *
 * Written to `app.outbox_events` **in the same transaction as the write it describes**
 * (addendum §10, ADR-0006). Nobody publishes it from here; the drainer is the only
 * publisher.
 */
export interface NotifyMeQueryChanged {
  readonly type: typeof NOTIFY_ME_QUERY_CHANGED;
  readonly occurredAt: Date;
  /** The aggregate: `app.notify_me_queries.id`. See this interface's own warning. */
  readonly queryId: string;
  /** Who would be notified — the routing fact, and the event's actor. */
  readonly ownerId: string;
  /** The version *this query* now carries, so a consumer can order its own state. */
  readonly version: number;
}

/**
 * Build the event for a query that has just been written.
 *
 * @param query - The stored row **after** the write, so `version` and `occurredAt`
 *   are what the database committed rather than what the caller hoped for.
 */
export function notifyMeQueryChanged(query: NotifyMeQuery): NotifyMeQueryChanged {
  return {
    type: NOTIFY_ME_QUERY_CHANGED,
    occurredAt: query.updatedAt,
    queryId: query.id,
    ownerId: query.ownerId,
    version: query.version,
  };
}

/** Event type name, past tense (addendum §20). Stable — consumers subscribe to it. */
export const NOTIFY_ME_QUERY_CLEARED = 'NotifyMeQueryCleared';

/**
 * One of somebody's saved Notify Me queries is gone.
 *
 * ⚠ **A second event type rather than a `NotifyMeQueryChanged` with an empty query**,
 * because that event carries a `version` "so a consumer can order its own state" and a
 * removal has no version to carry — a zero or a repeat would be a number a consumer
 * would order against and get wrong. Written when a bell is turned off, and when a view a
 * query was designated from is deleted (ADR-0016).
 *
 * ⚠ **It names the query that went, which under D16 is the whole point.** A person may
 * hold several, so "this person cleared something" would tell a consumer to stop sending
 * for queries that are still switched on. {@link queryId} is the row that was deleted,
 * read back from the `DELETE` rather than assumed.
 *
 * Turning one notification *off* is a state change worth announcing for the same reason
 * turning it on is: a consumer that cached "this person is notifying on that" would
 * otherwise never learn that they stopped.
 *
 * Identifiers and routing data only — no source text, no AST (ADR-0006, M2-AC16).
 */
export interface NotifyMeQueryCleared {
  readonly type: typeof NOTIFY_ME_QUERY_CLEARED;
  readonly occurredAt: Date;
  /** The aggregate: the `app.notify_me_queries.id` that no longer exists. */
  readonly queryId: string;
  /** Who would have been notified — the routing fact, and the event's actor. */
  readonly ownerId: string;
}

/** Build the event for a query that has just been removed. */
export function notifyMeQueryCleared(
  ownerId: string,
  queryId: string,
  occurredAt: Date,
): NotifyMeQueryCleared {
  return { type: NOTIFY_ME_QUERY_CLEARED, occurredAt, queryId, ownerId };
}
