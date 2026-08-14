import type { DatabaseConnection } from '@playa-post/database';

import { NOTIFICATION_KINDS, type NotificationKind } from '../domain/notification-kind';
import type { NotificationOptoutRepository } from '../domain/notification-optout.repository';

/** Everything the repository needs, injected (addendum §12). */
export interface PostgresNotificationOptoutRepositoryDependencies {
  /** Connected as `app_rw` and nothing else (ADR-0002 §2). */
  readonly database: DatabaseConnection;
}

/**
 * `app.notification_optouts`, behind {@link NotificationOptoutRepository}.
 *
 * Every statement is schema-qualified per ADR-0002's pooler-safety rules.
 *
 * ⚠ **Nothing here writes `app.outbox_events`**, matching this module's dismissal and
 * watermark repositories: a settings flip is a person configuring their own bell, and
 * it has no consumer. The flip takes effect because the *next* event's handler reads
 * this table — nothing already computed is revisited.
 */
export function createPostgresNotificationOptoutRepository(
  dependencies: PostgresNotificationOptoutRepositoryDependencies,
): NotificationOptoutRepository {
  const { database } = dependencies;

  return {
    async findOptedOutKinds(ownerId: string): Promise<ReadonlySet<NotificationKind>> {
      const rows = await database
        .selectFrom('app.notification_optouts')
        .select('kind')
        .where('owner_id', '=', ownerId)
        .execute();

      // The CHECK constrains what the column can hold, so every stored value is a
      // member — but the narrowing is still done by lookup rather than by cast, so a
      // widened CHECK without a widened NOTIFICATION_KINDS reads as "not opted out"
      // instead of leaking an unknown kind into the domain.
      return new Set(
        rows
          .map((row) => row.kind)
          .filter((kind): kind is NotificationKind =>
            (NOTIFICATION_KINDS as readonly string[]).includes(kind),
          ),
      );
    },

    async hasOptedOut(ownerId: string, kind: NotificationKind): Promise<boolean> {
      const row = await database
        .selectFrom('app.notification_optouts')
        .select('owner_id')
        .where('owner_id', '=', ownerId)
        .where('kind', '=', kind)
        .executeTakeFirst();

      return row !== undefined;
    },

    async optOut(ownerId: string, kind: NotificationKind): Promise<void> {
      // `do nothing` is the idempotency: switching off a switched-off kind is one row,
      // and a retry after a dropped connection converges (ADR-0020 D3).
      await database
        .insertInto('app.notification_optouts')
        .values({ owner_id: ownerId, kind })
        .onConflict((conflict) => conflict.doNothing())
        .execute();
    },

    async optIn(ownerId: string, kind: NotificationKind): Promise<void> {
      await database
        .deleteFrom('app.notification_optouts')
        .where('owner_id', '=', ownerId)
        .where('kind', '=', kind)
        .execute();
    },
  };
}
