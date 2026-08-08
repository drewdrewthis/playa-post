import type { Database, Selectable } from '@playa-post/database';

import type { SavedView } from '../domain/saved-view';

import { toBoardQuery } from './notify-me-query.mapper';

/**
 * One `app.saved_views` row as the generated schema describes it.
 *
 * Derived from `@playa-post/database`'s checked-in types rather than hand-written, so a
 * migration that changes the table breaks `pnpm typecheck` here instead of producing
 * wrong values at runtime.
 */
export type SavedViewRow = Selectable<Database['app.saved_views']>;

/**
 * Translate a database row into the domain's {@link SavedView}.
 *
 * The stored `jsonb` AST is narrowed by
 * {@link import('./notify-me-query.mapper').toBoardQuery}, which is shared rather than
 * re-implemented for the same reason ADR-0007 shares the grammar: two narrowers would be
 * two answers to "what does this stored filter mean", and they would drift term by term.
 * It fails closed — an unrecognised value is dropped, so the worst a corrupted row can do
 * is match fewer bulletins than the person asked for.
 */
export function toSavedView(row: SavedViewRow): SavedView {
  return {
    id: row.id,
    ownerId: row.owner_id,
    name: row.name,
    sourceText: row.source_text,
    query: toBoardQuery(row.ast),
    astVersion: row.ast_version,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
