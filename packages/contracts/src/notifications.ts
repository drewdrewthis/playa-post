/**
 * `notifications.push.subscribe` input — a browser `PushSubscription`, narrowed to the
 * three fields delivery needs.
 *
 * `endpoint` must be an absolute URL; both keys must be non-empty.
 */
export interface SubscribeToPushRequest {
  readonly endpoint: string;
  readonly keys: {
    readonly p256dh: string;
    readonly auth: string;
  };
}

/**
 * What every `notifications.list` element carries, whatever caused it.
 *
 * The caller is the recipient (`notifications.list` takes no input; ADR-0002 §5a), so
 * no recipient identifier rides along. `occurredAt` is ISO-8601, matching every other
 * timestamp this API serves. No author name, handle, avatar, or content of any kind —
 * only the ids a client may then resolve through a read that applies the visibility
 * policy (M2-AC5).
 */
interface NotificationBase {
  readonly notificationId: string;
  readonly occurredAt: string;
  /**
   * `false` once the caller has dismissed it; `true` until then.
   *
   * ⚠ **The bell badge counts these, not `list.length`.** A dismissed notification stays
   * in the list — the panel keeps history, and a client can confirm its dismissal landed
   * by seeing the item come back marked. Filter to `unread` for the panel body, count
   * `unread` for the badge, and treat a disappearing item as "what it pointed at is no
   * longer visible to you", which is a different fact.
   */
  readonly unread: boolean;
}

/**
 * One grouped Notify Me notification — the bulletins that arrived in one 60-second
 * window, de-duplicated, and only those the caller may still see.
 *
 * `bulletinIds` is never empty: a group with nothing left to show is not served.
 * Resolve them through `bulletins.getById`.
 */
export interface GroupedBulletinNotification extends NotificationBase {
  readonly kind: 'bulletins';
  readonly bulletinIds: readonly string[];
}

/**
 * One note somebody pinned to the caller's board.
 *
 * ⚠ **Never grouped.** One note is one notification, because a note is one deliberate
 * act aimed at one person — two of them are two people writing to you, not "2 notes".
 *
 * ⚠ **`noteId` and nothing else — no body, no author.** Read the note through `notes.*`,
 * which is where §6a decides whether you may be told who wrote it. Render no author line
 * from a notification, and never a reconstructed one.
 */
export interface PinnedNoteNotification extends NotificationBase {
  readonly kind: 'note';
  readonly noteId: string;
}

/**
 * One notification — `notifications.list` output, one element.
 *
 * ⚠ **Branch on `kind`.** It is a discriminated union rather than one shape with optional
 * fields, so the compiler will not let a client read `bulletinIds` off a note or write
 * copy that assumes every notification is a bulletin group. A future kind is added here
 * and the branch that forgets it fails to compile.
 */
export type GroupedNotification = GroupedBulletinNotification | PinnedNoteNotification;

/** Input of `notifications.dismiss`. The identifier `notifications.list` served. */
export interface NotificationIdRequest {
  readonly notificationId: string;
}

/**
 * What comes back when the caller dismisses a notification.
 *
 * `dismissedAt` is unchanged by a repeated dismissal — the first one is the answer — so
 * a retry after a dropped connection is safe and converges.
 */
export interface NotificationDismissal {
  readonly notificationId: string;
  readonly dismissedAt: string;
}
