import type { OpenedPersonalLinkFacts } from './opened-personal-link';
import type { VisibleConnectionRequest } from './visible-connection-request';

/**
 * The port onto the personal-link module's two viewer-scoped reads (issue #206).
 *
 * Declared in `application/` rather than `domain/` for the reason
 * `modules/intros/application/visible-intros.repository.ts` gives: these are **read models,
 * not domain entities**. The aggregates are
 * {@link import('../domain/personal-link').PersonalLink} and
 * {@link import('../domain/connection-request').ConnectionRequest}, behind their own write
 * ports, and inventing a second domain type to hold a projection would be the placeholder
 * layer addendum §4 forbids.
 *
 * ⚠ **Both methods project people through `app.visible_people` and join `app.users`
 * nowhere.** A card assembled from the users table would be the second person-projection
 * ADR-0002 §6a forbids, and it is the tempting shortcut on exactly these two reads —
 * because both of them are *supposed* to name somebody the reader's own graph would hide.
 */
export interface VisibleConnectionRequestsRepository {
  /**
   * What a slug resolves to for this reader.
   *
   * ⚠ **`null` is the answer to every failure**, and the caller turns it into the single
   * {@link import('../domain/personal-link.errors').PersonalLinkUnavailableError}: no such
   * slug, a slug the owner rotated away from, and an owner who has deactivated or been
   * erased are indistinguishable here by construction. The owner's card comes from an
   * *inner* join onto their own self-projection, which is what makes the third case
   * collapse into the other two rather than returning a link with no owner on it.
   *
   * @param viewerId - The reading actor's `app.users.id`, from `ctx.actor`. It decides the
   *   `connected` and `requestPending` facts and nothing else — the owner's card does not
   *   depend on it (ADR-0018 D1).
   * @param slug - The address the reader opened. A claim the database resolves, never an
   *   assertion about who is asking.
   * @param liveSince - The TTL floor from
   *   {@link import('../domain/connection-request.policy').liveRequestFloor}, so a lapsed
   *   request does not report itself as still pending.
   */
  findLinkBySlugFor(
    viewerId: string,
    slug: string,
    liveSince: Date,
  ): Promise<OpenedPersonalLinkFacts | null>;

  /**
   * The requests waiting on this reader.
   *
   * @param viewerId - The reading actor's `app.users.id`. It is the whole authorization:
   *   the statement matches `owner_id = viewerId and status = 'pending'` and nothing else,
   *   so there is no argument here through which a caller could reach somebody else's inbox
   *   (ADR-0002 §5a).
   * @param liveSince - The TTL floor. A request older than it is absent from this list and
   *   is refused by the decide path, so the two surfaces cannot disagree about what is
   *   still answerable.
   * @returns Newest first, and empty for anybody nobody has asked.
   */
  findInboxFor(viewerId: string, liveSince: Date): Promise<readonly VisibleConnectionRequest[]>;
}
