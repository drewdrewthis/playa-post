import type { PersonalLink } from './personal-link';

/** What minting or rotating a link is given. The slug has already been generated. */
export interface PersonalLinkWrite {
  /** The owner, taken from the resolved `Actor` and never from request input. */
  readonly ownerId: string;
  /** A fresh CSPRNG slug from {@link import('./personal-link').generatePersonalLinkSlug}. */
  readonly slug: string;
  readonly at: Date;
}

/**
 * The personal-link port — the **write** one, plus the owner's own read.
 *
 * Declared here in `domain/` and implemented in `persistence/` (addendum §2). The
 * viewer-scoped read of *somebody else's* link is a §6a-projected read model and lives
 * behind {@link import('../application/visible-connection-requests.repository').VisibleConnectionRequestsRepository}
 * instead — the same split `modules/intros` makes between `IntroRequestRepository` and
 * `VisibleIntrosRepository`. Keeping the two apart is what stops a convenience method here
 * from becoming a second person projection.
 *
 * ⚠ **There is no `findBySlug` on this port and there must never be one.** A method that
 * turned a slug into an owner id without going through `app.visible_people` would be the
 * shortcut every caller wants and the one §6a forbids — and it is the shortcut that makes
 * a deactivated owner's link keep resolving.
 */
export interface PersonalLinkRepository {
  /**
   * The caller's own link, minting one on first sight.
   *
   * ⚠ **Get-or-create in a single statement**, so two concurrent first calls cannot each
   * mint a slug. The row is keyed by `owner_id`, so the loser of the race conflicts and
   * reads back the winner's link rather than overwriting it — which matters more here than
   * it does for an invite, because overwriting *is* rotation and a page load must never
   * silently rotate somebody's published address.
   *
   * @param write - The owner and a freshly generated slug. The slug is **discarded** when
   *   a link already exists; generating one unconditionally is what keeps the statement
   *   single and is cheaper than the read it would replace.
   */
  ensureFor(write: PersonalLinkWrite): Promise<PersonalLink>;

  /**
   * Replace the caller's slug with a new one, minting the row if they had none.
   *
   * ⚠ **The old slug is overwritten, not retired**, which is what makes the old URL
   * indistinguishable from one that never existed (ADR-0018 D3). There is no second row
   * and no `revoked_at`: a reader cannot fail to filter a value that is not there.
   *
   * ⚠ **Rotation touches nothing but this row.** Existing connections and already-received
   * requests are unaffected by construction — neither table is named by the statement —
   * which is the guarantee that makes rotation guilt-free enough to actually use.
   */
  rotateFor(write: PersonalLinkWrite): Promise<PersonalLink>;
}
