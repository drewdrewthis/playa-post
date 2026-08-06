import type { NotifyMeQuery } from './notify-me-query';

/** Event type name, past tense (addendum §20). Stable — consumers subscribe to it. */
export const NOTIFY_ME_QUERY_CHANGED = 'NotifyMeQueryChanged';

/**
 * Somebody's saved Notify Me query is now different.
 *
 * **Identifiers and routing data only** — no source text, no AST. ADR-0006 is explicit
 * that a payload carries what a consumer needs to *route*, never content, and a saved
 * query is content: it is a statement about what a person is interested in, which is
 * exactly the sort of thing an outbox row must not leave lying around in a log
 * (M2-AC16). A consumer that needs the query re-reads it through this module's own
 * read path, which also means it can never act on a query the owner has since changed.
 *
 * Written to `app.outbox_events` **in the same transaction as the write it describes**
 * (addendum §10, ADR-0006). Nobody publishes it from here; the drainer is the only
 * publisher.
 */
export interface NotifyMeQueryChanged {
  readonly type: typeof NOTIFY_ME_QUERY_CHANGED;
  readonly occurredAt: Date;
  /** The aggregate — and the owner, because the two are the same thing here (D1). */
  readonly ownerId: string;
  /** The version the query now carries, so a consumer can order its own state. */
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
    ownerId: query.ownerId,
    version: query.version,
  };
}
