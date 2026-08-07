import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * m2-lane-briefs.md §L3a: `app.visible_bulletins` "MUST compose `app.visible_people`
 * as a subquery. It must never re-derive reachability by joining `app.connections`
 * itself." ADR-0004:75-77 is explicit that bulletin visibility uses *the same*
 * authorized-people CTE.
 *
 * `sql-table-ownership.fitness.test.ts` enforces this at the "does the SQL reference
 * a table it does not own or that isn't allowlisted" level, and would already catch
 * a direct `app.connections` join — this suite states the composition requirement
 * directly, reading the checked-in text the same way that fitness rule does, so a
 * reviewer sees a test named for the rule itself rather than inferring it from the
 * ownership walker's fixtures.
 *
 * No database needed: this is a property of the checked-in SQL text, not the
 * installed catalog object (the catalog-level properties — SECURITY INVOKER,
 * search_path, grants — are `visible-bulletins-migration.integration.test.ts`'s job).
 */
describe('modules/bulletins/persistence/sql/visible-bulletins.sql — composition (ADR-0004:75-77)', () => {
  const sqlPath = fileURLToPath(new URL('../../persistence/sql/visible-bulletins.sql', import.meta.url));

  it('calls app.visible_people(...) as a subquery', () => {
    const text = readFileSync(sqlPath, 'utf8');
    expect(text).toMatch(/\bapp\.visible_people\s*\(/i);
  });

  it('never references app.connections directly — reachability is never re-derived here', () => {
    const text = readFileSync(sqlPath, 'utf8');
    // Strip `--` line comments first: a comment explaining the rule (as this file's
    // own docstring does, and as visible-people.sql's comments do) must not itself
    // trip the assertion.
    const withoutComments = text
      .split('\n')
      .map((line) => {
        const commentStart = line.indexOf('--');
        return commentStart === -1 ? line : line.slice(0, commentStart);
      })
      .join('\n');

    expect(withoutComments).not.toMatch(/\bapp\.connections\b/i);
  });

  /**
   * The expiry-filter *layer* decision, asserted where it was made.
   *
   * Expiry could have been a predicate in the board's compiled filter
   * (`persistence/board-filter.ts`) instead. It is here because four other reads
   * compose this function and none of them go through that filter — `getById`,
   * `modules/notifications`' read-time visibility re-check,
   * `FindVisibleBulletinAuthor`'s moderation actorship check, and
   * `sync.submitMutations`' pre-dispatch check. Put the predicate in the filter and
   * those four keep serving expired bulletins while the board hides them: four
   * surfaces disagreeing about what is live, which is exactly the second-visibility-
   * predicate failure ADR-0002 §6 exists to forbid.
   *
   * Behaviour is proven against a real database in
   * `bulletin-location-and-expiry.integration.test.ts`; this asserts *where* it lives,
   * which no behavioural test can see.
   */
  it('filters an elapsed expires_at here, so every composing read inherits it', () => {
    const text = readFileSync(sqlPath, 'utf8');

    expect(text).toMatch(/expires_at\s+is\s+null\s+or\s+.*expires_at\s*>\s*pg_catalog\.now\(\)/i);
  });

  it('never puts loc in the free-text haystack — a location must not become a people search', () => {
    // `search_document` is generated from title and body in the migration. This asserts
    // the projection never widens the haystack by other means: bare text matching a
    // location would answer "who is camped at 7:30 & E", which is the people search the
    // PDF forbids and ADR-0007 deviation 1 already keeps author names out for.
    const text = readFileSync(sqlPath, 'utf8');
    const withoutComments = text
      .split('\n')
      .map((line) => {
        const commentStart = line.indexOf('--');
        return commentStart === -1 ? line : line.slice(0, commentStart);
      })
      .join('\n');

    expect(withoutComments).not.toMatch(/to_tsvector[^\n]*\bloc\b/i);
  });
});
