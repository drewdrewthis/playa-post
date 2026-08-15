import type { NotificationOptoutRepository } from '../domain/notification-optout.repository';
import { CONNECTION_REQUESTED } from '../domain/notification.events';

import type { ConnectionRequestNotificationRepository } from './connection-request-notification.repository';
import type { OutboxConsumer, OutboxEventRow } from './outbox-consumer';

/**
 * `app.consumer_receipts.consumer_name` for this consumer.
 *
 * ADR-0006 names it. ⚠ Stable: renaming it makes every past receipt invisible, which
 * here means every connection-request notification already in somebody's bell
 * disappears from it — the receipt is not bookkeeping beside the notification, it *is*
 * the notification.
 */
export const DELIVER_CONNECTION_REQUESTED_CONSUMER = 'DeliverConnectionRequestedHandler';

/** Collaborators, injected rather than resolved (addendum §12, ADR-0003). */
export interface DeliverConnectionRequestedDependencies {
  readonly connectionRequestNotifications: ConnectionRequestNotificationRepository;
  /** The per-kind off-switch (issue #209, ADR-0020 D4). */
  readonly optouts: NotificationOptoutRepository;
  /** Reads the wall clock. Overridable so a test can pin `processed_at`. */
  readonly now?: (() => Date) | undefined;
}

/** This module's `ConnectionRequested` consumer. */
export type DeliverConnectionRequestedHandler = OutboxConsumer;

/**
 * Put a connection request in its recipient's bell (issue #218).
 *
 * The exact shape of
 * {@link import('./deliver-note-pinned.handler').createDeliverNotePinnedHandler}, and
 * every one of its decisions carries over: delivery is on by default and off means no
 * receipt (ADR-0020 D4); the whole effect is the receipt, which
 * `findDeliveredConnectionRequestNotifications` joins on; nothing is grouped, so
 * `CONNECTION_REQUESTED` is drained generically rather than self-drained.
 *
 * ⚠ **The payload names the recipient as `ownerId`** — the request inbox's owner,
 * matching `app.connection_requests.owner_id` — not `recipientId`. That one key is read
 * only to ask the opt-out question; routing happens at read time against the same
 * payload key. A payload with no readable `ownerId` gets its receipt anyway: there is
 * nobody whose preference could be consulted, and the notification it produces is
 * unreadable.
 *
 * **Authorization is not decided here.** The read path re-checks, at disclosure time,
 * that the request is still live in the owner's inbox — a decided or lapsed request's
 * notification disappears without this consumer knowing anything about it.
 */
export function createDeliverConnectionRequestedHandler(
  dependencies: DeliverConnectionRequestedDependencies,
): DeliverConnectionRequestedHandler {
  const readClock = dependencies.now ?? ((): Date => new Date());

  return {
    name: DELIVER_CONNECTION_REQUESTED_CONSUMER,

    async handle(event: OutboxEventRow): Promise<void> {
      // Returning rather than throwing for an event this consumer does not subscribe
      // to: a throw would push an irrelevant delivery through the retry-and-dead-letter
      // path (ADR-0006, M2-AC23) and eventually raise an alert about nothing.
      if (event.eventType !== CONNECTION_REQUESTED) {
        return;
      }

      const ownerId = event.payload['ownerId'];
      if (
        typeof ownerId === 'string' &&
        (await dependencies.optouts.hasOptedOut(ownerId, 'connections'))
      ) {
        // No receipt, and the receipt is the notification — this is the opt-out
        // (ADR-0020 D4). Returning without throwing lets the drainer publish the row.
        return;
      }

      await dependencies.connectionRequestNotifications.recordConnectionRequestNotification({
        eventId: event.eventId,
        processedAt: readClock(),
      });
    },
  };
}
