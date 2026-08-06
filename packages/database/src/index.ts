export { createDatabaseConnection, DEFAULT_MAX_CONNECTIONS } from './create-database-connection';
export type {
  DatabaseConnection,
  DatabaseConnectionOptions,
} from './create-database-connection';
/**
 * The query-builder surface a repository needs, re-exported so it has one home.
 *
 * This package owns the choice of query builder (addendum §18, and
 * `create-database-connection.ts`'s own note): a consumer that had to declare
 * `kysely` as its own dependency to write `Selectable<…>` or a `sql` fragment would
 * be pinning that choice a second time, and swapping the builder would become a
 * repo-wide dependency edit rather than a change to this package.
 *
 * ⚠ `sql` is a **persistence-layer** tool. Importing it from a module's `domain/` or
 * `application/` is a boundary break that `.dependency-cruiser.cjs` cannot see —
 * the specifier says `@playa-post/database`, not `kysely` — so the
 * `no-sql-outside-persistence` fitness rule is what catches it, by finding the `sql`
 * tag itself rather than the import edge.
 */
export { sql } from 'kysely';
/**
 * `RawBuilder` is what the `sql` tag returns, and a repository that composes a
 * fragment in one function and consumes it in another needs to name that type.
 * `SqlBool` is the parameter it is nearly always given — `RawBuilder<SqlBool>` is
 * "a `WHERE` fragment", which is exactly what a compiled board filter is.
 */
export type { Insertable, RawBuilder, Selectable, SqlBool, Updateable } from 'kysely';
/**
 * The generated schema, exported under the name the rest of the system uses.
 *
 * `DB` is kysely-codegen's fixed output name and is not configurable; `Database`
 * is what a repository signature should read as (`Kysely<Database>`). One alias
 * here beats every consumer importing a two-letter type.
 */
export type { DB as Database } from './schema';
