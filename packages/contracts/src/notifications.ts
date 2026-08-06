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
 * One grouped Notify Me notification, as a client renders it.
 *
 * ⚠ **Not on the wire in M2, and deliberately not a key of `PlayaPostApi`.** The
 * server has a grouped-push *writer* (`sendGroupedPush`) and no reader: there is no
 * procedure that returns a viewer's notifications, so this type describes the shape a
 * notifications panel renders and nothing currently produces one over HTTP. It is
 * declared here rather than inside `apps/web` so that the read procedure L3b-notify
 * still owes can be added as one `PlayaPostApi` key without moving the type — see the
 * L5 PR body's "step 9" note.
 */
export interface GroupedNotification {
  readonly recipientId: string;
  readonly bulletinIds: readonly string[];
  readonly message: string;
}
