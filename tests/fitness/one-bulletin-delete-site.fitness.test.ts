import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * Fitness function for the precondition the bulletin cascade rests on (issue #169).
 *
 * `20260812150000_soft_delete_and_purge.sql` gives `app.bulletin_reports` and
 * `app.bulletin_dismissals` `ON DELETE CASCADE` — the first and only cascade in this
 * schema — and the argument for it is not "cascades are fine here". It is narrower and
 * entirely load-bearing:
 *
 * > Nothing but the purge deletes an `app.bulletins` row. `bulletin.archive` is an
 * > `UPDATE`, so the only statement these clauses can fire from is the retention sweep.
 *
 * That sentence is what makes a cascade safe rather than a silent data-loss vector. Add a
 * second delete site — a "remove permanently" affordance, an admin tool, a cleanup
 * helper — and it inherits the cascade without anybody deciding it should: a viewer's
 * private report disappears as a side effect of somebody else's action, and B9's whole
 * privacy property is that reports are never touched by anything the author can reach.
 * Nothing else in the tree would notice, because the cascade is invisible from the call
 * site.
 *
 * ⚠ **It was a grep a reviewer ran once.** This is that grep, run by CI, every time.
 *
 * A focused walker rather than a `.dependency-cruiser.cjs` rule for
 * `no-sql-outside-persistence`'s reason: this is a fact about statement *contents*, not
 * an import edge. It is deliberately not folded into that rule either — it is a rule
 * about one table, and the two would have to agree about scope forever.
 *
 * **Scope: `apps/server/src/**`, minus tests.** Runtime code is what the cascade fires
 * from; a suite deleting rows it seeded is not a delete site anybody's data flows
 * through, and `packages/testing` truncates every table by design. Migration SQL is out
 * of scope for the same reason it is out of `no-sql-outside-persistence`'s: it defines
 * the tables rather than deleting through them at runtime.
 */
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const serverSource = join(repositoryRoot, 'apps', 'server', 'src');

/**
 * The one file allowed to delete a bulletin, as a repository-relative path.
 *
 * Stated rather than derived: the point is that this set has exactly one member, and a
 * check that computed its own expectation could not fail.
 */
const PURGE_REPOSITORY =
  'apps/server/src/modules/bulletins/persistence/postgres-removed-bulletins.repository.ts';

/** Directories whose contents are test material rather than runtime code. */
const TEST_DIRECTORIES = new Set(['tests', '__tests__', '__fixtures__']);

/**
 * Both spellings a delete can take here.
 *
 * The Kysely builder is how every repository in this tree writes one; the raw form is
 * what a `sql` fragment inside a `persistence/` directory could legally contain, and
 * `no-sql-outside-persistence` would not object to it. Whitespace is loose between the
 * verb and the table because a formatter may wrap either.
 */
const BULLETIN_DELETE_PATTERNS: readonly RegExp[] = [
  /deleteFrom\(\s*['"`]app\.bulletins['"`]/,
  /\bdelete\s+from\s+app\.bulletins\b/i,
];

/** Comments stripped before matching, so prose quoting the rule is not the rule breaking. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

function runtimeSourceFiles(root: string): readonly string[] {
  const found: string[] = [];

  function walk(directory: string): void {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);

      if (entry.isDirectory()) {
        if (!TEST_DIRECTORIES.has(entry.name)) {
          walk(path);
        }
        continue;
      }

      if (entry.isFile() && entry.name.endsWith('.ts') && !entry.name.includes('.test.')) {
        found.push(path);
      }
    }
  }

  walk(root);
  return found;
}

function filesDeletingBulletins(): readonly string[] {
  return runtimeSourceFiles(serverSource)
    .filter((file) => {
      const source = stripComments(readFileSync(file, 'utf8'));
      return BULLETIN_DELETE_PATTERNS.some((pattern) => pattern.test(source));
    })
    .map((file) => relative(repositoryRoot, file).split(sep).join('/'))
    .sort();
}

describe("one bulletin delete site (issue #169, the cascade's precondition)", () => {
  it('is the retention purge, and nothing else in the server', () => {
    // Both halves of one assertion. That the purge is present is the non-vacuity check —
    // a rename or a refactor that lost the sweep would otherwise leave this passing with
    // an empty set, which is the shape a "nothing violates the rule" test fails in.
    expect(filesDeletingBulletins()).toEqual([PURGE_REPOSITORY]);
  });

  it('recognises a delete written in either spelling, so the check above can fail', () => {
    // Without this the patterns could be quietly wrong — matching nothing — and the
    // assertion above would still pass for a tree with a dozen delete sites in it.
    const kyselyDelete = `await database.deleteFrom('app.bulletins').execute();`;
    const rawDelete = `sql\`delete from app.bulletins where id = \${id}\``;

    expect(BULLETIN_DELETE_PATTERNS.some((pattern) => pattern.test(kyselyDelete))).toBe(true);
    expect(BULLETIN_DELETE_PATTERNS.some((pattern) => pattern.test(rawDelete))).toBe(true);
    // And a statement over a *different* table is not a bulletin delete — the cascade
    // fires from `app.bulletins` alone, and `moderation.undismiss` deleting one dismissal
    // by `(bulletin_id, viewer_id)` must stay legal.
    expect(
      BULLETIN_DELETE_PATTERNS.some((pattern) =>
        pattern.test(`deleteFrom('app.bulletin_dismissals')`),
      ),
    ).toBe(false);
  });
});
