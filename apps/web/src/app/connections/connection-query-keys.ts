/**
 * The one spelling of each personal-link query key (issue #206).
 *
 * Three surfaces read these and three *write* against them — rotating replaces the You
 * screen's link, sending a request changes what the `/c/:slug` screen says, and deciding one
 * removes a row from the owner's inbox and adds an edge to the graph. A reader with a
 * misspelled key fails loudly; an invalidator with a misspelled key fails silently, forever,
 * leaving somebody looking at a link that no longer resolves. So each key lives here once,
 * the same shape as `intros/intro-query-keys.ts`.
 */

/** The caller's own link — `connections.personalLink.ensure`. */
export const PERSONAL_LINK_QUERY_KEY = ['connections', 'personalLink', 'mine'] as const;

/** The requests waiting on the caller — `connections.requests.listInbox`. */
export const CONNECTION_REQUEST_INBOX_QUERY_KEY = [
  'connections',
  'requests',
  'listInbox',
] as const;

/**
 * What one slug resolves to for this viewer — `connections.personalLink.open`.
 *
 * Keyed by the slug, because the answer is: two links opened in one session must not share
 * a cache entry, and the answer for one says nothing about another. Sending a request
 * invalidates exactly this key, so the screen re-reads into its `requested` state rather
 * than holding a local flag that a reload would lose.
 */
export function personalLinkQueryKey(slug: string): readonly string[] {
  return ['connections', 'personalLink', 'open', slug];
}
