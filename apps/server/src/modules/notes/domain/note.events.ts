import type { Note } from './note';

/** Event type name, past tense (addendum §20). Stable — consumers subscribe to it. */
export const NOTE_PINNED = 'NotePinned';

/**
 * A note now exists on somebody's board.
 *
 * **Identifiers and routing data only.** ADR-0006 is explicit that a payload carries
 * what a consumer needs to *route*, never content: an outbox row is durable,
 * widely-read, and outlives the authorization state that produced it, so a consumer
 * re-reads what it needs through this module's authorized path — which also means it
 * cannot deliver something the current visibility rules no longer allow.
 *
 * ⚠ **`body` is absent and must stay absent.** A note is the most private thing this
 * product stores, and an event carrying its text would put it in every log line that
 * dumps an outbox row (M2-AC16) and in every consumer's retry record. A notification
 * consumer says "you have a note" and links to it; it never quotes it.
 *
 * `recipientId` is here because it is what a delivery *routes* on — the same role
 * `bulletinType` plays on `BulletinCreated`. It is an identifier the author already
 * supplied, so carrying it discloses nothing that did not already cross this boundary.
 *
 * Written to `app.outbox_events` **in the same transaction as the insert**
 * (addendum §10, ADR-0006). Not published to a queue by anybody here; the drainer is
 * the only publisher.
 */
export interface NotePinned {
  readonly type: typeof NOTE_PINNED;
  readonly occurredAt: Date;
  /** The aggregate this event is about — `app.outbox_events.aggregate_id`. */
  readonly noteId: string;
  /** Who wrote it — `app.outbox_events.actor_id`. */
  readonly authorId: string;
  /** Who it is for, so a consumer can route without a second read. */
  readonly recipientId: string;
}

/**
 * Build the event for a note that has just been written.
 *
 * @param note - The stored row, so `noteId` is the real aggregate ID rather than one
 *   the caller hoped for, and `occurredAt` is the `created_at` the database committed.
 */
export function notePinned(note: Note): NotePinned {
  return {
    type: NOTE_PINNED,
    occurredAt: note.createdAt,
    noteId: note.id,
    authorId: note.authorId,
    recipientId: note.recipientId,
  };
}
