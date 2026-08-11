# `modules/bulletins` tests

Beside the code they test, not in a top-level `tests/` tree: a module's suites move,
split, and get deleted with the module.

**The filename is the price** (`CLAUDE.md`, "Conventions"). `*.integration.test.ts`
runs in the `integration` vitest project against a Testcontainers Postgres with
`supabase/migrations` applied; `*.unit.test.ts` runs in `unit` with no infrastructure
at all. Nothing here needs `pnpm db:start`.

| Directory | Suite | Feature-file scenarios |
|---|---|---|
| `integration/` | `bulletins-schema-migration.integration.test.ts` | `app.bulletins`' catalog shape — RLS, ownership, grants, lifecycle timestamps, the ADR-0005 `version` column |
| `integration/` | `visible-bulletins-migration.integration.test.ts` | `app.visible_bulletins`' catalog shape — `SECURITY INVOKER`, `SET search_path = ''`, signature, grants (ADR-0004:75-77, M2.8/M2.9) |
| `integration/` | `bulletin-request-lifecycle.integration.test.ts` | `bulletin-request-lifecycle.feature` — one `@e2e` (API-level) + five `@integration` (M2-AC1/AC6/AC12/AC18/AC19) |
| `integration/` | `board-visibility-query.integration.test.ts` | `board-visibility-query.feature` — two `@e2e` (API-level) + two `@integration` (M2-AC1/AC5/AC14) |
| `integration/` | `bulletin-post-types.integration.test.ts` | `bulletin-post-types.feature` — one `@e2e` (API-level) + three `@integration` (#87: six-type round-trip, `type:` narrowing, `update` empty-not-error, update/note refusal) |
| `unit/` | `visible-bulletins-sql-composition.unit.test.ts` | the checked-in `persistence/sql/visible-bulletins.sql` composes `app.visible_people` and never joins `app.connections` |
| `unit/` | `list-dismissed-bulletins.unit.test.ts` | `moderation-report-dismiss.feature` (#170) — the Dismissed category's composition rule: dismissal order restored over an order-free authorized read, a dismissed bulletin the viewer may no longer see dropped, and the identifier read bounded by `BOARD_PAGE_SIZE` |

The grammar's four `@unit` scenarios live in `modules/views/tests/unit/` instead — the
grammar is views' (ADR-0007: one grammar, three consumers), and this module is only its
first caller.

`tests/security/board-query-narrowing.security.test.ts`,
`bulletin-indistinguishability.security.test.ts`, and
`write-path-idor-bulletins.security.test.ts` carry the B10, B17, and B13 (bulletin.
create / bulletin.archive, extended by L3b-notify with notifyMe.update) proofs over the
same application seam — kept in `tests/security/` rather than here because a B-row
must be provable from that tree alone
(`tests/security/baseline-catalog.security.test.ts`'s own discipline).
