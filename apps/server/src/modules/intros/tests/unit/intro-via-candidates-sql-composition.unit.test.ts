import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * `app.intro_via_candidates` must compose `app.visible_people` on **both** sides of the
 * introduction and must never re-derive reachability by joining `app.connections` itself
 * (ADR-0002 §6, ADR-0004:75-77). Issue #89, AC16's unit half.
 *
 * `sql-table-ownership.fitness.test.ts` enforces this at the "does the SQL reference a
 * table it does not own or that isn't allowlisted" level and would already catch a direct
 * `app.connections` join — this suite states the composition requirement directly,
 * reading the checked-in text the same way that fitness rule does, so a reviewer sees a
 * test named for the rule itself. It is the sibling of
 * `modules/notes/tests/unit/visible-notes-sql-composition.unit.test.ts`.
 *
 * ⚠ The target side is why this file exists rather than being left to the fitness rule.
 * "Which people are directly connected to the target" reads like a question about
 * `app.connections`, and answering it there would be a second definition of reachability
 * inside the one module whose job is putting two strangers in touch — R2, the plan's only
 * Critical-severity risk. The two `app.visible_people` calls asserted below are what stop
 * it.
 *
 * No database needed: these are properties of the checked-in SQL text, not of the
 * installed catalog object (SECURITY INVOKER, search_path and grants are
 * `intro-requests-migration.integration.test.ts`'s job).
 */
describe('modules/intros/persistence/sql/intro-via-candidates.sql — composition (issue #89)', () => {
  const sqlPath = fileURLToPath(
    new URL('../../persistence/sql/intro-via-candidates.sql', import.meta.url),
  );

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

  it('calls app.visible_people(...) for the requester', () => {
    expect(statementText()).toMatch(/\bapp\.visible_people\s*\(\s*requester_id\b/i);
  });

  it('calls app.visible_people(...) for the target, rather than joining app.connections', () => {
    expect(statementText()).toMatch(/\bapp\.visible_people\s*\(\s*target_id\b/i);
  });

  it('never references app.connections directly — reachability is never re-derived here', () => {
    expect(statementText()).not.toMatch(/\bapp\.connections\b/i);
  });

  it('never joins app.users directly — a person card comes only from the projection', () => {
    // ADR-0002 §6a: "no direct join to app.users for an author card, ever". The one
    // sanctioned exception is app.visible_people itself, which this function composes.
    expect(statementText()).not.toMatch(/\bapp\.users\b/i);
  });

  it('gates the target at exactly degree 2 — an intro travels one hop, no more and no less', () => {
    // Degree 1 needs no introduction and degree 3 would be a chain nobody in it agreed
    // to. `>= 2` or `<= 2` are each one character from correct and neither is.
    expect(statementText()).toMatch(/degree\s*=\s*2/i);
  });

  it('gates the candidate at degree 1 on the requester side', () => {
    expect(statementText()).toMatch(/w\.degree\s*=\s*1/i);
  });

  it('inner-joins the two sides — a candidate must be in both sets, never in either', () => {
    // A LEFT join here would return every first-degree connection of the requester with
    // nulls where the target side found nothing, and the `where` would then be the only
    // thing standing between a caller and "here is my whole address book". The notes
    // function LEFT-joins deliberately for the opposite reason (a delivered note outlives
    // its author); this one must not, and the keyword is pinned rather than left to a
    // reviewer to notice.
    expect(statementText()).toMatch(/\bjoin\s+target_direct\b/i);
    expect(statementText()).not.toMatch(/left\s+join\s+target_direct/i);
  });

  it('is declared SECURITY INVOKER with an empty search_path in the checked-in source', () => {
    // Asserted on the text as well as on the catalog: the catalog test proves what got
    // installed, this one proves the file a future migration will copy still says it.
    expect(statementText()).toMatch(/security\s+invoker/i);
    expect(statementText()).toMatch(/set\s+search_path\s*=\s*''/i);
  });

  it('builds no tsvector — an intro note must never become a people search', () => {
    // There is no query grammar over intro requests, and there must be no index that
    // could grow one: matching on why somebody wants to meet you would make the most
    // pointed text in the product a way to find the people in it.
    expect(statementText()).not.toMatch(/to_tsvector/i);
  });
});
