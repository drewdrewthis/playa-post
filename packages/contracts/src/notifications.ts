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
 * One grouped Notify Me notification — `notifications.list` output, one element.
 *
 * The caller is the recipient (`notifications.list` takes no input; ADR-0002 §5a), so
 * no recipient identifier rides along. `occurredAt` is ISO-8601, matching every other
 * timestamp this API serves. No author name, handle, avatar, or bulletin content —
 * only the ids a client may then resolve through `bulletins.getById`, which applies
 * the visibility policy (M2-AC5).
 */
export interface GroupedNotification {
  readonly notificationId: string;
  readonly occurredAt: string;
  readonly bulletinIds: readonly string[];
  /**
   * `false` once the caller has dismissed it; `true` until then.
   *
   * ⚠ **The bell badge counts these, not `list.length`.** A dismissed notification stays
   * in the list — the panel keeps history, and a client can confirm its dismissal landed
   * by seeing the item come back marked. Filter to `unread` for the panel body, count
   * `unread` for the badge, and treat a disappearing item as "the bulletins behind it
   * are no longer visible to you", which is a different fact.
   */
  readonly unread: boolean;
}

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
