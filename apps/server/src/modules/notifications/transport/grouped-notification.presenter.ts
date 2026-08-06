import type { GroupedNotification } from '../application/grouped-notification';

/**
 * One notification as this API renders it.
 *
 * The same shape as the {@link GroupedNotification} read model, restated rather than
 * re-exported: the wire is a contract and the read model is an implementation, so a
 * change made for the server's convenience must not become a silent break in the
 * client's API. `packages/contracts` publishes the client-facing key separately (lane
 * L5) and this is what it will describe.
 *
 * Timestamps are ISO-8601 strings rather than `Date`s, matching `bulletin.presenter.ts`:
 * tRPC without a serializer turns a `Date` into a string on the wire anyway, so
 * declaring the string is declaring what a caller actually receives.
 */
export interface PresentedNotification {
  readonly notificationId: string;
  readonly occurredAt: string;
  readonly bulletinIds: readonly string[];
}

/**
 * Project one grouped notification onto the wire.
 *
 * A field-by-field copy rather than a spread: a spread would carry whatever the read
 * model grows next into every client payload without anyone deciding it should be there,
 * and "the field appeared in the response because someone added it upstream" is exactly
 * how M2-AC5's "no author name, handle, or avatar … in notifications" gets violated by
 * accident.
 */
export function presentNotification(notification: GroupedNotification): PresentedNotification {
  return {
    notificationId: notification.notificationId,
    occurredAt: notification.occurredAt.toISOString(),
    bulletinIds: [...notification.bulletinIds],
  };
}
