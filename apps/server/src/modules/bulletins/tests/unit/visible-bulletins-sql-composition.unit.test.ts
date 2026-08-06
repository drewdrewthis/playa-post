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
});
