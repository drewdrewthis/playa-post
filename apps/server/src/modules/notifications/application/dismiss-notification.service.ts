import type { NotificationDismissal } from '../domain/notification-dismissal';
import type { NotificationDismissalRepository } from '../domain/notification-dismissal.repository';
import { NotificationUnavailableError } from '../domain/notification.errors';

import type { DeliveredNotificationRepository } from './delivered-notification.repository';

/**
 * What dismissing a notification is given.
 *
 * `actorId` comes from the `Actor` resolved at the tRPC context boundary and is
 * **never** a field on a procedure input (ADR-0002:180-181, B14): a caller who could
 * name a recipient could clear somebody else's panel.
 */
export interface DismissNotificationCommand {
  readonly actorId: string;
  /** The `notificationId` `notifications.list` served. */
  readonly notificationId: string;
}

export interface DismissNotificationService {
  dismiss(command: DismissNotificationCommand): Promise<NotificationDismissal>;
}

/** Collaborators, injected rather than resolved (addendum §12, ADR-0003). */
export interface DismissNotificationDependencies {
  /** Answers whether the named notification is this actor's to dismiss. */
  readonly deliveredNotifications: DeliveredNotificationRepository;
  readonly dismissals: NotificationDismissalRepository;
  /** Reads the wall clock. Overridable so a test can pin `dismissed_at`. */
  readonly now?: (() => Date) | undefined;
}

/**
 * The dismiss-notification use case — the panel's per-item `✕`, made durable.
 *
 * **Two steps, and the order is the security property**: establish that the notification
 * is this actor's, then write. Actorship first is ADR-0005's precedence rule 1, and here
 * it is also what keeps the table bounded — without it, any authenticated caller could
 * write a row for any UUID they invented (see
 * {@link NotificationUnavailableError}).
 *
 * ⚠ **Refusal is `NOTIFICATION_UNAVAILABLE` for all three failure shapes** — no such
 * notification, somebody else's, or aged past ADR-0006's retention. A distinct
 * "not yours" would confirm that a guessed identifier names real activity belonging to
 * a real person (ADR-0002 §10).
 *
 * **Idempotent, and converging.** A second dismissal answers the first `dismissedAt`
 * rather than restamping it, so a replay through the offline queue cannot make one act
 * look like two — the same contract `modules/moderation`'s report and dismiss carry.
 *
 * **Emits no outbox event, deliberately.** The reasoning lives with the port it writes
 * through: {@link NotificationDismissalRepository}.
 */
export function createDismissNotificationService(
  dependencies: DismissNotificationDependencies,
): DismissNotificationService {
  const readClock = dependencies.now ?? ((): Date => new Date());

  return {
    async dismiss(command: DismissNotificationCommand): Promise<NotificationDismissal> {
      const isOwn = await dependencies.deliveredNotifications.hasDeliveredMatch(
        command.actorId,
        command.notificationId,
      );

      if (!isOwn) {
        throw new NotificationUnavailableError();
      }

      return dependencies.dismissals.dismiss({
        recipientId: command.actorId,
        notificationId: command.notificationId,
        occurredAt: readClock(),
      });
    },
  };
}
