import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * `app.visible_notes` must compose `app.visible_people` for its author card and must
 * never re-derive reachability by joining `app.connections` itself (ADR-0002 §6,
 * ADR-0004:75-77). Issue #88, decision D6.
 *
 * `sql-table-ownership.fitness.test.ts` enforces this at the "does the SQL reference a
 * table it does not own or that isn't allowlisted" level and would already catch a direct
 * `app.connections` join — this suite states the composition requirement directly,
 * reading the checked-in text the same way that fitness rule does, so a reviewer sees a
 * test named for the rule itself. It is the sibling of
 * `modules/bulletins/tests/unit/visible-bulletins-sql-composition.unit.test.ts`.
 *
 * No database needed: these are properties of the checked-in SQL text, not of the
 * installed catalog object (SECURITY INVOKER, search_path and grants are
 * `visible-notes-migration.integration.test.ts`'s job).
 */
describe('modules/notes/persistence/sql/visible-notes.sql — composition (issue #88)', () => {
  const sqlPath = fileURLToPath(new URL('../../persistence/sql/visible-notes.sql', import.meta.url));

  /** The file with `--` line comments stripped, so prose about a rule cannot satisfy it. */
  function statementText(): string {
    return readFileSync(sqlPath, 'utf8')
      .split('\n')
      .map((line) => {
        const commentStart = line.indexOf('--');
        return commentStart === -1 ? line : line.slice(0, commentStart);
      })
      .join('\n');
  }

  it('calls app.visible_people(...) as a subquery', () => {
    expect(statementText()).toMatch(/\bapp\.visible_people\s*\(/i);
  });

  it('never references app.connections directly — reachability is never re-derived here', () => {
    expect(statementText()).not.toMatch(/\bapp\.connections\b/i);
  });

  it('never joins app.users directly — an author card comes only from the projection', () => {
    // ADR-0002 §6a: "no direct join to app.users for an author card, ever". The one
    // sanctioned exception is app.visible_people itself, which this function composes.
    expect(statementText()).not.toMatch(/\bapp\.users\b/i);
  });

  it('gates on recipient_id = viewer_id — the whole authorization, stated once', () => {
    // A note has exactly one reader. If this predicate ever left the function, every
    // caller would have to remember to add it, and the first one to forget would publish
    // somebody's private notes to whoever asked.
    expect(statementText()).toMatch(/recipient_id\s*=\s*viewer_id/i);
  });

  it('builds no tsvector over the body — a note must never become a people search', () => {
    // There is no query grammar over notes, and there must be no index that could grow
    // one: bare text matching a note's contents would make the most private thing in the
    // product a way to find the people in it (the same rule ADR-0007 deviation 1 keeps
    // author names out of the board haystack for).
    expect(statementText()).not.toMatch(/to_tsvector/i);
  });
});
