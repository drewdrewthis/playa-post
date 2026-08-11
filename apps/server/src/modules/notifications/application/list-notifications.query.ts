import type { ViewerId } from '../../../shared/auth/viewer-id';
import type { NotificationDismissalRepository } from '../domain/notification-dismissal.repository';
import type { NotificationSeenWatermarkRepository } from '../domain/notification-seen-watermark.repository';
import {
  groupIntoNotificationWindows,
  type NotificationWindow,
} from '../domain/notification-window';

import type {
  DeliveredNoteNotification,
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
  readonly seenWatermarks: NotificationSeenWatermarkRepository;
}

/**
 * The notifications read (issue #31, extended for pinned notes by issue #149) — what the
 * module's consumers already delivered, as the viewer's own list.
 *
 * **Two kinds, one list, and only one of them is grouped.** A `NotifyMeMatched` match
 * belongs to a 60-second window; a `NotePinned` note is one act aimed at one person and
 * is emitted as a singleton. Merging them before the grouper would either window the
 * notes or force the grouper to learn a second rule — so they are read separately,
 * shaped separately, and meet only in the final sort.
 *
 * **Four steps, and their order is the design:**
 *
 * 1. **Read what the writers produced.** The writer is the source of truth; a match still
 *    awaiting its window, or a note the drainer has not delivered, is not a notification
 *    yet and is absent by construction.
 * 2. **Group with the module's one grouping rule** —
 *    {@link groupIntoNotificationWindows}, the same function the flush calls. The read
 *    path does not re-derive M2-AC7's window, so the two cannot disagree about which
 *    bulletins arrived together. Notes never reach it.
 * 3. **Re-check authorization, as a post-filter.** ⚠ After grouping, never before:
 *    windows are anchored to their opening match, so filtering first would let a
 *    bulletin the viewer has since lost access to *move* the boundaries of a window that
 *    was already committed, and a person would see a regrouping their device never got.
 *    A group left with nothing visible disappears entirely rather than reading as an
 *    empty notification, and a note that has left `app.visible_notes` disappears with it.
 * 4. **Mark, never subtract.** A dismissal sets `unread: false` and leaves the
 *    notification in the list. Removing it here would be a *second* rule about what is
 *    in somebody's panel, sitting beside step 3's — and the two are answers to different
 *    questions ("may I still see this" versus "have I dealt with it") that a client has
 *    to be able to tell apart. See
 *    {@link import('./grouped-notification').GroupedNotification.unread}.
 *
 *    ⚠ The same step marks `seen` from the viewer's watermark (issue #178), and it is a
 *    **third** independent question — "has anything happened since you last looked" — not
 *    a refinement of either of the other two. It is what the bell's badge counts, and it
 *    changes nothing about which notifications are served or which are `unread`: a
 *    notification that has been seen still renders in the panel, waiting to be dealt
 *    with. Collapsing seen into dismissed would make the badge unclearable without also
 *    emptying the panel, which is the bug this step exists to have already fixed.
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
      // Concurrent, because neither read informs the other — and because a viewer with
      // both kinds waiting should not pay for them in series.
      const [delivered, deliveredNotes] = await Promise.all([
        dependencies.deliveredNotifications.findDeliveredMatches(command.viewerId),
        dependencies.deliveredNotifications.findDeliveredNoteNotifications(command.viewerId),
      ]);

      if (delivered.length === 0 && deliveredNotes.length === 0) {
        // Nothing has been delivered to this viewer, so there is no visibility question
        // to ask and no reason to pay for either authorized-set function.
        return [];
      }

      const windows = groupIntoNotificationWindows(delivered);
      // Concurrent for the same reason: what the viewer may still see is a fact about
      // authorization, what they have dismissed is a fact about their own choices, and
      // when they last looked is a fact about their own attention — the same shape
      // `modules/bulletins`' board read uses for its own two. Both visibility reads
      // answer `[]` for an empty candidate list, so a viewer with only one kind of
      // notification pays for only one function.
      const [visibleBulletinIds, visibleNoteIds, dismissed, lastSeenAt] = await Promise.all([
        dependencies.deliveredNotifications.findVisibleBulletinIds(command.viewerId, [
          ...new Set(delivered.map((match) => match.bulletinId)),
        ]),
        dependencies.deliveredNotifications.findVisibleNoteIds(command.viewerId, [
          ...new Set(deliveredNotes.map((note) => note.noteId)),
        ]),
        dependencies.dismissals.findDismissedFor(command.viewerId),
        dependencies.seenWatermarks.findSeenWatermarkFor(command.viewerId),
      ]);
      const visibleBulletins = new Set(visibleBulletinIds);
      const visibleNotes = new Set(visibleNoteIds);

      return [
        ...windows.flatMap((window) =>
          presentableWindow(window, visibleBulletins, dismissed, lastSeenAt),
        ),
        ...deliveredNotes.flatMap((note) =>
          presentableNote(note, visibleNotes, dismissed, lastSeenAt),
        ),
      ].sort((left, right) => right.occurredAt.getTime() - left.occurredAt.getTime());
    },
  };
}

/**
 * Whether a notification stamped `occurredAt` was already on the list the viewer was last
 * shown.
 *
 * ⚠ **Inclusive, and `false` when there is no watermark.** Both halves are decisions.
 * A notification stamped at the exact instant the panel opened *was* on that list, and an
 * exclusive comparison would leave it holding the badge up forever — no later open can
 * move a watermark past a timestamp it equals on the nose. And a viewer who has never
 * opened the panel has seen nothing, which is the state where the badge shows the lot;
 * treating `null` as "the beginning of time" would be the same expression with the
 * opposite meaning.
 */
function wasSeen(occurredAt: Date, lastSeenAt: Date | null): boolean {
  return lastSeenAt !== null && occurredAt.getTime() <= lastSeenAt.getTime();
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
  lastSeenAt: Date | null,
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
          kind: 'bulletins',
          notificationId: opening.eventId,
          occurredAt: window.startsAt,
          bulletinIds,
          // Keyed on the same identifier the client was served and dismisses by, so
          // there is no second mapping between "what a notification is called" and
          // "what a dismissal names".
          unread: !dismissed.has(opening.eventId),
          // Against the window's own start — the timestamp this notification is served
          // with — rather than any joiner's, so `seen` and the visible "ago" line can
          // never disagree about which side of the watermark this row is on.
          seen: wasSeen(window.startsAt, lastSeenAt),
        },
      ];
}

/**
 * One delivered note as a notification, or nothing at all.
 *
 * The same `flatMap`-over-an-array shape its sibling uses, for the same reason: a note
 * the viewer may no longer read is dropped, not reported as a notification pointing at
 * something they would be refused.
 *
 * There is no window and no de-duplication to do — one `NotePinned` event is one note is
 * one notification — so the whole rule is the visibility post-filter.
 */
function presentableNote(
  note: DeliveredNoteNotification,
  visible: ReadonlySet<string>,
  dismissed: ReadonlySet<string>,
  lastSeenAt: Date | null,
): readonly GroupedNotification[] {
  return visible.has(note.noteId)
    ? [
        {
          kind: 'note',
          // The `NotePinned` event's own id, which is what a dismissal names — the same
          // relationship a grouped notification has to its window opener.
          notificationId: note.eventId,
          occurredAt: note.occurredAt,
          noteId: note.noteId,
          unread: !dismissed.has(note.eventId),
          // The watermark is a fact about time, so it cuts across both kinds by the same
          // comparison — there is no note-shaped exception to "everything up to here".
          seen: wasSeen(note.occurredAt, lastSeenAt),
        },
      ]
    : [];
}
