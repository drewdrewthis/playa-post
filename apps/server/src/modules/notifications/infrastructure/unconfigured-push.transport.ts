import type { PushPayload, PushSubscription, PushTransport } from '../domain/push-transport';

/**
 * Web Push delivery is not configured in this process.
 *
 * A plain `Error`, not an `ApplicationError`: no client asked for this and no client
 * can act on it. It is an operator-facing fault, and it is thrown **inside the flush's
 * receipt transaction**, which rolls the window back so nothing is marked delivered.
 */
export class PushTransportNotConfiguredError extends Error {
  constructor() {
    super('Web Push delivery is not configured in this deployment.');
    this.name = 'PushTransportNotConfiguredError';
  }
}

/**
 * The {@link PushTransport} for a deployment with no VAPID key pair: one that refuses,
 * loudly.
 *
 * **Not the only transport any more.** {@link
 * import('./web-push.transport').createWebPushTransport} is the real one, and
 * `composition/container.ts` picks between the two on `configuration.webPush` — so this
 * object is now what a deployment *without* the three `VAPID_*` keys gets: every local
 * checkout, every test harness, and any environment somebody has not configured yet. No
 * secret may enter a schema default to fake those keys (addendum §17), which is why
 * "absent" has to be a state the server boots in rather than one it crashes on.
 *
 * ⚠ **Refusing rather than silently dropping is the whole point.** A no-op transport
 * would let the flush write receipts, mark windows delivered, and report success while
 * nobody ever received a notification — a green system with a silent hole, which is the
 * failure mode this repository's fitness rules exist to design against. Throwing rolls
 * the window back, leaves it pending, and makes "push is not wired up yet" a fact an
 * operator can see rather than one a user discovers.
 *
 * ⚠ **Nothing in a running process reaches this object, because `isConfigured: false`
 * is what stops the flush being scheduled at all** — not because no scheduler exists.
 * `entrypoints/notification-flush/` is built and wired; `composition/container.ts`
 * hands `main.ts` a `null` flush while this transport is the one in place, and `main.ts`
 * logs that it is skipping the loop on purpose. The refusal below is therefore the
 * backstop for a *direct* call (a test, a future caller), not observed behaviour.
 *
 * That condition exists because the alternative is worse in both directions. Scheduling
 * the flush against this object would make every round throw, roll back, and log
 * indefinitely — the flush has no attempt counter and no dead-letter path, since those
 * belong to the drainer's retry design and this reader is not a drainer consumer.
 * Deleting the flush wiring instead would be PR #28's unwired-drainer blocker all over
 * again. Wired, unscheduled, and loudly logged is the third option.
 *
 * **Nothing is lost while it is skipped.** The drainer and `EvaluateNotifyMeHandler`
 * still run, so matches keep being computed and written as `pending` `NotifyMeMatched`
 * rows; windows accumulate and are delivered by the first flush that runs once the
 * three keys are set. Configuring them turns the loop on with no code change at all —
 * the scheduling follows from `isConfigured`.
 *
 * The proof of the delivery *behaviour* lives where it belongs: the integration suite
 * hands `SendGroupedPushHandler` a fake transport and asserts the payload and the
 * suppression (M2-AC21, M2-AC22).
 */
export const unconfiguredPushTransport: PushTransport = {
  isConfigured: false,

  send(_subscription: PushSubscription, _payload: PushPayload): Promise<void> {
    return Promise.reject(new PushTransportNotConfiguredError());
  },
};
