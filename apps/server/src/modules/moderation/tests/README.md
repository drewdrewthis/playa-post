# `modules/moderation` tests

Beside the code they test, not in a top-level `tests/` tree: a module's suites move,
split, and get deleted with the module.

**The filename is the price** (`CLAUDE.md`, "Conventions"). `*.integration.test.ts`
runs in the `integration` vitest project against a Testcontainers Postgres with
`supabase/migrations` applied. Nothing here needs `pnpm db:start`.

| Directory | Suite | Feature-file scenarios |
|---|---|---|
| `integration/` | `moderation-report-dismiss.integration.test.ts` | `moderation-report-dismiss.feature` — 2 `@e2e` (API-level) + 5 `@integration` (M2-AC1/AC10/AC11/AC14/AC18/AC19) |
| `integration/` | `dismissed-category.integration.test.ts` | `moderation-report-dismiss.feature` — 10 `@integration` (#170): the Dismissed category (`bulletins.dismissed`) and `moderation.undismiss`. Wires both modules together, because the browsable half is a `bulletins` read over a `moderation` identifier list |

M5 cuts: strike counts, reason taxonomy, an operator console, hide-author, blocking,
and report withdrawal. None of that is tested here on purpose.

⚠ **Report withdrawal staying cut is what makes #170 safe to have shipped.** A
dismissal is reversible and browsable; a report is neither, and
`dismissed-category.integration.test.ts` asserts both halves of that — a report is
absent from the category, and un-dismissing does not withdraw one.
