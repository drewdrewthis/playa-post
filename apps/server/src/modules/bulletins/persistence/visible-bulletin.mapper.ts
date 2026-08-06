import type { VisibleBulletin } from '../application/visible-bulletin';

/**
 * One row as `app.visible_bulletins` returns it.
 *
 * Hand-written rather than derived from `@playa-post/database`'s generated types,
 * which is the exception this file has to justify: `pnpm db:types` describes tables and
 * views, not a set-returning function's result. `visible-bulletins.sql`'s
 * `returns table (...)` block is the contract, and
 * `visible-bulletins-migration.integration.test.ts` pins the function's catalog shape
 * so a signature change cannot pass silently.
 *
 * `search_document` is in the function's projection and deliberately not here: the
 * board's `WHERE` reads it inside SQL, and a `tsvector` on a TypeScript row is an
 * index a caller could start believing is content.
 */
export interface VisibleBulletinRow {
  readonly bulletin_id: string;
  readonly author_id: string;
  readonly type: string;
  readonly title: string;
  readonly body: string;
  readonly created_at: Date;
  readonly version: number;
  readonly author_disclosure: string;
  /** `null` for an author below `full` disclosure — the column is not projected. */
  readonly author_display_name: string | null;
  /** `null` for an author below `full` disclosure. */
  readonly author_handle: string | null;
}

/**
 * Translate a projected row into the {@link VisibleBulletin} read model.
 *
 * ⚠ The author's identity fields are **omitted, not set to `null`**. A `null` says
 * "there is a name and you are not getting it"; an absent key says "there is no name
 * here", which is the shape ADR-0002 §6a's Private author actually has and the one
 * `exactOptionalPropertyTypes` lets the compiler keep honest. It is also what makes
 * `JSON.stringify` of a below-`full` author carry no identity keys at all — the
 * assertion `board-visibility-query.integration.test.ts`'s §6a scenario makes.
 */
export function toVisibleBulletin(row: VisibleBulletinRow): VisibleBulletin {
  return {
    id: row.bulletin_id,
    type: row.type,
    title: row.title,
    body: row.body,
    createdAt: row.created_at,
    version: row.version,
    author: {
      userId: row.author_id,
      disclosure: row.author_disclosure,
      ...(row.author_display_name === null ? {} : { displayName: row.author_display_name }),
      ...(row.author_handle === null ? {} : { handle: row.author_handle }),
    },
  };
}
