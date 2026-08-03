import { describe, expect, it } from 'vitest';

import {
  parseSupabaseApiConfiguration,
  readSupabaseApiConfiguration,
} from './supabase-api-configuration';

/**
 * The reader that decides which schemas the ADR-0002 B2 harness starts PostgREST with.
 *
 * It is unit-tested rather than trusted because it is the single point where a real
 * security setting becomes a harness input: read the wrong key and B2 asserts against a
 * server that has nothing to do with the project's configuration, while still going
 * green. Every case below is one way a `schemas = [...]` regex — the thing this module
 * exists instead of — gets the answer wrong.
 */
describe('Supabase [api] configuration reader', () => {
  it('reads the exposed schema list, in order', () => {
    expect(
      parseSupabaseApiConfiguration(`
        [api]
        schemas = ["public", "graphql_public"]
      `).exposedSchemas,
    ).toEqual(['public', 'graphql_public']);
  });

  it('is not fooled by prose above the setting that names other schemas', () => {
    // The real file carries exactly this: a comment explaining that `app` is absent
    // *on purpose*, which mentions `app` and `schemas` on lines a regex would match.
    expect(
      parseSupabaseApiConfiguration(`
        [api]
        # DELIBERATE (ADR-0002): product tables live in schema \`app\`, which is NOT
        # listed here. Adding "app" to this list would expose every table.
        # schemas = ["public", "app"]
        schemas = ["public"]
      `).exposedSchemas,
    ).toEqual(['public']);
  });

  it('does not confuse extra_search_path with the exposed list', () => {
    // `extra_search_path` sits directly under `schemas` in the real file and is also an
    // array of schema names — but it widens function resolution, not API exposure.
    expect(
      parseSupabaseApiConfiguration(`
        [api]
        schemas = ["public"]
        extra_search_path = ["public", "extensions"]
      `).exposedSchemas,
    ).toEqual(['public']);
  });

  it('reads [api] and not a same-named key in another block', () => {
    expect(
      parseSupabaseApiConfiguration(`
        [db.migrations]
        schemas = ["app"]

        [api]
        schemas = ["public"]
      `).exposedSchemas,
    ).toEqual(['public']);
  });

  it.each([
    ['no [api] block', '[db]\nport = 54322'],
    ['no schemas key', '[api]\nport = 54321'],
    ['an empty list', '[api]\nschemas = []'],
    ['a non-string entry', '[api]\nschemas = ["public", 7]'],
  ])('throws rather than defaulting when the document has %s', (_label, toml) => {
    // Defaulting would silently start PostgREST with a schema list nobody chose, which
    // is precisely the failure B2 exists to detect.
    expect(() => parseSupabaseApiConfiguration(toml, 'fixture')).toThrow(/fixture/);
  });

  it('reads this repository’s own supabase/config.toml', () => {
    // Whether `app` is in this list is asserted *behaviourally* by
    // `tests/security/postgrest-schema-exposure.security.test.ts`, not here. Restating
    // it as a string compare would hand a future editor a second place to "fix".
    expect(readSupabaseApiConfiguration().exposedSchemas.length).toBeGreaterThan(0);
  });
});
