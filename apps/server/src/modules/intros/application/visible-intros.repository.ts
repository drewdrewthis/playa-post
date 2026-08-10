import type { IntroPerson } from './intro-person';
import type { VisibleIntroInboxRow, VisibleIntroOutboxRow } from './visible-intro';

/**
 * The port onto the intro module's three viewer-scoped reads.
 *
 * Declared in `application/` rather than `domain/` for the reason
 * `modules/notes/application/visible-notes.repository.ts` gives: these are **read
 * models, not domain entities**. The aggregate is
 * {@link import('../domain/intro-request').IntroRequest}, behind
 * {@link import('../domain/intro-request.repository').IntroRequestRepository}, and
 * inventing a second domain type to hold a projection would be the placeholder layer
 * addendum §4 forbids.
 *
 * ⚠ **Every method projects people through `app.visible_people` and joins `app.users`
 * nowhere.** A card assembled from the users table would be the second person-projection
 * ADR-0002 §6a forbids, and it is the tempting shortcut here precisely because a target
 * is *supposed* to be shown a requester their own graph would hide.
 */
export interface VisibleIntrosRepository {
  /**
   * Who could introduce this requester to this target.
   *
   * ⚠ **Never a refusal.** An arbitrary, unreachable, or non-existent `targetId` returns
   * an empty list, identical to a real target with no shared connection. An error that
   * distinguished them would tell a caller which UUIDs name real people (ADR-0002 §10).
   *
   * @param requesterId - The reading actor's `app.users.id`, from `ctx.actor`.
   * @param targetId - A person the caller believes stands two hops away. It is a claim
   *   the database authorizes, not an assertion about who is asking.
   */
  findViaCandidates(requesterId: string, targetId: string): Promise<readonly IntroPerson[]>;

  /**
   * The reader's dual-role inbox: asks waiting on them, and introductions made to them.
   *
   * @param viewerId - The reading actor's `app.users.id`. It is the whole authorization:
   *   the statement matches `via_id = viewerId and status = 'requested'` or
   *   `target_id = viewerId and status = 'passed_on'` and nothing else, so there is no
   *   argument here through which a caller could reach somebody else's inbox.
   * @returns Empty for anybody nobody has asked. **Deep-equal to a never-asked control
   *   user's answer** after a decline — that equality, not an absent field, is what makes
   *   "declined" and "never asked" indistinguishable.
   */
  findInboxFor(viewerId: string): Promise<readonly VisibleIntroInboxRow[]>;

  /**
   * What this reader has asked for, in every state.
   *
   * @param viewerId - The reading actor's `app.users.id`; the statement matches
   *   `requester_id = viewerId`, so a caller can only ever read their own asks.
   */
  findOutboxFor(viewerId: string): Promise<readonly VisibleIntroOutboxRow[]>;
}
