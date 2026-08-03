import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { POSTGRES_TEST_IMAGE } from './postgres-test-database';
import { SUPABASE_CONFIGURATION_PATH } from './supabase-api-configuration';

/**
 * The Postgres major version is asserted in two places that cannot import each other:
 * `POSTGRES_TEST_IMAGE` here and `db.major_version` in `supabase/config.toml`. Nothing
 * makes them agree, and disagreement is silent — integration tests keep passing against
 * one version while `supabase start` runs another, which is exactly the drift issue #3
 * was opened for.
 *
 * A unit test is the cheapest join between them: it needs no container, so it runs on
 * save and in the `unit` CI job, and it fails the moment one side is bumped alone.
 */
describe('Postgres version is single-sourced', () => {
  // Boy-scout: the path was derived here from the migrations directory. There is now one
  // exported constant for it, so the two readers of `supabase/config.toml` cannot drift.
  const configurationPath = SUPABASE_CONFIGURATION_PATH;

  it('pins the same major in POSTGRES_TEST_IMAGE and supabase/config.toml', () => {
    const configuration = readFileSync(configurationPath, 'utf8');

    // Anchored to line start so the explanatory prose above the setting — which
    // legitimately mentions other versions — cannot satisfy the match.
    const declared = /^major_version\s*=\s*(\d+)/m.exec(configuration)?.[1];
    const image = /^postgres:(\d+)$/.exec(POSTGRES_TEST_IMAGE)?.[1];

    expect(declared, `no major_version found in ${configurationPath}`).toBeDefined();
    expect(image, `POSTGRES_TEST_IMAGE is not postgres:<major>: ${POSTGRES_TEST_IMAGE}`).toBeDefined();
    expect(image).toBe(declared);
  });
});
