import type { VisiblePeopleDirectory } from '../../graph/graph.module';
import { groupIntoNotificationWindows } from '../domain/notification-window';
import type { NotifyMeMatch } from '../domain/notify-me-match';
import type { PushSubscriptionRepository } from '../domain/push-subscription.repository';
import { GROUPED_PUSH_MESSAGE, type PushTransport } from '../domain/push-transport';

import type { NotifyMeMatchRepository } from './notify-me-match.repository';

/**
 * `app.consumer_receipts.consumer_name` for this consumer.
 *
 * ADR-0006 names it. ⚠ Stable: renaming it makes every past receipt invisible and
 * re-delivers every already-flushed window once.
 */
export const SEND_GROUPED_PUSH_CONSUMER = 'SendGroupedPushHandler';

/** What flushing is given. */
export interface FlushNotificationsCommand {
  /**
   * The moment the flush is running.
   *
   * Passed in rather than read here, because "has this window elapsed" is the whole
   * decision this handler makes and a test that could not pin it would be asserting
   * against the wall clock.
   */
  readonly now: Date;
}

/** Collaborators, injected rather than resolved (addendum §12, ADR-0003). */
export interface SendGroupedPushDependencies {
  readonly matches: NotifyMeMatchRepository;
  readonly pushSubscriptions: PushSubscriptionRepository;
  /** `modules/graph`'s §6a projection — the delivery-time authorization re-check. */
  readonly visiblePeople: VisiblePeopleDirectory;
  readonly pushTransport: PushTransport;
}

export interface SendGroupedPushHandler {
  /** {@link SEND_GROUPED_PUSH_CONSUMER}, written into every receipt this handler makes. */
  readonly name: string;
  /**
   * Deliver every grouping window that has fully elapsed.
   *
   * Windows still open are left alone — that is what makes the grouping a *window* and
   * not a batch size.
   */
  flush(command: FlushNotificationsCommand): Promise<void>;
}

/**
 * The grouped-push flush (M2.11) — ADR-0006's "notification grouping window flush",
 * one of the scheduled jobs, not a client-facing operation.
 *
 * **Three rules, and each one is an AC:**
 *
 * 1. **Grouping** (M2-AC7). Matches are grouped into 60-second tumbling windows per
 *    recipient, and only a window that has fully elapsed as of `now` is delivered.
 *    Two bulletins 59 seconds apart are one notification; 61 seconds apart, two.
 * 2. **Delivery-time authorization** (M2-AC22, ADR-0002:274-279). The recipient's
 *    authorization is re-evaluated **inside the receipt transaction, immediately before
 *    dispatch** — compute-time evaluation was only an optimization. A recipient who was
 *    disconnected, blocked, deactivated or erased between compute and flush is not
 *    delivered to, and the receipt still lands: its presence beside zero push calls
 *    *is* the suppression record, and it is what stops a correctly-refused delivery
 *    being retried forever.
 * 3. **Payload** (M2-AC21). Identifiers and one fixed string. See
 *    {@link import('../domain/push-transport').PushPayload}, whose own warning is the
 *    normative one.
 *
 * The re-check asks the §6a projection whether each bulletin's **author** is still
 * visible to the recipient, rather than re-reading the bulletins: authorization here is
 * a fact about people (ADR-0002 §11 lists block, erasure, revoked visibility,
 * deactivation), and the projection is the single place that answers it (lane-brief
 * C8). ⚠ The residual is a bulletin *archived* between compute and flush: its ID can
 * still ride a push. That is bounded and deliberate — the payload carries no content,
 * and the client's follow-up read answers `BULLETIN_GONE`, which is exactly the
 * "consumers re-read current state" behaviour ADR-0006 prescribes.
 */
export function createSendGroupedPushHandler(
  dependencies: SendGroupedPushDependencies,
): SendGroupedPushHandler {
  /**
   * Re-check, then dispatch. Called by the repository **inside** the transaction that
   * writes the window's receipts, which is the ordering ADR-0002 §11 requires.
   */
  async function deliver(recipientId: string, claimed: readonly NotifyMeMatch[]): Promise<void> {
    const audience = await dependencies.visiblePeople.listFor(recipientId);
    const reachable = new Set(audience.people.map((person) => person.userId));
    const deliverable = claimed.filter((match) => reachable.has(match.authorId));

    if (deliverable.length === 0) {
      // Suppressed. Returning without sending leaves the receipt in place — see this
      // function's own contract in `notify-me-match.repository.ts`.
      return;
    }

    const subscription = await dependencies.pushSubscriptions.findByOwner(recipientId);
    if (subscription === null) {
      // Somebody with a saved query and no subscribed device. An ordinary outcome, not
      // a failure: there is nowhere to send it, and the window is still done.
      return;
    }

    await dependencies.pushTransport.send(subscription, {
      recipientId,
      // De-duplicated because one bulletin matching twice would show as two items in a
      // grouped notification, which reads as two bulletins.
      bulletinIds: [...new Set(deliverable.map((match) => match.bulletinId))],
      message: GROUPED_PUSH_MESSAGE,
    });
  }

  return {
    name: SEND_GROUPED_PUSH_CONSUMER,

    async flush(command: FlushNotificationsCommand): Promise<void> {
      const pending = await dependencies.matches.findPendingMatches();

      const elapsed = groupIntoNotificationWindows(pending).filter(
        (window) => window.endsAt.getTime() <= command.now.getTime(),
      );

      for (const window of elapsed) {
        // Sequential: each window is its own transaction, and running them in parallel
        // would have one flush hold as many connections as there are recipients.
        await dependencies.matches.completeWindow({
          matches: window.matches,
          processedAt: command.now,
          dispatch: (claimed) => deliver(window.recipientId, claimed),
        });
      }
    },
  };
}
