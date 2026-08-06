/**
 * Deliberately-violating fixture for `invite-token-csprng.fitness.test.ts` —
 * mirrors `tests/fitness/sql-fixtures/no-sql-outside-persistence`'s role for its rule.
 *
 * Needs the same tsc/eslint exclusion `tests/fitness/__fixtures__/**` and
 * `tests/fitness/sql-fixtures/**` already have — a broken fixture must never be
 * "fixed" by a linter (see `find-sql-outside-persistence.ts`'s docstring for the
 * precedent). Wiring that exclusion is the coder's, alongside the walker.
 */
export function generateInviteTokenBadly(): string {
  // The violation: Math.random is not a CSPRNG. This is exactly what the fitness
  // rule must catch wherever it appears in the real invite-token module.
  return Math.random().toString(36).slice(2);
}
