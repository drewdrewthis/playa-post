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
}
