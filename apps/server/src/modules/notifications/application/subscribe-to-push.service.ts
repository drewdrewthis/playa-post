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
 * **Thin, and the thinness is the M2-AC18 design.** There is no "does this person
 * already have one" read before the write: `app.push_subscriptions` is keyed on
 * `owner_id`, so the second subscribe is a primary-key violation the repository maps
 * onto {@link import('../domain/push-subscription.errors').PushSubscriptionAlreadyExistsError}.
 * A read-then-write would answer the same question with a race in the middle, and would
 * make "one subscription per user" a rule a future edit could drop without the database
 * noticing.
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
      await dependencies.pushSubscriptions.add({
        ownerId: command.actorId,
        endpoint: command.endpoint,
        keys: { p256dh: command.keys.p256dh, auth: command.keys.auth },
        createdAt: readClock(),
      });
    },
  };
}
