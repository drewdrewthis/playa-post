import type { DatabaseConnection } from '@playa-post/database';

import type {
  NewPushSubscription,
  PushSubscriptionRepository,
} from '../domain/push-subscription.repository';
import type { PushSubscription } from '../domain/push-transport';

/** Everything the repository needs, injected (addendum §12). */
export interface PostgresPushSubscriptionRepositoryDependencies {
  /** Connected as `app_rw` and nothing else (ADR-0002 §2). */
  readonly database: DatabaseConnection;
}

/**
 * `app.push_subscriptions`, behind the domain's {@link PushSubscriptionRepository} port.
 *
 * **The primary key on `owner_id` is the "one subscription per user" rule** (M2 scope;
 * multi-device is M5) — and it is also the conflict target that makes `save` a single
 * statement. There is no read before the write and no application-level "does one
 * exist": the key decides which row this is, and the upsert decides what it now holds,
 * so two concurrent subscribes cannot interleave into a lost row.
 *
 * Every statement is schema-qualified (`app.push_subscriptions`, never
 * `push_subscriptions`) per ADR-0002's pooler-safety rules.
 */
export function createPostgresPushSubscriptionRepository(
  dependencies: PostgresPushSubscriptionRepositoryDependencies,
): PushSubscriptionRepository {
  const { database } = dependencies;

  return {
    async save(subscription: NewPushSubscription): Promise<void> {
      await database
        .insertInto('app.push_subscriptions')
        .values({
          owner_id: subscription.ownerId,
          endpoint: subscription.endpoint,
          p256dh_key: subscription.keys.p256dh,
          auth_key: subscription.keys.auth,
          created_at: subscription.createdAt,
        })
        .onConflict((conflict) =>
          // Targeted at the owner key rather than a named constraint, so the statement
          // says which rule it is reconciling against instead of which index happens to
          // implement it.
          conflict.column('owner_id').doUpdateSet({
            endpoint: subscription.endpoint,
            p256dh_key: subscription.keys.p256dh,
            auth_key: subscription.keys.auth,
            // Replaced along with the credential: the row *is* the current subscription,
            // and leaving the first enrollment's timestamp on a credential minted today
            // would misreport its age to anything that later ages subscriptions out.
            created_at: subscription.createdAt,
          }),
        )
        .execute();
    },

    async findByOwner(ownerId: string): Promise<PushSubscription | null> {
      const row = await database
        .selectFrom('app.push_subscriptions')
        .select(['endpoint', 'p256dh_key', 'auth_key'])
        .where('owner_id', '=', ownerId)
        .executeTakeFirst();

      return row === undefined
        ? null
        : { endpoint: row.endpoint, keys: { p256dh: row.p256dh_key, auth: row.auth_key } };
    },
  };
}
