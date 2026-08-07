import type { ViewerId } from '../../../shared/auth/viewer-id';
import type { NotificationDismissalRepository } from '../domain/notification-dismissal.repository';
import {
  groupIntoNotificationWindows,
  type NotificationWindow,
} from '../domain/notification-window';

import type {
  DeliveredNotificationMatch,
  DeliveredNotificationRepository,
} from './delivered-notification.repository';
import type { GroupedNotification } from './grouped-notification';

/**
 * What listing notifications is given.
 *
 * `viewerId` is a {@link ViewerId} — branded, and constructible only from the `Actor`
 * resolved at the tRPC context boundary (ADR-0002 §5a, ADR-0008 rule 8). There is
 * exactly one person's notifications a caller may read, so this command has no other
 * field: nothing here could name somebody else's.
 */
export interface ListNotificationsCommand {
  readonly viewerId: ViewerId;
}

export interface ListNotificationsQuery {
  list(command: ListNotificationsCommand): Promise<readonly GroupedNotification[]>;
}

/** Collaborators, injected rather than resolved (addendum §12, ADR-0003). */
export interface ListNotificationsDependencies {
  readonly deliveredNotifications: DeliveredNotificationRepository;
  readonly dismissals: NotificationDismissalRepository;
}

/**
 * The notifications read (issue #31) — what `SendGroupedPushHandler` already delivered,
 * as the viewer's own list.
 *
 * **Three steps, and their order is the design:**
 *
 * 1. **Read what the flush produced.** The writer is the source of truth; a match still
 *    awaiting its window is not a notification yet and is absent by construction.
 * 2. **Group with the module's one grouping rule** —
 *    {@link groupIntoNotificationWindows}, the same function the flush calls. The read
 *    path does not re-derive M2-AC7's window, so the two cannot disagree about which
 *    bulletins arrived together.
 * 3. **Re-check authorization, as a post-filter.** ⚠ After grouping, never before:
 *    windows are anchored to their opening match, so filtering first would let a
 *    bulletin the viewer has since lost access to *move* the boundaries of a window that
 *    was already committed, and a person would see a regrouping their device never got.
 *    A group left with nothing visible disappears entirely rather than reading as an
 *    empty notification.
 * 4. **Mark, never subtract.** A dismissal sets `unread: false` and leaves the
 *    notification in the list. Removing it here would be a *second* rule about what is
 *    in somebody's panel, sitting beside step 3's — and the two are answers to different
 *    questions ("may I still see this" versus "have I dealt with it") that a client has
 *    to be able to tell apart. See
 *    {@link import('./grouped-notification').GroupedNotification.unread}.
 *
 * **Bounded by ADR-0006's retention, not by a page size.** Outbox rows are pruned after
 * fourteen days, so this read is naturally finite and takes no `limit` — a client-supplied
 * one would be a knob on somebody's own history for no product reason, and a fixed
 * internal one could truncate a window mid-group. Pagination belongs with M5's delivery
 * records subsystem, which is where a durable notification row would live.
 */
export function createListNotificationsQuery(
  dependencies: ListNotificationsDependencies,
): ListNotificationsQuery {
  return {
    async list(command: ListNotificationsCommand): Promise<readonly GroupedNotification[]> {
      const delivered = await dependencies.deliveredNotifications.findDeliveredMatches(
        command.viewerId,
      );

      if (delivered.length === 0) {
        // Nothing has been flushed for this viewer, so there is no visibility question
        // to ask and no reason to pay for `app.visible_bulletins`.
        return [];
      }

      const windows = groupIntoNotificationWindows(delivered);
      // Concurrent, because neither read informs the other: what the viewer may still
      // see is a fact about authorization, and what they have dismissed is a fact about
      // their own choices — the same shape `modules/bulletins`' board read uses for its
      // own two.
      const [visibleIds, dismissed] = await Promise.all([
        dependencies.deliveredNotifications.findVisibleBulletinIds(command.viewerId, [
          ...new Set(delivered.map((match) => match.bulletinId)),
        ]),
        dependencies.dismissals.findDismissedFor(command.viewerId),
      ]);
      const visible = new Set(visibleIds);

      return windows
        .flatMap((window) => presentableWindow(window, visible, dismissed))
        .sort((left, right) => right.occurredAt.getTime() - left.occurredAt.getTime());
    },
  };
}

/**
 * One window as a notification, or nothing at all.
 *
 * `flatMap` over an array rather than a nullable return: "this window has nothing the
 * viewer may still see" and "the grouper produced a window with no matches, which its
 * contract says cannot happen" are both *drop it*, and neither is worth a throw on a
 * read that would otherwise empty somebody's panel.
 */
function presentableWindow(
  window: NotificationWindow<DeliveredNotificationMatch>,
  visible: ReadonlySet<string>,
  dismissed: ReadonlySet<string>,
): readonly GroupedNotification[] {
  const opening = window.matches[0];
  if (opening === undefined) {
    return [];
  }

  // De-duplicated for the reason the push payload is: one bulletin matching twice would
  // read as two bulletins in a group.
  const bulletinIds = [...new Set(window.matches.map((match) => match.bulletinId))].filter((id) =>
    visible.has(id),
  );

  return bulletinIds.length === 0
    ? []
    : [
        {
          notificationId: opening.eventId,
          occurredAt: window.startsAt,
          bulletinIds,
          // Keyed on the same identifier the client was served and dismisses by, so
          // there is no second mapping between "what a notification is called" and
          // "what a dismissal names".
          unread: !dismissed.has(opening.eventId),
        },
      ];
}
