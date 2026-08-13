import { sql, type DatabaseConnection } from '@playa-post/database';

import type { PersonalLink } from '../domain/personal-link';
import type { PersonalLinkRepository, PersonalLinkWrite } from '../domain/personal-link.repository';

import { toPersonalLink, type PersonalLinkRow } from './personal-link.mapper';

/** Everything the repository needs, injected (addendum §12). */
export interface PostgresPersonalLinkRepositoryDependencies {
  /** Connected as `app_rw` and nothing else (ADR-0002 §2). */
  readonly database: DatabaseConnection;
}

/**
 * The columns both statements return.
 *
 * Named columns rather than `select *`, matching this module's other repositories: written
 * once so the two upserts cannot drift into two shapes for
 * {@link import('./personal-link.mapper').PersonalLinkRow} to be right about only one of.
 */
const PERSONAL_LINK_COLUMNS = sql`owner_id, slug, created_at, rotated_at`;

/**
 * `app.personal_links`, behind the domain's {@link PersonalLinkRepository} port.
 *
 * Every statement is schema-qualified (`app.personal_links`, never `personal_links`) per
 * ADR-0002's pooler-safety rules: with `search_path` outside this file's control, an
 * unqualified name is a silent cross-schema read waiting for a `public.personal_links` to
 * exist.
 *
 * ⚠ **Neither statement names any table but this one**, which is what makes "rotation never
 * touches existing connections or received requests" (issue #206) a structural guarantee
 * rather than a promise. There is nothing to review on that point: the SQL cannot reach
 * them.
 *
 * ⚠ **There is no read by slug here, and there must never be one.** Resolving a slug to a
 * person happens in `postgres-connection-request.repository.ts`, through
 * `app.visible_people` — a lookup on this table alone would answer "yes, that slug is real"
 * for an owner the projection would have withheld, which is the ADR-0002 §10 oracle wearing
 * a convenience method.
 */
export function createPostgresPersonalLinkRepository(
  dependencies: PostgresPersonalLinkRepositoryDependencies,
): PersonalLinkRepository {
  const { database } = dependencies;

  return {
    async ensureFor(write: PersonalLinkWrite): Promise<PersonalLink> {
      // ⚠ **`do update` rather than `do nothing`, and the difference is not cosmetic.**
      // `on conflict do nothing` returns no row when the link already exists, which would
      // force a second `select` — a read the concurrent rotate could then race, on the one
      // path where losing the race means a page load reporting a slug that is already
      // stale. Updating `owner_id` to its own value is the idiom that makes the existing
      // row the statement's own `returning` output.
      //
      // ⚠ **`slug` is deliberately NOT in the `do update` set.** This is the whole
      // idempotence: a second call must return the link that exists, never overwrite it.
      // Adding `slug = excluded.slug` here would turn every arrival on the You screen into
      // a silent rotation — the exact bug the invite path's get-or-create was written to
      // stop, one order of magnitude worse, because here the old address stops resolving.
      const { rows } = await sql<PersonalLinkRow>`
        insert into app.personal_links (owner_id, slug, created_at)
        values (${write.ownerId}::uuid, ${write.slug}::text, ${write.at}::timestamptz)
        on conflict (owner_id) do update set owner_id = excluded.owner_id
        returning ${PERSONAL_LINK_COLUMNS}
      `.execute(database);

      const link = rows[0];

      if (link === undefined) {
        // Unreachable: the statement either inserts or updates, and both return a row.
        // A throw rather than a fabricated link, because a caller handed a slug this
        // process invented but never stored would publish a URL that resolves to nothing.
        throw new Error('ensureFor: the upsert returned no personal link');
      }

      return toPersonalLink(link);
    },

    async rotateFor(write: PersonalLinkWrite): Promise<PersonalLink> {
      // ⚠ **The old slug is overwritten in place.** After this statement commits there is
      // no row anywhere carrying the previous value, so a lookup for it finds nothing and
      // therefore answers exactly what a slug that never existed answers (ADR-0002 §10,
      // ADR-0018 D3). A `revoked_at` column and a second row would make that same property
      // depend on every future reader remembering a filter.
      //
      // An upsert rather than an update, so rotating works for somebody who has never
      // loaded the You screen — the `insert` arm is their first link, and it is correct for
      // `rotated_at` to be null on it: nothing was retired.
      //
      // `created_at` is left alone on the update arm. It is when this person's link first
      // existed, and rotation does not restart that; `rotated_at` is the column that moves.
      const { rows } = await sql<PersonalLinkRow>`
        insert into app.personal_links (owner_id, slug, created_at)
        values (${write.ownerId}::uuid, ${write.slug}::text, ${write.at}::timestamptz)
        on conflict (owner_id) do update
          set slug = excluded.slug,
              rotated_at = ${write.at}::timestamptz
        returning ${PERSONAL_LINK_COLUMNS}
      `.execute(database);

      const link = rows[0];

      if (link === undefined) {
        throw new Error('rotateFor: the upsert returned no personal link');
      }

      return toPersonalLink(link);
    },
  };
}
