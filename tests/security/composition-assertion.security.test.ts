import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { findSqlLiteralsOutsidePersistence } from '../fitness/find-sql-outside-persistence';
import { findSqlTableOwnershipViolations } from '../fitness/find-sql-table-ownership-violations';

import { REPOSITORY_ROOT } from './b-rows';

/**
 * **B12** — the composition assertion, plus the SQL-location secondary rule
 * (ADR-0002 §6 / M2-AC15).
 *
 * Two halves, and this file is where the row's `provenBy` points because the manifest
 * calls itself *"the source of truth for `pnpm test:security`"*: a control whose proof
 * runs in a different job is a control a green `test:security` does not actually cover.
 *
 * It **invokes the existing walkers** rather than restating them. Duplicating the
 * AST walk here would create a second definition of the rule, and the second one is
 * the one that drifts — the failure this whole suite exists to catch, one level up.
 *
 * Each half is asserted twice: clean against the live tree, and **tripping against its
 * own deliberately-violating fixture**. M2-AC15 asks for exactly that second half —
 * *"a fixture query taking a `ViewerId` without composing the authorized set fails the
 * build"* — because a walker configured against nothing reports green forever.
 */
const allowlist: Readonly<Record<string, readonly string[]>> = {
  // Mirrors `tests/fitness/sql-table-ownership-allowlist.json`'s one grant. Restated
  // rather than re-read so this control cannot be widened by editing a JSON file that
  // no reviewer of this file would see change.
  graph: ['connections', 'connection_trust', 'users'],
};

/**
 * Each module's own tables. Neither `bulletins` nor `notes` appears in {@link allowlist}
 * and neither may: they own one table each and compose `app.visible_people` for
 * everything else, which is already exempt as a sanctioned `app.visible_*` call.
 */
const bulletinsOwnTables: Readonly<Record<string, readonly string[]>> = {
  bulletins: ['bulletins'],
  notes: ['notes'],
};

const sqlFixtures = join(REPOSITORY_ROOT, 'tests', 'fitness', 'sql-fixtures');
const ownershipFixtures = join(REPOSITORY_ROOT, 'tests', 'fitness', 'sql-table-ownership-fixtures');

describe('B12 — composition assertion and the SQL-location secondary rule (ADR-0002 §6, M2-AC15)', () => {
  describe('no SQL outside persistence/', () => {
    it('finds none in the live server tree or in any workspace package', () => {
      const violations = findSqlLiteralsOutsidePersistence([
        join(REPOSITORY_ROOT, 'apps', 'server', 'src'),
        join(REPOSITORY_ROOT, 'packages'),
      ]);

      expect(violations).toEqual([]);
    });

    it('still trips on the fixture that puts a query in an application service', () => {
      const violations = findSqlLiteralsOutsidePersistence([
        join(sqlFixtures, 'no-sql-outside-persistence'),
      ]);

      expect(violations).not.toHaveLength(0);
      expect(violations.some((violation) => violation.file.endsWith('.ts'))).toBe(true);
    });

    it('leaves the same query alone inside persistence/', () => {
      const violations = findSqlLiteralsOutsidePersistence([
        join(sqlFixtures, 'allowed-sql-inside-persistence'),
      ]);

      expect(violations).toEqual([]);
    });
  });

  describe('every authorized read composes the authorized set rather than re-deriving it', () => {
    it('holds the live graph, bulletins and notes SQL to the tables each was granted', () => {
      // ⚠ Every module that checks a `.sql` file in owes a directory here. A control
      // that has stopped seeing a module is worse than one that is openly incomplete —
      // `modules/notes` (issue #88) is the newest, and it is the module where the
      // temptation is sharpest, because "is this recipient a connection" reads like a
      // question for `app.connections`.
      const violations = findSqlTableOwnershipViolations(
        [
          join(REPOSITORY_ROOT, 'apps', 'server', 'src', 'modules', 'graph', 'persistence', 'sql'),
          join(
            REPOSITORY_ROOT,
            'apps',
            'server',
            'src',
            'modules',
            'bulletins',
            'persistence',
            'sql',
          ),
          join(REPOSITORY_ROOT, 'apps', 'server', 'src', 'modules', 'notes', 'persistence', 'sql'),
        ],
        { allowlist, ownTables: bulletinsOwnTables },
      );

      expect(violations).toEqual([]);
    });

    it('still trips on a query that joins another module’s table instead of the projection', () => {
      const violations = findSqlTableOwnershipViolations(
        [join(ownershipFixtures, 'violating', 'modules', 'bulletins')],
        { allowlist, ownTables: bulletinsOwnTables },
      );

      expect(violations).not.toHaveLength(0);
      expect(
        violations.some((violation) => violation.reference === 'app.connections'),
      ).toBe(true);
    });

    it('leaves the composing counterpart alone', () => {
      const violations = findSqlTableOwnershipViolations(
        [join(ownershipFixtures, 'allowed', 'modules', 'bulletins')],
        { allowlist, ownTables: bulletinsOwnTables },
      );

      expect(violations).toEqual([]);
    });
  });
});
