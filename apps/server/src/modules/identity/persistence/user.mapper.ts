import type { Database, Selectable } from '@playa-post/database';

import type { User } from '../domain/user';
import { toVisibleToDistance } from '../domain/visible-to-distance';

/**
 * One `app.users` row as the generated schema describes it.
 *
 * Derived from `@playa-post/database`'s checked-in types rather than hand-written, so
 * a migration that changes the table breaks `pnpm typecheck` here instead of
 * producing wrong values at runtime.
 */
export type UserRow = Selectable<Database['app.users']>;

/**
 * Translate a database row into the domain's `User`.
 *
 * The whole reason the persistence layer exists: `snake_case` columns, `citext`, and
 * nullable timestamps are storage concerns, and every one of them stops at this
 * function. Nothing above `persistence/` may see a row shape.
 *
 * `status` is carried across as-is. Narrowing it to the four known values would need
 * either an unchecked cast or a throw on an unrecognised row; `isActorEligible` fails
 * closed instead, which is the safer half of that trade (see `domain/user.ts`).
 */
export function toUser(row: UserRow): User {
  return {
    id: row.id,
    authUserId: row.auth_user_id,
    handle: row.handle,
    displayName: row.display_name,
    avatarPath: row.avatar_path,
    status: row.status,
    visibleToDistance: toVisibleToDistance(row.visible_to_distance),
    createdAt: row.created_at,
    deactivatedAt: row.deactivated_at,
    erasedAt: row.erased_at,
    version: row.version,
  };
}
