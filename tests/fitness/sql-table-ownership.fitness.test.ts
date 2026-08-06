import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { findSqlTableOwnershipViolations } from './find-sql-table-ownership-violations';

/**
 * Fitness function for **`sql-table-ownership`** (m2-lane-briefs.md:311, blocking
 * finding B-3) — new in this lane, "L1 (first checked-in `.sql`), extended per
 * lane". L1 (`modules/identity`) shipped no checked-in `.sql` file under
 * `persistence/sql/` (its repository is inline-query, per
 * `no-sql-outside-persistence`'s own scope), so `modules/graph/persistence/sql/
 * visible-people.sql` — M2.7 — is the *first* file this rule has anything to check,
 * and L2 ships it. Recorded as an AC ambiguity in this lane's
 * test-writing report: the lane brief assigns the rule's origin to "L1", but L1's
 * own scope (m2-lane-briefs.md §L1) never lists a `persistence/sql/` file, so this
 * suite treats "L1, extended per lane" as satisfied by shipping the rule here, where
 * the first real consumer exists.
 *
 * m2-lane-briefs.md:528-530: "the new `sql-table-ownership` rule green over
 * `modules/graph/persistence/sql/`" is part of L2's gate.
 */
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const fixturesRoot = join(repositoryRoot, 'tests', 'fitness', 'sql-table-ownership-fixtures');
const violatingFixture = join(fixturesRoot, 'violating');
const allowedFixture = join(fixturesRoot, 'allowed');
const graphSqlDirectory = join(
  repositoryRoot,
  'apps',
  'server',
  'src',
  'modules',
  'graph',
  'persistence',
  'sql',
);

interface AllowlistFile {
  readonly [moduleName: string]: readonly string[];
}

function loadAllowlist(): Readonly<Record<string, readonly string[]>> {
  const path = join(repositoryRoot, 'tests', 'fitness', 'sql-table-ownership-allowlist.json');
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as AllowlistFile & { $comment?: unknown };
  const { $comment: _comment, ...rest } = parsed;
  return rest;
}

describe('sql-table-ownership (m2-lane-briefs.md:311, blocking finding B-3)', () => {
  describe('against the deliberately-violating fixture', () => {
    it('flags the app.bulletins reference modules/graph does not own and is not allowlisted', () => {
      const violations = findSqlTableOwnershipViolations([violatingFixture], {
        allowlist: loadAllowlist(),
      });

      expect(violations).not.toHaveLength(0);
      expect(
        violations.some(
          (violation) =>
            violation.file.includes('bad-visible-people.sql') && violation.reference === 'app.bulletins',
        ),
      ).toBe(true);
    });
  });

  describe('against the allowed counterpart, same shape, allowlisted tables only', () => {
    it('reports no violation', () => {
      const violations = findSqlTableOwnershipViolations([allowedFixture], {
        allowlist: loadAllowlist(),
      });

      expect(violations).toEqual([]);
    });
  });

  describe('against modules/graph/persistence/sql/ in the real tree', () => {
    it('holds visible-people.sql to the tables it was granted, and no others', () => {
      // Load-bearing. `modules/graph/persistence/sql/visible-people.sql` ships in this
      // commit and is the only checked-in `.sql` file in the tree, so this walks a
      // real file with real `app.<table>` references — it is the rule's first and
      // currently only production subject.
      //
      // What it protects: `app.visible_people` is the single definition of "who can
      // this viewer reach" (ADR-0002 §6), and computing it legitimately requires three
      // tables two other modules own — `app.connections`, `app.connection_trust`,
      // `app.users`. Those are allowlisted by name in
      // `sql-table-ownership-allowlist.json` so the cross-module grant is a reviewed
      // decision rather than something inferred from what the file happens to
      // reference today.
      //
      // A fourth table joined here — say `app.bulletins`, "just to filter authors
      // while we are already in the CTE" — would re-derive reachability in a second
      // place, which is R2, the plan's only Critical-severity risk. Nothing else in
      // the build can see it: a `.sql` file has no import edge for
      // dependency-cruiser and no TypeScript literal for `no-sql-outside-persistence`
      // to parse. This assertion is the only thing standing there, which is why the
      // violating fixture above proves it still bites.
      const violations = findSqlTableOwnershipViolations([graphSqlDirectory], {
        allowlist: loadAllowlist(),
      });

      expect(violations).toEqual([]);
    });
  });
});
