import { sql, type RawBuilder, type SqlBool } from '@playa-post/database';

import type { BoardQuery } from '../../views/views.module';

/**
 * Compile a validated {@link BoardQuery} into a `WHERE` fragment over the authorized
 * set — ADR-0007's `CompileBoardFilter`.
 *
 * **Every user-supplied value leaves as a bound parameter.** Nothing here interpolates
 * text into SQL; `${…}` inside Kysely's `sql` tag emits a placeholder and hands the
 * value to the driver. The literal SQL around those placeholders is written in this
 * file and is the same for every caller, so the only thing a query can change is *what
 * a fixed predicate is compared against* (ADR-0007:88).
 *
 * **It can only narrow.** The fragment is ANDed into
 * `WITH authorized AS (SELECT * FROM app.visible_bulletins(:viewer_id))
 *  SELECT … FROM authorized WHERE <this>`, so every predicate is evaluated over rows
 * the viewer could already see. There is no `OR`, no join, and no subquery reaching
 * outside `authorized` — and no way to write one, because {@link BoardQuery} has
 * nowhere to carry one. That is ADR-0002 B10, proven against a real database by
 * `tests/security/board-query-narrowing.security.test.ts`.
 *
 * @returns `true` for an empty query — the default board, unnarrowed. A literal rather
 *   than a caller-side branch so there is exactly one shape of board statement to read
 *   and to reason about.
 */
export function compileBoardFilter(query: BoardQuery): RawBuilder<SqlBool> {
  const predicates: RawBuilder<SqlBool>[] = [];

  if (query.types.length > 0) {
    // `= any($1::text[])` rather than a generated `IN (…)` list: one bound parameter
    // whose arity the query text does not encode, so two boards filtering on different
    // numbers of types are the same statement to the planner and to a reader.
    predicates.push(sql<SqlBool>`type = any(${[...query.types]}::text[])`);
  }

  for (const term of query.text) {
    // `plainto_tsquery` treats its input as data, not as query syntax: a term
    // containing `&`, `|` or `!` matches those characters rather than becoming a
    // boolean operator, so the grammar's "bare word" cannot smuggle in structure the
    // parser refused. Schema-qualified because this statement runs with whatever
    // `search_path` the pooler handed the session (ADR-0002:164).
    predicates.push(
      sql<SqlBool>`search_document @@ pg_catalog.plainto_tsquery('simple', ${term})`,
    );
  }

  return predicates.length === 0
    ? sql<SqlBool>`true`
    : sql<SqlBool>`${sql.join(predicates, sql` and `)}`;
}
