import type { NotificationSeenMark } from '../domain/notification-seen-mark';
import type { NotificationSeenWatermarkRepository } from '../domain/notification-seen-watermark.repository';

/**
 * What marking notifications seen is given: the actor, and nothing else.
 *
 * `actorId` comes from the `Actor` resolved at the tRPC context boundary and is **never**
 * a field on a procedure input (ADR-0002:180-181, B14).
 *
 * ⚠ **No notification identifiers, deliberately.** A client sending the ids it happens to
 * be holding would silently mark seen a notification that arrived between its read and
 * its write — a panel clearing a badge for something it never showed. The watermark says
 * "everything up to now", which is the only claim the act of opening a screen actually
 * supports.
 */
export interface MarkNotificationsSeenCommand {
  readonly actorId: string;
}

export interface MarkNotificationsSeenService {
  markSeen(command: MarkNotificationsSeenCommand): Promise<NotificationSeenMark>;
}

/** Collaborators, injected rather than resolved (addendum §12, ADR-0003). */
export interface MarkNotificationsSeenDependencies {
  readonly seenWatermarks: NotificationSeenWatermarkRepository;
  /** Reads the wall clock. Overridable so a test can pin `last_seen_at`. */
  readonly now?: (() => Date) | undefined;
}

/**
 * The mark-notifications-seen use case — opening the panel, made durable (issue #178).
 *
 * **One step, and the absent one is the point.** Its sibling
 * {@link import('./dismiss-notification.service').DismissNotificationService} checks
 * actorship before writing, because it takes an identifier a caller invented and would
 * otherwise offer an unbounded write surface keyed on guesses. This command names nothing:
 * the row it writes is keyed on the resolved actor and the table therefore holds at most
 * one row per real user however often it is called. There is no ownership question to ask,
 * so asking one would be ceremony — and a `NOTIFICATION_UNAVAILABLE` it could never throw.
 *
 * **Not idempotent, and that is the contract.** Every call advances the watermark, because
 * "I am looking now" is true every time; a converging one would freeze at the first open
 * and the badge would never fall again. Repeating it is still *safe* — the watermark only
 * moves forward (see
 * {@link import('../domain/notification-seen-watermark.repository').NotificationSeenWatermarkRepository})
 * — so a replayed request costs a row update and changes nothing a person can perceive.
 *
 * **Emits no outbox event, deliberately.** The reasoning lives with the port it writes
 * through, beside the identical decision its dismissal sibling records.
 */
export function createMarkNotificationsSeenService(
  dependencies: MarkNotificationsSeenDependencies,
): MarkNotificationsSeenService {
  const readClock = dependencies.now ?? ((): Date => new Date());

  return {
    async markSeen(command: MarkNotificationsSeenCommand): Promise<NotificationSeenMark> {
      return dependencies.seenWatermarks.markSeen({
        recipientId: command.actorId,
        occurredAt: readClock(),
      });
    },
  };
}
