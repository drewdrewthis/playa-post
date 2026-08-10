import webPush from 'web-push';

import type { PushPayload, PushSubscription, PushTransport } from '../domain/push-transport';

/**
 * The VAPID material this adapter signs with (RFC 8292).
 *
 * Declared here rather than imported from `@playa-post/configuration`, so no module
 * depends on the environment package — `composition/config.ts` is the only file that
 * reads an environment, and a module typed by its shape is one import away from
 * reading one. Structurally identical to that package's `WebPushConfiguration`, which
 * is what lets the composition root pass `configuration.webPush` straight in.
 *
 * ⚠ `privateKey` is a secret. It is never logged and never leaves this object.
 */
export interface VapidCredentials {
  /** Not a secret: the browser subscribed with this same string. */
  readonly publicKey: string;
  readonly privateKey: string;
  /** `mailto:` or `https:` URI a push service can reach the operator at. */
  readonly contact: string;
}

/**
 * The one log line this adapter emits, as the narrowest interface that carries it.
 *
 * A structural port rather than `@playa-post/observability`'s `Logger`: this adapter
 * needs one call, and naming the whole logging package as a dependency of a module
 * would put pino's type on a module boundary for the sake of a single `warn`. The
 * composition root's pino logger satisfies this as-is.
 */
export interface WebPushLog {
  warn(fields: Record<string, unknown>, message: string): void;
}

/**
 * `web-push`'s `sendNotification`, as the narrowest signature this adapter uses.
 *
 * A named type so it can be overridden in {@link WebPushTransportDependencies} — the
 * same optional-collaborator seam `SubscribeToPushService` uses for the clock, and for
 * the same reason: the alternative is a module-level mock of a third-party package,
 * which this repository has none of and which would test the mock's shape rather than
 * this adapter's decisions.
 */
export type SendWebPushNotification = (
  subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
  payload: string,
  options: { vapidDetails: { subject: string; publicKey: string; privateKey: string } },
) => Promise<unknown>;

/** Collaborators, injected rather than resolved (addendum §12, ADR-0003). */
export interface WebPushTransportDependencies {
  readonly vapid: VapidCredentials;
  readonly log: WebPushLog;
  /**
   * The library call. Defaults to `web-push`'s own.
   *
   * ⚠ Overridden **only** by this adapter's unit test. A push service is a network
   * boundary that cannot be called cheaply or deterministically, which is the one case
   * `references/principles/coding.md` allows a double for — and everything worth
   * asserting here (the payload on the wire, the VAPID details, what a 410 does) is
   * visible at exactly this seam.
   */
  readonly sendNotification?: SendWebPushNotification | undefined;
}

/**
 * HTTP statuses a push service uses to say **this endpoint is permanently gone** —
 * the browser unsubscribed, cleared its site data, or the subscription expired.
 *
 * [RFC 8030](https://www.rfc-editor.org/rfc/rfc8030) §7.3 specifies 404 for an unknown
 * subscription and 410 for an expired one; every major push service sends one or the
 * other, and the [web-push protocol
 * guidance](https://web.dev/articles/push-notifications-web-push-protocol) names the
 * pair as the signal to stop sending.
 */
const ENDPOINT_GONE_STATUSES: ReadonlySet<number> = new Set([404, 410]);

/**
 * Read a `statusCode` off an unknown rejection without asserting its class.
 *
 * ⚠ **Duck-typed rather than `instanceof WebPushError`**, the same call
 * `sign-in-failure.ts` makes about Supabase's two error shapes: `web-push` rejects with
 * its own class for a non-2xx response and with a plain transport error for a socket
 * failure, and a class check would quietly stop recognising a gone endpoint the day the
 * library re-exports that class from a second copy of itself under a different
 * `node_modules` path.
 */
function statusCodeOf(error: unknown): number | undefined {
  const statusCode =
    typeof error === 'object' && error !== null
      ? (error as Record<string, unknown>)['statusCode']
      : undefined;

  return typeof statusCode === 'number' ? statusCode : undefined;
}

