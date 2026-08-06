# `modules/moderation` tests

Beside the code they test, not in a top-level `tests/` tree: a module's suites move,
split, and get deleted with the module.

**The filename is the price** (`CLAUDE.md`, "Conventions"). `*.integration.test.ts`
runs in the `integration` vitest project against a Testcontainers Postgres with
`supabase/migrations` applied. Nothing here needs `pnpm db:start`.

| Directory | Suite | Feature-file scenarios |
|---|---|---|
| `integration/` | `moderation-report-dismiss.integration.test.ts` | `moderation-report-dismiss.feature` — 2 `@e2e` (API-level) + 5 `@integration` (M2-AC1/AC10/AC11/AC14/AC18/AC19) |

M5 cuts: strike counts, reason taxonomy, an operator console, hide-author, blocking,
and report withdrawal. None of that is tested here on purpose.
