/**
 * The port onto "which bulletins has this viewer taken off their own board".
 *
 * Declared here in `modules/bulletins` and **implemented by `modules/moderation`**,
 * which owns `app.bulletin_reports` and `app.bulletin_dismissals`. The direction is the
 * whole point: the board is this module's read, so the *shape of the question* belongs
 * here, while the tables that answer it belong to the module that writes them. The
 * alternative — this module's SQL joining moderation's tables — is a cross-module
 * reach-in that `no-cross-module-persistence` cannot see (a `.sql` file has no import
 * edge) and that would put a second module's schema inside the one query every board
 * read runs.
 *
 * ⚠ **This is a suppression list, not a visibility rule.** `app.visible_bulletins`
 * remains the single definition of what a viewer is *authorized* to see (ADR-0002 §6);
 * this only removes things they have said they do not want shown. That distinction is
 * why a report does not make `bulletins.getById` answer `BULLETIN_GONE`: reporting says
 * "keep this off my board", not "revoke my access", and folding it into the visibility
 * function would also make a second report of the same bulletin fail instead of
 * converging the way ADR-0005's matrix requires.
 *
 * ⚠ **It can only narrow.** There is no method here that could add a bulletin to a
 * board, and no argument through which one could be named — B10 stated as a signature,
 * the same way `VisibleBulletinsRepository` states it.
 */
export interface HiddenBulletinsRepository {
  /**
   * @param viewerId - The reading actor's `app.users.id`.
   * @returns The bulletin IDs this viewer has reported or dismissed. Empty for a viewer
   *   who has done neither, which is the common case and must cost the board nothing.
   */
  findHiddenFor(viewerId: string): Promise<ReadonlySet<string>>;
}
