/**
 * The one spelling of the graph-list query key.
 *
 * Three screens read `graph.list` under this key, and the person sheet *writes* against
 * it — `invalidateQueries` after a trust save is what keeps the TRUSTED count honest. A
 * reader with a misspelled key fails loudly; an invalidator with a misspelled key fails
 * silently, forever. So the key lives here once, the same shape as
 * `NOTIFICATIONS_QUERY_KEY` in `notifications-query.ts`.
 */
export const GRAPH_LIST_QUERY_KEY = ['graph', 'list'] as const;
