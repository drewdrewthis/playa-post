// The permitted counterpart to
// tests/fitness/sql-fixtures/no-sql-outside-persistence/ — the same SQL literal,
// located under persistence/, where the rule must NOT flag it. Without this fixture,
// a rule that flagged every SQL literal anywhere (including inside persistence/)
// would still pass the "catches the violation" assertion while being useless: it
// would also fail every legitimate repository. This is the negative-space proof.

export async function findUserByHandle(client: { query: (sql: string) => Promise<unknown> }, handle: string) {
  return client.query(`select id from app.users where handle = '${handle}'`);
}
