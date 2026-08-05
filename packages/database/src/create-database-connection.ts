import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';

import type { DB } from './schema';

/**
 * An open, pooled, typed handle on the application database.
 *
 * Named here rather than written as `Kysely<Database>` at every call site: this
 * package owns the choice of query builder (addendum §18), so a consumer that has to
 * spell `Kysely<...>` to declare a field has taken a dependency on that choice it did
 * not need. Swapping the builder then becomes a repo-wide rename instead of a change
 * to this file.
 */
export type DatabaseConnection = Kysely<DB>;

/**
 * Connections held open by one pool when the caller does not choose.
 *
 * Exported because the composition root has to put a number in its configuration
 * schema, and a second literal `10` written there is a restated constant that
 * drifts silently. Matches `pg`'s own default, so making it explicit changes no
 * behavior — it just gives the number one home.
 */
export const DEFAULT_MAX_CONNECTIONS = 10;

/**
 * Everything {@link createDatabaseConnection} needs. Deliberately not an
 * environment read: this package never touches `process.env`, because only
 * `composition/` may (architecture-addendum §17).
 */
export interface DatabaseConnectionOptions {
  /**
   * A `postgres://` URI whose user is the least-privileged **`app_rw`** role.
   *
   * ADR-0002 puts the whole authorization backstop on this string: `app_rw` is
   * non-owning, `nobypassrls`, and holds only per-table DML grants. Connecting as
   * the owner or as a superuser silently disables `FORCE ROW LEVEL SECURITY` for
   * every query the application makes, and nothing else in the system would
   * notice.
   *
   * Give it a **complete** URI. `pg` fills anything the URI omits from `PGUSER`,
   * `PGPASSWORD`, `PGHOST` and friends, so a URI without a role does not fail —
   * it connects as whatever the environment happens to name, which is the one
   * outcome this parameter exists to prevent.
   */
  readonly connectionString: string;
  /** Pool ceiling. Omitted or `undefined` → {@link DEFAULT_MAX_CONNECTIONS}. */
  readonly maxConnections?: number | undefined;
}

/**
 * Open a pooled, typed handle on the application database.
 *
 * The returned {@link Kysely} instance is the only sanctioned way to reach
 * Postgres from the server. Its type parameter is {@link DB} — generated from the
 * real schema by `pnpm db:types` and checked in — so a query naming a column that
 * no longer exists fails `pnpm typecheck` rather than production.
 *
 * The pool connects lazily: constructing this costs nothing and touches no socket,
 * which is what lets the composition root build the whole object graph before the
 * database is reachable.
 *
 * Kysely's logging is left at its default (errors to `console.error`) on purpose.
 * Routing query events into the structured logger is `packages/observability`'s
 * job (M1b.4); silencing them here first would remove the only error signal there
 * currently is.
 *
 * @example
 * ```ts
 * const database = createDatabaseConnection({ connectionString: config.databaseUrl });
 * try {
 *   await database.selectFrom('app.users').select('handle').execute();
 * } finally {
 *   await database.destroy();
 * }
 * ```
 */
export function createDatabaseConnection(options: DatabaseConnectionOptions): DatabaseConnection {
  const pool = new Pool({
    connectionString: options.connectionString,
    max: options.maxConnections ?? DEFAULT_MAX_CONNECTIONS,
  });

  return new Kysely<DB>({ dialect: new PostgresDialect({ pool }) });
}
