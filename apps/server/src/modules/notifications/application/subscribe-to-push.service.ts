import type { PushSubscriptionRepository } from '../domain/push-subscription.repository';

/**
 * What subscribing to push is given.
 *
 * `actorId` comes from the `Actor` resolved at the tRPC context boundary, never from
 * the request body (ADR-0002:180-181). The rest is exactly what the browser's
 * `PushManager.subscribe()` handed the client — this service does not interpret it, it
 * stores it.
 */
export interface SubscribeToPushCommand {
  readonly actorId: string;
  readonly endpoint: string;
  readonly keys: {
    readonly p256dh: string;
    readonly auth: string;
  };
}

export interface SubscribeToPushService {
  subscribe(command: SubscribeToPushCommand): Promise<void>;
}

/** Collaborators, injected rather than resolved (addendum §12, ADR-0003). */
export interface SubscribeToPushDependencies {
  readonly pushSubscriptions: PushSubscriptionRepository;
  /** Reads the wall clock. Overridable so a test can pin `created_at`. */
  readonly now?: (() => Date) | undefined;
}

/**
 * The subscribe-to-push use case (M2.11).
 *
 * **Idempotent by replacement, and that is the whole design.** There is no "does this
 * person already have one" read before the write and no refusal: `app.push_subscriptions`
 * is keyed on `owner_id`, and the repository's upsert makes the submitted subscription
 * the one this account's pushes go to. Enrolling is therefore always safe to repeat,
 * which is what a client needs it to be — pressing "Enable push" is the only lever a
 * person has, and it has to work the second time as well as the first.
 *
 * ⚠ **Last-writer-wins, and the loser is not told.** With one row per owner (multi-device
 * is M5), a device enrolling displaces whatever was stored — including another browser
 * that keeps its permission grant and quietly stops receiving. That is the accepted cost,
 * because the alternative this replaces was first-writer-*forever*: the transport
 * tolerates a dead endpoint by design (`web-push.transport.ts`) and nothing deletes one,
 * so a refusal on the second subscribe made an account permanently unreachable with no
 * way back. Displacement at least follows an explicit press on the device that wins.
 *
 * Returns nothing. Echoing the stored subscription back would put an endpoint — a
 * routable, long-lived credential for pushing to somebody's device — into a response
 * body for no reason the caller has, since the caller is the one who sent it.
 */
export function createSubscribeToPushService(
  dependencies: SubscribeToPushDependencies,
): SubscribeToPushService {
  const readClock = dependencies.now ?? ((): Date => new Date());

  return {
    async subscribe(command: SubscribeToPushCommand): Promise<void> {
      await dependencies.pushSubscriptions.save({
        ownerId: command.actorId,
        endpoint: command.endpoint,
        keys: { p256dh: command.keys.p256dh, auth: command.keys.auth },
        createdAt: readClock(),
      });
    },
  };
}
