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
   * ⚠ **This drives the panel, not the badge.** A dismissed notification stays in the
   * list — the panel keeps history, and a client can confirm its dismissal landed by
   * seeing the item come back marked. Filter to `unread` for the panel body, and treat a
   * disappearing item as "what it pointed at is no longer visible to you", which is a
   * different fact. The badge counts `unread && !seen` — see {@link seen}.
   */
  readonly unread: boolean;
  /**
   * `true` once this notification was already on the list the last time the caller
   * opened their notifications panel (issue #178).
   *
   * ⚠ **Seen and dismissed are two different acts and must not be collapsed.** Opening
   * the panel marks everything already on it *seen*, which is what lets the badge fall
   * to zero without the reader clearing rows one by one; **dismissing** is the deliberate
   * `✕` that moves a row out of the panel's active section. A seen notification is still
   * `unread: true` and still renders in the body — being looked at is not being dealt
   * with.
   *
   * **Server-computed from one durable per-caller watermark**, never stored per
   * notification: `occurredAt <= lastSeenAt`, and `false` for everybody who has never
   * opened the panel. A notification that arrived *after* that moment is therefore
   * `seen: false` and keeps the badge up, which is the whole point — the badge means
   * "something happened since you last looked", not "you have unfinished business".
   *
   * ⚠ The boundary is inclusive. A notification stamped at the exact instant of the last
   * open counts as seen: it was on the list the reader was shown.
   */
  readonly seen: boolean;
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

/**
 * What comes back from `notifications.markSeen` — the moment the caller's watermark now
 * stands at.
 *
 * **`notifications.markSeen` takes no input**, the same statement `notifications.list`
 * makes: there is exactly one person's watermark a caller may move, so there is no
 * parameter that could name a different one. It names no notification either — the whole
 * point of a watermark is that "everything up to here" needs no list of identifiers, and
 * a client sending one could not describe a notification that arrived between its read
 * and its write.
 *
 * ⚠ **Not idempotent, and deliberately unlike `notifications.dismiss`.** A dismissal is a
 * fact about one notification and converges on its first timestamp; a mark-seen is "I am
 * looking at the panel *now*", so every call advances `seenAt`. Repeating it is safe —
 * the watermark only ever moves forward and the answer is always the moment it moved to —
 * but it is not a replay of the first call, and nothing may treat a repeat as a no-op.
 */
export interface NotificationSeenMark {
  /** ISO-8601, as every timestamp this API serves. */
  readonly seenAt: string;
}
