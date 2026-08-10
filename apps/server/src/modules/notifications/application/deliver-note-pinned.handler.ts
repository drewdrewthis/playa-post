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
  /** Reads the wall clock. Overridable so a test can pin `processed_at`. */
  readonly now?: (() => Date) | undefined;
}

/** This module's `NotePinned` consumer. */
export type DeliverNotePinnedHandler = OutboxConsumer;

/**
 * Put a pinned note in its recipient's bell (issue #149, closing #112's open consumer).
 *
 * **Delivery is unconditional, and that is what "on by default" means here.** No
 * preference table exists (M5 owns preferences), so the choice is between delivering to
 * everyone and delivering to nobody; a note is addressed to exactly one person who has
 * already accepted a connection with its author, which makes "on" the only defensible
 * default. It is not a setting read from nowhere — it is the absence of a setting, and
 * the day M5 adds one this handler is where it is consulted.
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
 * **The payload is never read**, not even `recipientId`. Routing happens at read time,
 * where `payload ->> 'recipientId'` is compared against a `ViewerId` the request
 * boundary minted — so a malformed payload produces a notification nobody can read
 * rather than one delivered to a guess, and this file has nowhere for a note's text to
 * arrive even if a future publisher wrongly put it there (ADR-0006, M2-AC16).
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

      await dependencies.noteNotifications.recordNoteNotification({
        eventId: event.eventId,
        processedAt: readClock(),
      });
    },
  };
}
