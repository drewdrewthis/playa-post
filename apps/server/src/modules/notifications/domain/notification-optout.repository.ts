import type { NotificationKind } from './notification-kind';

/**
 * The port onto `app.notification_optouts` (issue #209, ADR-0020).
 *
 * **A row means OFF; the default is the absence of a row.** Nothing here can write an
 * "enabled" record, because there is no such record: `optOut` inserts, `optIn`
 * deletes, and both are idempotent by the table's primary key, so a retried settings
 * flip converges instead of erroring.
 *
 * Consulted on the **write** side of notifications — `EvaluateNotifyMeHandler`
 * excludes opted-out people from the candidate set and `DeliverNotePinnedHandler`
 * skips the receipt — so an opt-out stops notifications from being created rather
 * than hiding delivered ones.
 */
export interface NotificationOptoutRepository {
  /**
   * The kinds this owner has switched off. Empty for almost everybody — that is what
   * default-on means.
   *
   * @param ownerId - An `app.users.id`. From the resolved actor on the settings path;
   *   this port takes a `string` the way every application-layer command does.
   */
  findOptedOutKinds(ownerId: string): Promise<ReadonlySet<NotificationKind>>;

  /**
   * Is this one (owner, kind) switched off? The single-row question the note handler
   * asks per event, kept separate from {@link findOptedOutKinds} so a delivery never
   * reads more preference state than it needs.
   */
  hasOptedOut(ownerId: string, kind: NotificationKind): Promise<boolean>;

  /** Switch a kind off. A second call is one row — the primary key absorbs it. */
  optOut(ownerId: string, kind: NotificationKind): Promise<void>;

  /** Switch a kind back on, by deleting the opt-out. Deleting nothing is fine. */
  optIn(ownerId: string, kind: NotificationKind): Promise<void>;
}
