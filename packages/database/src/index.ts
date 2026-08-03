export { createDatabaseConnection, DEFAULT_MAX_CONNECTIONS } from './create-database-connection';
export type { DatabaseConnectionOptions } from './create-database-connection';
/**
 * The generated schema, exported under the name the rest of the system uses.
 *
 * `DB` is kysely-codegen's fixed output name and is not configurable; `Database`
 * is what a repository signature should read as (`Kysely<Database>`). One alias
 * here beats every consumer importing a two-letter type.
 */
export type { DB as Database } from './schema';
