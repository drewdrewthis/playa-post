import type { VisiblePerson } from '../application/visible-person';

/**
 * One row as `app.visible_people` returns it.
 *
 * Hand-written rather than derived from `@playa-post/database`'s generated types,
 * which is the exception this file has to justify: `pnpm db:types` describes tables
 * and views, not a set-returning function's result. `visible-people.sql`'s
 * `returns table (...)` block is the contract, and
 * `visible-people-migration.integration.test.ts` pins the function's catalog shape so
 * a signature change cannot pass silently.
 */
export interface VisiblePersonRow {
  readonly user_id: string;
  readonly degree: number;
  readonly disclosure: string;
  /** `null` for anyone below `full` disclosure — the column is not projected. */
  readonly display_name: string | null;
  /** `null` for anyone below `full` disclosure. */
  readonly handle: string | null;
  /** `null` when the viewer has assigned no trust. Unset, which is not `0`. */
  readonly trust: number | null;
}

/**
 * Translate a projected row into the exported {@link VisiblePerson} read model.
 *
 * ⚠ The identity fields are **omitted, not set to `null`**. A `null` says "there is a
 * name and you are not getting it"; an absent key says "there is no name here", which
 * is the shape ADR-0002 §6a's Private author actually has and the one
 * `exactOptionalPropertyTypes` lets the compiler keep honest. It is also what makes
 * `JSON.stringify` of a `topology_only` person carry no identity keys at all — the
 * assertion B5's person-projection sub-case makes.
 */
export function toVisiblePerson(row: VisiblePersonRow): VisiblePerson {
  return {
    userId: row.user_id,
    degree: row.degree,
    disclosure: row.disclosure,
    ...(row.display_name === null ? {} : { displayName: row.display_name }),
    ...(row.handle === null ? {} : { handle: row.handle }),
    trust: row.trust,
  };
}
