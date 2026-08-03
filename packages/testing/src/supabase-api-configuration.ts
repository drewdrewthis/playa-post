import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { parse } from 'smol-toml';

/**
 * The repository's own `supabase/config.toml`.
 *
 * Resolved from this file rather than from `process.cwd()` so the harness behaves
 * identically whether Vitest runs from the repo root, from a package, or from an editor.
 */
export const SUPABASE_CONFIGURATION_PATH = fileURLToPath(
  new URL('../../../supabase/config.toml', import.meta.url),
);

/** The `[api]` block of `supabase/config.toml`, as far as a test harness needs it. */
export interface SupabaseApiConfiguration {
  /**
   * `[api] schemas` — the schemas the Supabase CLI hands PostgREST as `db-schemas`.
   *
   * ADR-0002 §1 makes this list a security control: `app` is deliberately absent, so
   * PostgREST has no route to product data at all.
   */
  readonly exposedSchemas: readonly string[];
}

/**
 * Read the `[api]` block the Supabase CLI would hand PostgREST.
 *
 * **This is a configuration *source*, not a configuration *assertion*.** The
 * distinction is the whole design of ADR-0002 B2, whose manifest entry rejected
 * "asserting the config file instead would prove the setting, not the behaviour".
 * The value read here is fed to a live PostgREST, and the assertions run against that
 * server's real responses. Adding `"app"` to the list therefore does not make a test
 * that reads it go red on a string compare — it changes what the server exposes, and
 * B2's behavioural assertions fail because the schema becomes reachable.
 *
 * A real TOML parser rather than a regex over the `schemas = [...]` line, because
 * addendum §18 says use the proven library: the file legitimately contains the word
 * `schemas` in prose above the setting, in `extra_search_path` beside it, and in
 * `[db.migrations]` below it.
 *
 * @param path override the file to read. Defaults to {@link SUPABASE_CONFIGURATION_PATH}.
 * @throws if the file is unreadable, is not valid TOML, or has no `[api] schemas`
 *   array of strings — a harness that silently defaulted would configure PostgREST
 *   from something other than the real project.
 */
export function readSupabaseApiConfiguration(
  path: string = SUPABASE_CONFIGURATION_PATH,
): SupabaseApiConfiguration {
  return parseSupabaseApiConfiguration(readFileSync(path, 'utf8'), path);
}

/**
 * {@link readSupabaseApiConfiguration}, over TOML already in hand.
 *
 * @param toml the document text.
 * @param where a label used in error messages — a path, or any description of the source.
 * @throws if the document is not valid TOML or has no `[api] schemas` array of strings.
 */
export function parseSupabaseApiConfiguration(
  toml: string,
  where = '<toml>',
): SupabaseApiConfiguration {
  const parsed: unknown = parse(toml);
  const api = isRecord(parsed) ? parsed['api'] : undefined;
  const schemas = isRecord(api) ? api['schemas'] : undefined;

  if (!Array.isArray(schemas) || schemas.length === 0) {
    throw new Error(`${where}: expected a non-empty [api] schemas array`);
  }

  return {
    exposedSchemas: schemas.map((schema, index) => {
      if (typeof schema !== 'string' || schema.length === 0) {
        throw new Error(`${where}: [api] schemas[${index}] is not a non-empty string`);
      }
      return schema;
    }),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