/**
 * The real {@link PushTransport}: `web-push` over the Web Push protocol
 * ([RFC 8291](https://www.rfc-editor.org/rfc/rfc8291) payload encryption,
 * [RFC 8292](https://www.rfc-editor.org/rfc/rfc8292) VAPID authentication).
 *
 * The library rather than a hand-rolled sender, because payload encryption and VAPID
 * JWT signing are crypto and protocol, and addendum §18 gates re-implementing either
 * behind an ADR. This adapter is the thin part: serialise the payload, sign with the
 * configured credentials, and decide what a failure means.
 *
 * **The body on the wire is `JSON.stringify(payload)` and nothing else** — the three
 * fields {@link PushPayload} allows, whose own warning is the normative one (ADR-0002
 * §11, M2-AC21). No title, no icon, no tag, no `data` envelope: every one of those is a
 * place for content to be added later, and a rendered lock-screen notification is the
 * one surface in this system where the viewer is not the person who authenticated.
 *
 * ⚠ **VAPID details are passed per call, never through `webPush.setVapidDetails()`.**
 * That function mutates module-global state shared by every importer in the process, so
 * two containers in one process — which is exactly what the test suites build — would
 * silently sign each other's pushes with the last-constructed credentials.
 *
 * ⚠ **`isConfigured: true` is stated explicitly** even though omitting it would read the
 * same (`isPushDeliveryConfigured`'s fail-safe default). This is the object that makes
 * the composition root schedule the flush; saying so is cheaper than inferring it from
 * an absence.
 *
 * @param dependencies - Credentials from `Configuration.webPush`, and the composition
 *   root's logger.
 *
 * @example
 * ```ts
 * const pushTransport =
 *   configuration.webPush === null
 *     ? unconfiguredPushTransport
 *     : createWebPushTransport({ vapid: configuration.webPush, log: logger });
 * ```
 */
export function createWebPushTransport(
  dependencies: WebPushTransportDependencies,
): PushTransport {
  const vapidDetails = {
    subject: dependencies.vapid.contact,
    publicKey: dependencies.vapid.publicKey,
    privateKey: dependencies.vapid.privateKey,
  };
  const sendNotification = dependencies.sendNotification ?? webPush.sendNotification;

  return {
    isConfigured: true,

    async send(subscription: PushSubscription, payload: PushPayload): Promise<void> {
      try {
        await sendNotification(
          {
            endpoint: subscription.endpoint,
            keys: { p256dh: subscription.keys.p256dh, auth: subscription.keys.auth },
          },
          JSON.stringify(payload),
          { vapidDetails },
        );
      } catch (error) {
        const statusCode = statusCodeOf(error);

        if (statusCode === undefined || !ENDPOINT_GONE_STATUSES.has(statusCode)) {
          // Everything else — a 5xx from the push service, a rate limit, a dropped
          // socket — is transient, and throwing is the contract: it rolls the receipt
          // back so the window is retried (at-least-once, ADR-0006).
          throw error;
        }

        /*
         * A gone endpoint is the one failure that must NOT throw.
         *
         * `send` is called inside the flush's receipt transaction, and the flush walks
         * its windows sequentially — so a subscription that can only ever answer 410
         * would roll its window back on every round, forever, and starve every
         * recipient whose window sorts after it. One dead device would silently stop
         * everybody else's notifications, which is a strictly worse failure than the
         * one being tolerated here.
         *
         * Returning normally commits the receipt, and the receipt is also what puts
         * the notification in `notifications.list` — the bell panel reads
         * `app.outbox_events` joined to this consumer's receipts. So the person still
         * sees it in the app; what is lost is a ping to a device that has already
         * unsubscribed.
         *
         * The row is deliberately NOT pruned here: `PushSubscriptionRepository` has no
         * delete, this adapter owns no persistence, and inventing one from an
         * infrastructure adapter would put a write behind a transport interface whose
         * whole contract is "deliver this". Pruning belongs with multi-device support
         * (M5), where a subscription set replaces the single row.
         */
        dependencies.log.warn(
          { statusCode },
          'push endpoint is gone — notification recorded, device not reached',
        );
      }
    },
  };
}
