/**
 * The Web Push endpoint a client handed us at subscribe time.
 *
 * Exactly what the browser's `PushManager.subscribe()` returns and nothing more. It is
 * **routing data, not contact data** — the same distinction ADR-0006 draws for an
 * outbox payload — which is why it may live in a table and be read by a delivery
 * handler without becoming personal information anybody has to project through §6a.
 */
export interface PushSubscription {
  readonly endpoint: string;
  readonly keys: {
    readonly p256dh: string;
    readonly auth: string;
  };
}

/**
 * What a push notification is allowed to carry — **identifiers and a generic string,
 * and that is the whole vocabulary** (ADR-0002:280-283, M2-AC21).
 *
 * ⚠ **Never add a field carrying content.** Not a headline, not a body excerpt, not an
 * author's display name or handle, not a count that is derived from something private.
 * A rendered lock-screen notification is data leaving the authorization boundary onto
 * an unlocked-device surface — the one place in this system where the viewer is not
 * the person who authenticated. The client fetches content *after* authenticating,
 * through `bulletins.getById`, which re-applies visibility at read time and answers
 * `BULLETIN_GONE` if the bulletin has since been taken down.
 *
 * `authorId` is deliberately absent as well: it is an identifier, but a push naming who
 * posted is a push that discloses a relationship to whoever is holding the phone.
 *
 * M2-AC21's evidence is this payload quoted in full, and
 * `notify-me-push.integration.test.ts` asserts the key set exactly — an accidentally
 * added field fails that test rather than shipping.
 */
export interface PushPayload {
  /** Who this is for — `app.users.id`, so a multi-account client can route it. */
  readonly recipientId: string;
  /** What to fetch once the client has authenticated. Identifiers only. */
  readonly bulletinIds: readonly string[];
  /** {@link GROUPED_PUSH_MESSAGE}. A fixed string, never interpolated. */
  readonly message: string;
}

/**
 * The one string a Notify Me push displays.
 *
 * A constant rather than a template, because a template is a place for a variable to
 * be interpolated later and every variable in reach is content. It says that something
 * matched, and nothing about what.
 */
export const GROUPED_PUSH_MESSAGE = 'Something new matches your Notify Me query.';

/**
 * The port onto whatever actually delivers a Web Push.
 *
 * Declared in `domain/` and implemented by an adapter (addendum §2, ADR-0003): the
 * network, VAPID keys, and the Web Push encryption scheme are infrastructure, and
 * `SendGroupedPushHandler` must be testable by handing it a fake — which is what
 * proves M2-AC21's payload shape and M2-AC22's suppression without a network.
 *
 * ⚠ `send` is called **inside the consumer's receipt transaction** (ADR-0002:274-279):
 * the delivery-time authorization re-check and the dispatch have to be one atomic
 * decision, so an implementation that blocks for a long time holds a transaction open.
 * A real transport should be fast or fire into a bounded queue of its own.
 */
export interface PushTransport {
  /**
   * Deliver one grouped notification.
   *
   * @throws when delivery fails, which rolls back the receipt so the window is
   *   retried. At-least-once is the contract (ADR-0006); a swallowed failure would
   *   make it at-most-once and silently lose notifications.
   */
  send(subscription: PushSubscription, payload: PushPayload): Promise<void>;

  /**
   * `false` only on a transport that cannot deliver at all, whatever it is handed.
   *
   * Read by the composition root to decide whether to schedule the grouping-window
   * flush: a flush that can only ever throw is not worth running on a timer, and
   * running it anyway would fill the log with a failure nobody can act on until VAPID
   * configuration lands. See `entrypoints/http/main.ts`'s skip path.
   *
   * ⚠ **Omitted means configured**, and that direction is deliberate. A real adapter
   * that forgets to declare this still gets scheduled — noisy at worst — whereas the
   * opposite default would let a working transport silently never be scheduled, which
   * is the silent-hole failure this module's every other warning is about. The single
   * object that must answer `false` says so explicitly, and
   * {@link isPushDeliveryConfigured} is the only place that reads it.
   */
  readonly isConfigured?: boolean | undefined;
}

/**
 * Whether `transport` can actually deliver — the one reading of
 * {@link PushTransport.isConfigured}, so its "omitted means configured" default exists
 * in exactly one place rather than as a `!== false` repeated at each call site.
 */
export function isPushDeliveryConfigured(transport: PushTransport): boolean {
  return transport.isConfigured !== false;
}
