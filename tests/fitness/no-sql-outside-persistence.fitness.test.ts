import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { findSqlLiteralsOutsidePersistence } from './find-sql-outside-persistence';

/**
 * Fitness function for **`no-sql-outside-persistence`**, M1b.9's second half —
 * "still owed" per CLAUDE.md's boundary-rules table:
 *
 * > `no-sql-outside-persistence` is still owed — the second half of M1b.9, landing
 * > in the M2 PR that introduces the first repository. It is not configured yet
 * > because a rule with nothing to check reports green forever, which is worse than
 * > no rule at all; it is also a rule about SQL *literals* rather than an import
 * > edge, so dependency-cruiser is the wrong tool and it needs a named
 * > AST/`sql`-tag-aware detection rule of its own.
 *
 * Lane L1 is that PR: `modules/identity/persistence/postgres-user.repository.ts` is
 * the first repository. `dependency-cruiser` polices import edges, not string/tagged-
 * template contents, so this rule is a small hand-rolled walker
 * (`find-sql-outside-persistence.ts`) rather than another `.dependency-cruiser.cjs`
 * entry — the same reasoning `find-viewer-identifier-inputs.ts` used for B14/M2-AC20.
 *
 * Fixtures live under `tests/fitness/sql-fixtures/`, a sibling of
 * `tests/fitness/__fixtures__/` rather than a child of it: `__fixtures__/` is
 * dependency-cruiser's own fixture root, and `boundaries.fitness.test.ts` asserts
 * that every one of its immediate child directories is named after a
 * `.dependency-cruiser.cjs` rule — adding a non-dependency-cruiser fixture there
 * would fail that assertion for an unrelated rule.
 *
 * ⚠ `tests/fitness/sql-fixtures/**` needs the same tsc/eslint exclusion
 * `tests/fitness/__fixtures__/**` already has (`tsconfig.json`'s `exclude`,
 * `eslint.config.js`'s ignore list) — deliberately broken fixtures must never be
 * "fixed" by a linter. Wiring that exclusion is part of implementing this rule, not
 * a pre-existing given.
 */

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const violatingFixture = join(
  repositoryRoot,
  'tests',
  'fitness',
  'sql-fixtures',
  'no-sql-outside-persistence',
);
const allowedFixture = join(
  repositoryRoot,
  'tests',
  'fitness',
  'sql-fixtures',
  'allowed-sql-inside-persistence',
);

describe('no-sql-outside-persistence (M1b.9 second half)', () => {
  describe('against the deliberately-violating fixture', () => {
    it('flags the SQL literal in application/complete-onboarding.service.ts', () => {
      const violations = findSqlLiteralsOutsidePersistence([violatingFixture]);

      expect(violations).not.toHaveLength(0);
      expect(
        violations.some((violation) => violation.file.includes('complete-onboarding.service.ts')),
      ).toBe(true);
    });
  });

  describe('against the allowed counterpart, same SQL literal, inside persistence/', () => {
    it('reports no violation — the rule is scoped to a directory, not to any SQL literal anywhere', () => {
      const violations = findSqlLiteralsOutsidePersistence([allowedFixture]);

      expect(violations).toEqual([]);
    });
  });

  describe('against the real tree', () => {
    it('finds no SQL literal outside a persistence/ directory anywhere in the live tree', () => {
      // Load-bearing: `identity`, `connections`, `graph`, and `bulletins` all carry
      // a `persistence/` directory now, so any `client.query` or `sql` fragment
      // that leaks into an application- or transport-layer file fails here. The
      // fixture assertions above keep the walker itself honest — same discipline
      // as `boundaries.fitness.test.ts`'s `totalCruised > 0` guard.
      const violations = findSqlLiteralsOutsidePersistence([
        join(repositoryRoot, 'apps', 'server', 'src'),
        join(repositoryRoot, 'packages'),
      ]);

      expect(violations).toEqual([]);
    });
  });
});
