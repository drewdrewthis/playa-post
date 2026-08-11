/**
 * The port onto "which bulletins has this viewer **dismissed**, newest first".
 *
 * Declared here in `modules/bulletins` and **implemented by `modules/moderation`**,
 * which owns `app.bulletin_dismissals` — the same direction, and for the same reason, as
 * {@link import('./hidden-bulletins.repository').HiddenBulletinsRepository}: the
 * Dismissed category is a board read, so the shape of the question belongs to the module
 * that serves boards, while the table that answers it belongs to the module that writes
 * it (issue #170).
 *
 * ⚠ **Dismissals, and never reports.** This is the one difference from
 * `HiddenBulletinsRepository`, which unions both tables because the board's exclusion
 * does not care which one hid a bulletin. Here it is the whole point: a browsable list
 * of reports is the "what have I reported" surface M2-AC10/B9 refuses to build, and a
 * viewer who could page through their own reports is one screenshot away from an author
 * learning a report exists. A method that returned the union would be that surface, so
 * there is not one.
 *
 * ⚠ **It returns identifiers, not bulletins.** The content comes from
 * `app.visible_bulletins` through
 * {@link import('./visible-bulletins.repository').VisibleBulletinsRepository.findVisibleByIds},
 * so a dismissed bulletin the viewer may no longer see simply does not come back. Were
 * this port to return content instead, `modules/moderation` would need its own read of
 * `app.bulletins` — a second answer to "what may this viewer see" (ADR-0002 §6) in the
 * one place nobody but the dismisser would ever notice it was wrong.
 */
export interface DismissedBulletinsRepository {
  /**
   * The bulletins this viewer has dismissed, **most recently dismissed first**.
   *
   * Ordered here rather than by the caller because dismissal time lives only in this
   * module's table: the Dismissed category is a list of decisions the viewer made, so it
   * reads in the order they made them, not in the order the authors happened to post.
   *
   * @param viewerId - The reading actor's `app.users.id`, from the resolved `Actor` and
   *   never from request input (ADR-0002 §5a, B14).
   * @param limit - How many identifiers to return. Passed in rather than fixed here so
   *   the bound stays the caller's page size
   *   ({@link import('./visible-bulletins.repository').BOARD_PAGE_SIZE}) instead of a
   *   second constant in another module that could drift from it.
   * @returns Bulletin IDs only. Empty for a viewer who has dismissed nothing, which is
   *   the common case and must cost the read nothing.
   */
  findDismissedFor(viewerId: string, limit: number): Promise<readonly string[]>;
}
