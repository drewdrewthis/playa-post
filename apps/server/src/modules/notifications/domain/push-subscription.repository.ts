import type { PushSubscription } from './push-transport';

/**
 * What subscribing to push is given.
 *
 * `ownerId` is the *actor*, resolved at the tRPC context boundary and never a field on
 * a procedure input (ADR-0002:180-181, B14). A caller can only ever subscribe
 * themselves, so there is no unrelated-actor case here for M2-AC19 to exercise — the
 * same fail-closed-by-construction shape `bulletin.create` has.
 */
export interface NewPushSubscription extends PushSubscription {
  readonly ownerId: string;
  readonly createdAt: Date;
}

/**
 * The push-subscription port.
 *
 * Declared here in `domain/` and implemented in `persistence/` (addendum §2).
 */
export interface PushSubscriptionRepository {
  /**
   * Store this actor's subscription.
   *
   * @throws {import('./push-subscription.errors').PushSubscriptionAlreadyExistsError}
   *   when the actor already has one — the primary key is what detects it, not a
   *   prior read, so two concurrent subscribes cannot both win (M2-AC18).
   */
  add(subscription: NewPushSubscription): Promise<void>;

  /**
   * The subscription to deliver to, or `null` when this person has none.
   *
   * `null` is an ordinary outcome, not an error: somebody with a Notify Me query and
   * no subscribed device is a person who saved a filter on the web and never granted
   * notification permission. The window still flushes and still writes its receipt —
   * there is simply nowhere to send it.
   */
  findByOwner(ownerId: string): Promise<PushSubscription | null>;
}
