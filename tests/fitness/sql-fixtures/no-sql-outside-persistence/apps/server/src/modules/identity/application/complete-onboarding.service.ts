// Deliberately broken fixture for the `no-sql-outside-persistence` rule
// (tests/fitness/no-sql-outside-persistence.fitness.test.ts).
//
// This file mirrors the real path shape (application/, not persistence/) and
// commits exactly one violation: a raw SQL literal reaching into the database from
// the application layer, which is the thing M1b.9's second half exists to catch —
// see CLAUDE.md, "no-sql-outside-persistence is still owed".
//
// Do not "fix" this file. It is excluded from ESLint, tsc, and pnpm boundaries for
// the same reason `tests/fitness/__fixtures__/README.md` gives for the
// dependency-cruiser fixtures: a rule nobody has watched fail is a rule trusted on
// faith, and this is the failing case, kept alive.

export async function completeOnboardingLeakingSql(client: { query: (sql: string) => Promise<unknown> }, handle: string) {
  return client.query(`select id from app.users where handle = '${handle}'`);
}
