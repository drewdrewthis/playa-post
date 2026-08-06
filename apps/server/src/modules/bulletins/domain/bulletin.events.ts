import type { Bulletin } from './bulletin';

/** Event type name, past tense (addendum §20). Stable — consumers subscribe to it. */
export const BULLETIN_CREATED = 'BulletinCreated';

/** Event type name, past tense (addendum §20). Stable — consumers subscribe to it. */
export const BULLETIN_ARCHIVED = 'BulletinArchived';

/**
 * A bulletin now exists.
 *
 * **Identifiers and routing data only.** ADR-0006 is explicit that a payload carries
 * what a consumer needs to *route*, never content: an outbox row is durable,
 * widely-read, and outlives the authorization state that produced it, so a consumer
 * re-reads what it needs through this module's authorized path — which also means it
 * cannot deliver something the current visibility rules no longer allow.
 *
 * ⚠ `title` and `body` are absent and must stay absent. Notify Me (M2.15) matches on
 * the bulletin it re-reads, not on a copy of its text riding in the event; a payload
 * carrying the body would also put bulletin content in every log line that dumps an
 * outbox row (M2-AC16). `type` is here because it is what a delivery *routes* on.
 *
 * Written to `app.outbox_events` **in the same transaction as the insert**
 * (addendum §10, ADR-0006, M2-AC6). Not published to a queue by anybody here; the
 * drainer (M2.14) is the only publisher.
 */
export interface BulletinCreated {
  readonly type: typeof BULLETIN_CREATED;
  readonly occurredAt: Date;
  /** The aggregate this event is about — `app.outbox_events.aggregate_id`. */
  readonly bulletinId: string;
  /** Who wrote it — `app.outbox_events.actor_id`. */
  readonly authorId: string;
  /** Which of the PDF types, so a consumer can route without a second read. */
  readonly bulletinType: string;
}

/**
 * A bulletin has been taken down by its author.
 *
 * Identifiers only, for {@link BulletinCreated}'s reasons. A consumer that had already
 * queued a notification for this bulletin re-reads it through the authorized path and
 * finds nothing — which is the behaviour ADR-0006 wants, and the reason the payload
 * must not carry a copy of what was archived.
 */
export interface BulletinArchived {
  readonly type: typeof BULLETIN_ARCHIVED;
  readonly occurredAt: Date;
  readonly bulletinId: string;
  /** The author, who is also the only actor allowed to archive (M2-AC18). */
  readonly authorId: string;
}

/**
 * Build the event for a bulletin that has just been written.
 *
 * @param bulletin - The stored row, so `bulletinId` is the real aggregate ID rather
 *   than one the caller hoped for.
 */
export function bulletinCreated(bulletin: Bulletin): BulletinCreated {
  return {
    type: BULLETIN_CREATED,
    occurredAt: bulletin.createdAt,
    bulletinId: bulletin.id,
    authorId: bulletin.authorId,
    bulletinType: bulletin.type,
  };
}

/**
 * Build the event for a bulletin that has just been archived.
 *
 * @param bulletin - The stored row **after** the update, so `occurredAt` is the
 *   `archived_at` the database actually committed rather than the clock reading the
 *   application hoped it would write.
 * @throws {TypeError} if the bulletin is not archived — an archived event for a live
 *   bulletin is a consumer acting on something that did not happen.
 */
export function bulletinArchived(bulletin: Bulletin): BulletinArchived {
  if (bulletin.archivedAt === null) {
    throw new TypeError('bulletinArchived: the bulletin has no archivedAt');
  }

  return {
    type: BULLETIN_ARCHIVED,
    occurredAt: bulletin.archivedAt,
    bulletinId: bulletin.id,
    authorId: bulletin.authorId,
  };
}
