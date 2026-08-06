import type { Database, Selectable } from '@playa-post/database';

import type { Bulletin } from '../domain/bulletin';

/**
 * One `app.bulletins` row as the generated schema describes it.
 *
 * Derived from `@playa-post/database`'s checked-in types rather than hand-written, so
 * a migration that changes the table breaks `pnpm typecheck` here instead of producing
 * wrong values at runtime.
 */
export type BulletinRow = Selectable<Database['app.bulletins']>;

/**
 * Translate a database row into the domain's {@link Bulletin}.
 *
 * ⚠ `search_document` is deliberately not mapped. It is a derived index over title and
 * body — a query input, never a value a caller reads — and carrying it into the domain
 * would put a search implementation detail in every payload that serializes a bulletin.
 */
export function toBulletin(row: BulletinRow): Bulletin {
  return {
    id: row.id,
    authorId: row.author_id,
    type: row.type,
    title: row.title,
    body: row.body,
    createdAt: row.created_at,
    archivedAt: row.archived_at,
    version: row.version,
  };
}
