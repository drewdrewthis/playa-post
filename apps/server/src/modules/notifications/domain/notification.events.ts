/**
 * The event this module **subscribes to**, restated rather than imported.
 *
 * `modules/bulletins` publishes it and owns the name; addendum §19 forbids importing
 * another module's domain, and ADR-0006 makes the *name* the contract a consumer
 * subscribes to. So the string is duplicated on purpose and the type is not: a change
 * to bulletins' internal `BulletinCreated` interface must not ripple in here, and a
 * change to the published name is a breaking change that should show up as a consumer
 * that stops matching rather than as a compile error that tempts somebody to "fix" it
 * by coupling the two modules.
 */
export const BULLETIN_CREATED = 'BulletinCreated';

/**
 * The second event this module **subscribes to**, restated for the reason above.
 *
 * `modules/notes` publishes it and owns the name. ⚠ Its payload is identifiers only and
 * **carries no note body** — a note is the most private thing this product stores, so
 * this module never learns what one says: it records that a note arrived and the read
 * path re-reads visibility through `app.visible_notes`. Nothing here may start reading
 * the payload for text that is deliberately not in it.
 */
export const NOTE_PINNED = 'NotePinned';

/** Event type name, past tense (addendum §20). Stable — consumers subscribe to it. */
export const NOTIFY_ME_MATCHED = 'NotifyMeMatched';

/**
 * `app.outbox_events.event_type` values this module drains **itself**, and which the
 * generic outbox drainer must therefore never claim.
 *
 * ⚠ **Declared here, immediately below the constant it names, on purpose.** The
 * coupling is between "this module reads rows of this type on its own schedule" and
 * "the drainer skips rows of this type", and those two facts going out of sync is
 * silent: the drainer would claim a `NotifyMeMatched` row, find no consumer that acts
 * on it, mark it `published`, and the grouping-window flush — which sweeps
 * `status='pending'` — would never see it again. Nobody gets a notification and
 * nothing errors. Keeping the declaration adjacent to the constant means the edit that
 * would break it cannot be made without reading it.
 *
 * `NOTIFY_ME_MATCHED` is here because
 * {@link import('../application/send-grouped-push.handler').SendGroupedPushHandler} is
 * a *scheduled* reader rather than a drainer consumer (ADR-0006 §"Scheduled (cron)
 * work" lists the grouping-window flush as its own job): the 60-second window is a
 * decision about time, and only a clock-driven reader can make it.
 *
 * `BULLETIN_CREATED` and `NOTE_PINNED` are deliberately **not** here — both arrive
 * through the drainer, which is exactly what
 * {@link import('../application/evaluate-notify-me.handler').EvaluateNotifyMeHandler}
 * and {@link import('../application/deliver-note-pinned.handler').DeliverNotePinnedHandler}
 * are registered for.
 */
export const SELF_DRAINED_EVENT_TYPES: readonly string[] = [NOTIFY_ME_MATCHED];

/**
 * Somebody's saved Notify Me query matched a bulletin they are authorized to see.
 *
 * **Identifiers only** (ADR-0006). It is a *computation* result, not a delivery: the
 * grouping window has not closed and the recipient's authorization will be re-checked
 * again before anything is sent (ADR-0002:274-279). Writing it to the outbox rather
 * than pushing immediately is what makes the 60-second window possible at all, and
 * what makes `EvaluateNotifyMeHandler` idempotent for free — the receipt on the
 * triggering `BulletinCreated` rides the same transaction as these rows, so a
 * redelivered event produces no second match (M2-AC8).
 *
 * `authorId` rides along because the delivery-time re-check needs to ask "is this
 * bulletin's author still visible to this recipient" without re-reading the bulletin.
 * It never reaches the push payload — see {@link import('./push-transport').PushPayload}.
 */
export interface NotifyMeMatched {
  readonly type: typeof NOTIFY_ME_MATCHED;
  /**
   * The triggering bulletin's `occurred_at`, not the moment the match was computed.
   *
   * The grouping window is a window over *bulletins*, so it has to be anchored to when
   * they were posted; anchoring it to evaluation time would make a drainer's backlog
   * silently regroup a day's bulletins into one notification.
   */
  readonly occurredAt: Date;
  /** Who would be notified — `app.users.id`. */
  readonly recipientId: string;
  /** The aggregate this event is about — `app.outbox_events.aggregate_id`. */
  readonly bulletinId: string;
  /** The bulletin's author, for the delivery-time re-check. */
  readonly authorId: string;
}
