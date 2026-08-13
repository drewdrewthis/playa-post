import type { Database, Selectable } from '@playa-post/database';

import type { PersonalLink } from '../domain/personal-link';

/**
 * One `app.personal_links` row as the generated schema describes it.
 *
 * Derived from `@playa-post/database`'s checked-in types rather than hand-written, so a
 * migration that changes the table breaks `pnpm typecheck` here instead of producing wrong
 * values at runtime.
 */
export type PersonalLinkRow = Selectable<Database['app.personal_links']>;

/**
 * Translate a database row into the domain's {@link PersonalLink}.
 *
 * ⚠ `rotatedAt` is **omitted, not null**, on a link that has never been rotated, which is
 * what `exactOptionalPropertyTypes` lets the compiler keep honest. There is no field here
 * for the previous slug because there is no column for one — rotation overwrites, so the
 * retired value exists nowhere, which is the property that makes an old URL answer exactly
 * what an invented one answers.
 */
export function toPersonalLink(row: PersonalLinkRow): PersonalLink {
  return {
    ownerId: row.owner_id,
    slug: row.slug,
    createdAt: row.created_at,
    ...(row.rotated_at === null ? {} : { rotatedAt: row.rotated_at }),
  };
}
