import type { NotificationOptoutRepository } from '../domain/notification-optout.repository';
import { NOTE_PINNED } from '../domain/notification.events';

import type { NoteNotificationRepository } from './note-notification.repository';
import type { OutboxConsumer, OutboxEventRow } from './outbox-consumer';

/**
 * `app.consumer_receipts.consumer_name` for this consumer.
 *
 * ADR-0006 names it. ⚠ Stable: renaming it makes every past receipt invisible, which
 * here means every note notification already in somebody's bell disappears from it —
 * the receipt is not bookkeeping beside the notification, it *is* the notification.
 */
export const DELIVER_NOTE_PINNED_CONSUMER = 'DeliverNotePinnedHandler';

/** Collaborators, injected rather than resolved (addendum §12, ADR-0003). */
export interface DeliverNotePinnedDependencies {
  readonly noteNotifications: NoteNotificationRepository;
  /** The per-kind off-switch (issue #209, ADR-0020 D4). */
  readonly optouts: NotificationOptoutRepository;
  /** Reads the wall clock. Overridable so a test can pin `processed_at`. */
  readonly now?: (() => Date) | undefined;
}

/** This module's `NotePinned` consumer. */
export type DeliverNotePinnedHandler = OutboxConsumer;

/**
 * Put a pinned note in its recipient's bell (issue #149, closing #112's open consumer).
 *
 * **Delivery is on by default, and off means no receipt** (issue #209, ADR-0020 D4).
 * The preference table this handler's first version promised would be consulted here
 * now exists: a recipient opted out of kind `note` gets no receipt, and because the
 * receipt *is* the notification, that is the whole opt-out. The handler still returns
 * normally, so the drainer publishes the row — a skipped delivery is a processed
 * event, not a retryable failure, and an opt-out at delivery time is permanent for
 * that event, which is what "off" means.
 *
 * **The whole effect is the receipt**, so this handler holds no other collaborator.
 * `findDeliveredNoteNotifications` joins `NotePinned` rows to exactly this consumer's
 * receipts, so writing one is what makes a notification exist — the same relationship
 * `SendGroupedPushHandler`'s receipt has to a grouped notification, minus the push.
 *
 * **Nothing is grouped and nothing is matched.** A `NotifyMeMatched` notification is a
 * window over an unbounded number of bulletins that an unbounded number of people might
 * have saved a query for; a note is one event for one named recipient. There is no
 * window to close, so there is no scheduled flush and no second consumer — which is why
 * `NOTE_PINNED` is drained generically rather than added to `SELF_DRAINED_EVENT_TYPES`.
 *
 * **The payload yields one identifier, `recipientId`, and nothing else** — read only
 * to ask the opt-out question. Routing still happens at read time, where
 * `payload ->> 'recipientId'` is compared against a `ViewerId` the request boundary
 * minted, and this file still has nowhere for a note's text to arrive even if a future
 * publisher wrongly put it there (ADR-0006, M2-AC16). A payload with no readable
 * `recipientId` keeps the first version's behaviour — receipt written, row settled —
 * because there is nobody whose preference could be consulted, and the notification it
 * produces is unreadable anyway.
 *
 * **Authorization is not decided here.** ADR-0002 §11 evaluates it at the moment of
 * disclosure, and for a note that moment is the read: `app.visible_notes` is asked then,
 * so a note that stops being readable stops being listed without this consumer knowing
 * anything about it.
 */
export function createDeliverNotePinnedHandler(
  dependencies: DeliverNotePinnedDependencies,
): DeliverNotePinnedHandler {
  const readClock = dependencies.now ?? ((): Date => new Date());

  return {
    name: DELIVER_NOTE_PINNED_CONSUMER,

    async handle(event: OutboxEventRow): Promise<void> {
      // Returning rather than throwing for an event this consumer does not subscribe
      // to: a throw would push an irrelevant delivery through the retry-and-dead-letter
      // path (ADR-0006, M2-AC23) and eventually raise an alert about nothing.
      if (event.eventType !== NOTE_PINNED) {
        return;
      }

      const recipientId = event.payload['recipientId'];
      if (
        typeof recipientId === 'string' &&
        (await dependencies.optouts.hasOptedOut(recipientId, 'note'))
      ) {
        // No receipt, and the receipt is the notification — this is the opt-out
        // (ADR-0020 D4). Returning without throwing lets the drainer publish the row.
        return;
      }

      await dependencies.noteNotifications.recordNoteNotification({
        eventId: event.eventId,
        processedAt: readClock(),
      });
    },
  };
}
