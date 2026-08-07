import type { Bulletin } from './bulletin';
import type { BulletinContent } from './bulletin-content';
import type { BulletinArchived } from './bulletin.events';

/** What creating a bulletin is given. Content has already been through the policy. */
export interface NewBulletin extends BulletinContent {
  /** The author, taken from the resolved `Actor` and never from request input. */
  readonly authorId: string;
  readonly type: string;
  readonly createdAt: Date;
  /**
   * `null` when the bulletin never expires — already through
   * {@link import('./bulletin-expiry.policy').validateBulletinExpiry}, so it is either
   * absent or in the future relative to `createdAt`.
   */
  readonly expiresAt: Date | null;
}

/** What archiving is given. */
export interface ArchiveBulletinWrite {
  /**
   * Who is asking. The write is conditional on this being the author, which is what
   * makes actorship a property of the statement rather than of a prior read
   * (ADR-0005 precedence rule 1).
   */
  readonly actorId: string;
  readonly bulletinId: string;
  readonly occurredAt: Date;
}

/** What archiving produced. */
export interface ArchivedBulletin {
  /** The bulletin as it now stands, with `archivedAt` set. */
  readonly bulletin: Bulletin;
  /**
   * The event that was appended to the outbox, or `null` when this call changed
   * nothing — the bulletin was already archived. Idempotency means the second call
   * returns the same `archivedAt`, **not** that it announces a second archival.
   */
  readonly event: BulletinArchived | null;
}

/**
 * The bulletins port — the **author-side** one.
 *
 * Declared here in `domain/` and implemented in `persistence/` (addendum §2). Every
 * method on it answers a question whose authorized set is trivially "the actor's own
 * rows", which is why none of them takes a viewer and none composes
 * `app.visible_bulletins`. Viewer-scoped reads go through
 * {@link import('../application/visible-bulletins.repository').VisibleBulletinsRepository}
 * instead, and keeping the two apart is what stops a convenience method on this port
 * from becoming a second visibility predicate (ADR-0002 §6).
 */
export interface BulletinRepository {
  /**
   * Write a bulletin and its `BulletinCreated` event, **atomically**.
   *
   * One transaction covering two writes, because a bulletin nobody was told about and
   * a notification about a bulletin that does not exist are both worse than neither
   * (addendum §10, ADR-0006). M2-AC6 asserts the other direction: a fault after the
   * insert and before the commit leaves **zero** rows in `app.bulletins` and **zero**
   * in `app.outbox_events`.
   */
  add(write: NewBulletin): Promise<Bulletin>;

  /**
   * Archive a bulletin on its author's behalf, **atomically**, and idempotently.
   *
   * The update is conditional on `author_id = actorId` and on the bulletin still
   * being live, so:
   *
   * - a non-author changes nothing and is refused with
   *   {@link import('./bulletin.errors').BulletinGoneError} — the same answer a
   *   never-existent ID gets (ADR-0002 §10, M2-AC19);
   * - a second archive by the author returns the first `archivedAt` unchanged and
   *   emits no second event (M2-AC12).
   *
   * @throws {import('./bulletin.errors').BulletinGoneError} when the bulletin does
   *   not exist, or is not this actor's.
   */
  archive(write: ArchiveBulletinWrite): Promise<ArchivedBulletin>;

  /**
   * Every bulletin this author has written, archived ones included.
   *
   * The one sanctioned read of `app.bulletins` that does not compose
   * `app.visible_bulletins`: the authorized set is the author's own rows, so there is
   * no visibility question to answer and no author card to project. M2-AC12's
   * retention half — "the author's own list still contains it with `archivedAt` set" —
   * is this method.
   *
   * @returns Newest first. Empty for an author who has written nothing.
   */
  findByAuthor(authorId: string): Promise<readonly Bulletin[]>;
}
