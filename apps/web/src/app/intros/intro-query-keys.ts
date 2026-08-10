/**
 * The one spelling of each intros query key.
 *
 * Three surfaces read these and two *write* against them — the intro sheet invalidates
 * the outbox after a send, the graph's inbox invalidates itself after a decision. A
 * reader with a misspelled key fails loudly; an invalidator with a misspelled key fails
 * silently, forever, leaving a requester looking at "Request an intro" for a request
 * they just made. So each key lives here once, the same shape as
 * `graph/graph-query-keys.ts`.
 */

/** The via's asks and the target's introductions — `intros.listInbox`. */
export const INTRO_INBOX_QUERY_KEY = ['intros', 'listInbox'] as const;

/** The requester's own record — `intros.listOutbox`. */
export const INTRO_OUTBOX_QUERY_KEY = ['intros', 'listOutbox'] as const;

/**
 * Who could introduce this viewer to one particular person.
 *
 * Keyed by the target, because the answer is: two open sheets about two people must not
 * share one cache entry, and the answer for one target says nothing about another.
 */
export function introViaCandidatesQueryKey(targetUserId: string): readonly string[] {
  return ['intros', 'viaCandidates', targetUserId];
}
