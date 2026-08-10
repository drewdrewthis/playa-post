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
// ⚠ Scoped to each module's own fixture subdirectory, not the shared 'allowed'/
// 'violating' root: `collectSqlFiles` walks recursively, so scanning the whole root
// would sweep another module's fixture files into a module-specific assertion
// (e.g. modules/bulletins' own `app.bulletins` reference, unpermitted without its
// `ownTables` entry, would read as a false violation in modules/graph's "allowed
// counterpart" check, which passes no `ownTables` at all).
const violatingGraphFixture = join(fixturesRoot, 'violating', 'modules', 'graph');
const allowedGraphFixture = join(fixturesRoot, 'allowed', 'modules', 'graph');
const violatingBulletinsFixture = join(fixturesRoot, 'violating', 'modules', 'bulletins');
const allowedBulletinsFixture = join(fixturesRoot, 'allowed', 'modules', 'bulletins');
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
const bulletinsSqlDirectory = join(
  repositoryRoot,
  'apps',
  'server',
  'src',
  'modules',
  'bulletins',
  'persistence',
  'sql',
);
const notesSqlDirectory = join(
  repositoryRoot,
  'apps',
  'server',
  'src',
  'modules',
  'notes',
  'persistence',
  'sql',
);
const introsSqlDirectory = join(
  repositoryRoot,
  'apps',
  'server',
  'src',
  'modules',
  'intros',
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
      const violations = findSqlTableOwnershipViolations([violatingGraphFixture], {
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
      const violations = findSqlTableOwnershipViolations([allowedGraphFixture], {
        allowlist: loadAllowlist(),
      });

      expect(violations).toEqual([]);
    });
  });

  describe('against modules/graph/persistence/sql/ in the real tree', () => {
    it('holds visible-people.sql and visible-edges.sql to the tables they were granted, and no others', () => {
      // Load-bearing. `modules/graph/persistence/sql/` holds two checked-in files with
      // real `app.<table>` references — `visible-people.sql` (the authorized-people
      // CTE) and `visible-edges.sql` (which pairs of them may be joined by a line) —
      // so this walks real production SQL rather than a fixture.
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

  /**
   * m2-lane-briefs.md §L3a: "modules/bulletins' SQL may reference app.bulletins and
   * the sanctioned app.visible_* functions, and nothing else" — `app.visible_bulletins`
   * MUST compose `app.visible_people` as a subquery/join and must never re-derive
   * reachability by joining `app.connections` itself (ADR-0004:75-77).
   *
   * Unlike `modules/graph`, `modules/bulletins` needs no cross-module allowlist entry:
   * it owns `app.bulletins` outright (passed via `ownTables`, not the allowlist), and
   * every other reference it needs — `app.visible_people(...)` — is already exempt as
   * a sanctioned function call. `sql-table-ownership-allowlist.json` must therefore
   * carry **no** `"bulletins"` entry naming `app.connections` or `app.users`: the
   * assertion below guards against that drifting in later as a shortcut around a
   * broken composition.
   */
  describe('bulletins module ownership scope (m2-lane-briefs.md §L3a)', () => {
    const bulletinsOwnTables = { bulletins: ['bulletins'] };

    it('does not allowlist modules/bulletins to reach app.connections or app.users directly', () => {
      const allowlist = loadAllowlist();
      const bulletinsAllowance = allowlist['bulletins'] ?? [];
      expect(bulletinsAllowance).not.toContain('connections');
      expect(bulletinsAllowance).not.toContain('users');
    });

    describe('against the deliberately-violating fixture', () => {
      it('flags the app.connections reference modules/bulletins does not own and is not allowlisted', () => {
        const violations = findSqlTableOwnershipViolations([violatingBulletinsFixture], {
          allowlist: loadAllowlist(),
          ownTables: bulletinsOwnTables,
        });

        expect(violations).not.toHaveLength(0);
        expect(
          violations.some(
            (violation) =>
              violation.file.includes('bad-visible-bulletins.sql') &&
              violation.reference === 'app.connections',
          ),
        ).toBe(true);
      });
    });

    describe('against the allowed counterpart, same shape, own table + sanctioned function call only', () => {
      it('reports no violation', () => {
        const violations = findSqlTableOwnershipViolations([allowedBulletinsFixture], {
          allowlist: loadAllowlist(),
          ownTables: bulletinsOwnTables,
        });

        expect(violations).toEqual([]);
      });
    });

    describe('against modules/bulletins/persistence/sql/ in the real tree', () => {
      it('reports no violation once visible-bulletins.sql exists and stays within app.bulletins + app.visible_*', () => {
        // Load-bearing, not vacuous: `visible-bulletins.sql` has shipped, so this walks
        // real production SQL — mirrors the graph describe block's identical "against the
        // real tree" test.
        const violations = findSqlTableOwnershipViolations([bulletinsSqlDirectory], {
          allowlist: loadAllowlist(),
          ownTables: bulletinsOwnTables,
        });

        expect(violations).toEqual([]);
      });
    });
  });

  /**
   * Issue #88, decision D6. `modules/notes` is in exactly `modules/bulletins`' position:
   * it owns `app.notes` outright (passed via `ownTables`, not the allowlist) and
   * everything else it needs — `app.visible_people(...)` — is already exempt as a
   * sanctioned function call, so it needs no allowlist entry either.
   *
   * The failure this guards is the tempting one. "Is this recipient a direct connection"
   * reads like a question about `app.connections`, and answering it there would be a
   * second definition of reachability living in the one module whose whole job is a
   * private channel — R2, the plan's only Critical-severity risk. The pin statement
   * composes `app.visible_people` instead (`postgres-note.repository.ts`), and no `.sql`
   * file here may name a table that would let a future edit do otherwise.
   *
   * ⚠ This cannot see the pin statement itself, which is a Kysely `sql` literal rather
   * than a `.sql` file — no rule in this build can. What it does is keep the checked-in
   * escape hatch shut: a note query cannot quietly grow the join.
   *
   * No violating/allowed fixture pair of its own: the walker is one function, and the
   * graph and bulletins fixtures already prove it still bites. What is specific to this
   * module is the allowlist assertion and the real-tree walk below.
   */
  describe('notes module ownership scope (issue #88)', () => {
    const notesOwnTables = { notes: ['notes'] };

    it('does not allowlist modules/notes to reach app.connections or app.users directly', () => {
      const allowlist = loadAllowlist();
      const notesAllowance = allowlist['notes'] ?? [];
      expect(notesAllowance).not.toContain('connections');
      expect(notesAllowance).not.toContain('users');
    });

    describe('against modules/notes/persistence/sql/ in the real tree', () => {
      it('holds visible-notes.sql to app.notes + app.visible_*, and no other table', () => {
        const violations = findSqlTableOwnershipViolations([notesSqlDirectory], {
          allowlist: loadAllowlist(),
          ownTables: notesOwnTables,
        });

        expect(violations).toEqual([]);
      });
    });
  });

  /**
   * Issue #89. `modules/intros` is in exactly `modules/notes`' position: it owns
   * `app.intro_requests` outright (passed via `ownTables`, not the allowlist) and
   * everything else it needs — `app.visible_people(...)` — is already exempt as a
   * sanctioned function call, so it needs no allowlist entry either.
   *
   * The failure this guards is the *most* tempting one in the repository so far.
   * Eligibility is "is this via connected to the requester **and** to the target", and
   * the target half reads exactly like a question about `app.connections` — one join, two
   * lines, obviously correct. It would also be a second definition of reachability living
   * in the one module whose whole job is putting two strangers in touch: R2, the plan's
   * only Critical-severity risk. `intro-via-candidates.sql` composes
   * `app.visible_people(target_id)` at degree 1 instead, which is the same set for an
   * active person and inherits the person lifecycle for free (ADR-0002 B11).
   *
   * ⚠ This cannot see the two gated write statements, which are Kysely `sql` literals
   * rather than `.sql` files — no rule in this build can. What it does is keep the
   * checked-in escape hatch shut.
   */
  describe('intros module ownership scope (issue #89)', () => {
    // ⚠ Two names, and the second is not a table. The walker exempts an `app.<name>(`
    // call only when the name starts `visible_`, so this module's own function — declared
    // in the very file being scanned — reads as an unowned reference under any other
    // name. It is passed through `ownTables` rather than the allowlist deliberately:
    // `sql-table-ownership-allowlist.json` records *cross-module* grants a reviewer has
    // to approve, and `app.intro_via_candidates` is this module's own object, no more a
    // grant than `app.intro_requests` is.
    const introsOwnTables = { intros: ['intro_requests', 'intro_via_candidates'] };

    it('does not allowlist modules/intros to reach app.connections or app.users directly', () => {
      const allowlist = loadAllowlist();
      const introsAllowance = allowlist['intros'] ?? [];
      expect(introsAllowance).not.toContain('connections');
      expect(introsAllowance).not.toContain('users');
    });

    describe('against modules/intros/persistence/sql/ in the real tree', () => {
      it('holds intro-via-candidates.sql to app.intro_requests + app.visible_*, and no other table', () => {
        const violations = findSqlTableOwnershipViolations([introsSqlDirectory], {
          allowlist: loadAllowlist(),
          ownTables: introsOwnTables,
        });

        expect(violations).toEqual([]);
      });
    });
  });
});
