import { ApplicationError } from '../../../shared/errors/application-error';

/**
 * This person already has a push subscription.
 *
 * M2 stores **one Web Push subscription per user** — `app.push_subscriptions` is keyed
 * on `owner_id` — and multi-device support with cross-device dedup is cut to M5
 * (`notify-me.feature`'s own scope comment). A second `subscribe` is therefore a
 * primary-key violation, which is the enforcement; this class is how that violation
 * reaches a client as the stable code M2-AC18 requires instead of a 500 with a
 * constraint name in it.
 *
 * ⚠ The message names no endpoint and no device. The caller already knows what they
 * sent, and the *stored* subscription may have come from a different browser on a
 * different machine — echoing it would tell whoever is holding this device something
 * about another one.
 *
 * When multi-device lands, this error does not become a merge: replacing a stored
 * subscription silently is how a person's old phone keeps receiving pushes they can no
 * longer see. It becomes an additional row, and this class becomes the answer to
 * subscribing the *same* endpoint twice.
 */
export class PushSubscriptionAlreadyExistsError extends ApplicationError {
  static readonly code = 'PUSH_SUBSCRIPTION_EXISTS';

  constructor() {
    super(
      PushSubscriptionAlreadyExistsError.code,
      'This account already has a push subscription.',
    );
    this.name = 'PushSubscriptionAlreadyExistsError';
  }
}
