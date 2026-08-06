import type { Database, Selectable } from '@playa-post/database';

import {
  BOARD_BULLETIN_TYPES,
  EMPTY_BOARD_QUERY,
  type BoardBulletinType,
  type BoardQuery,
} from '../domain/board-query-grammar';
import type { NotifyMeQuery } from '../domain/notify-me-query';

/**
 * One `app.notify_me_queries` row as the generated schema describes it.
 *
 * Derived from `@playa-post/database`'s checked-in types rather than hand-written, so
 * a migration that changes the table breaks `pnpm typecheck` here instead of producing
 * wrong values at runtime.
 */
export type NotifyMeQueryRow = Selectable<Database['app.notify_me_queries']>;

/**
 * Narrow a stored `jsonb` AST back into a {@link BoardQuery}.
 *
 * ⚠ **It fails closed, term by term.** The AST was validated by
 * {@link import('../domain/board-query-grammar').parseBoardQuery} before it was
 * written, and callers only ever read rows at the current `ast_version` — but `jsonb`
 * is `unknown` to the compiler, and "it must be fine, we wrote it" is how a hand-edited
 * row, a partially-applied migration, or a restored backup turns into a filter that
 * narrows *less* than the person asked for. A value this function does not recognise is
 * dropped rather than passed through, so the worst a corrupted row can do is match
 * fewer bulletins.
 *
 * Dropping is safe **here and nowhere else**: at parse time an unrecognised token is
 * refused naming the token (ADR-0007:53-56), because the person is present to see the
 * error. Nobody is present when a stored AST is read.
 */
export function toBoardQuery(ast: unknown): BoardQuery {
  if (typeof ast !== 'object' || ast === null || Array.isArray(ast)) {
    return EMPTY_BOARD_QUERY;
  }

  const { types, text } = ast as { types?: unknown; text?: unknown };

  return {
    types: stringsOf(types).filter(isBoardBulletinType),
    text: stringsOf(text),
  };
}

/**
 * Translate a database row into the domain's {@link NotifyMeQuery}.
 */
export function toNotifyMeQuery(row: NotifyMeQueryRow): NotifyMeQuery {
  return {
    ownerId: row.owner_id,
    sourceText: row.source_text,
    query: toBoardQuery(row.ast),
    astVersion: row.ast_version,
    version: row.version,
    updatedAt: row.updated_at,
  };
}

function stringsOf(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function isBoardBulletinType(candidate: string): candidate is BoardBulletinType {
  return (BOARD_BULLETIN_TYPES as readonly string[]).includes(candidate);
}
