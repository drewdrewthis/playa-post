import type { DatabaseConnection } from '@playa-post/database';

import { PushSubscriptionAlreadyExistsError } from '../domain/push-subscription.errors';
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

/** PostgreSQL's `unique_violation`. */
const UNIQUE_VIOLATION = '23505';

/**
 * The fields `pg` puts on a `DatabaseError`, read structurally.
 *
 * Structural rather than `instanceof DatabaseError` so this file needs no value import
 * from the driver, and so it keeps working if the error travels through a pool wrapper
 * that copies the fields rather than the prototype — the same shape
 * `modules/identity/persistence/postgres-user.repository.ts` established.
 */
interface PostgresDriverError {
  readonly code?: unknown;
}

function isUniqueViolation(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }

  return (error as PostgresDriverError).code === UNIQUE_VIOLATION;
}

/**
 * `app.push_subscriptions`, behind the domain's {@link PushSubscriptionRepository} port.
 *
 * **The primary key on `owner_id` is the "one subscription per user" rule** (M2 scope;
 * multi-device is M5), so the second subscribe fails in the database rather than in a
 * check this file performs first. Translating that violation is all `add` does beyond
 * inserting: the constraint is the enforcement, and this is only its vocabulary
 * (M2-AC18).
 *
 * Every statement is schema-qualified (`app.push_subscriptions`, never
 * `push_subscriptions`) per ADR-0002's pooler-safety rules.
 */
export function createPostgresPushSubscriptionRepository(
  dependencies: PostgresPushSubscriptionRepositoryDependencies,
): PushSubscriptionRepository {
  const { database } = dependencies;

  return {
    async add(subscription: NewPushSubscription): Promise<void> {
      try {
        await database
          .insertInto('app.push_subscriptions')
          .values({
            owner_id: subscription.ownerId,
            endpoint: subscription.endpoint,
            p256dh_key: subscription.keys.p256dh,
            auth_key: subscription.keys.auth,
            created_at: subscription.createdAt,
          })
          .execute();
      } catch (error) {
        // Deliberately **not** `on conflict do update`. Silently replacing a stored
        // subscription would let a new device take over an account's notifications
        // while the old one keeps its permission grant and simply stops receiving —
        // a state nobody can see and nobody chose. Refusing is the honest answer, and
        // it is the one M2-AC18 asserts.
        if (isUniqueViolation(error)) {
          throw new PushSubscriptionAlreadyExistsError();
        }
        throw error;
      }
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
