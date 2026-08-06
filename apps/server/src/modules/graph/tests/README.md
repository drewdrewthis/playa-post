# `modules/graph` tests

Beside the code they test, not in a top-level `tests/` tree: a module's suites move,
split, and get deleted with the module.

**The filename is the price** (`CLAUDE.md`, "Conventions"). `*.integration.test.ts`
runs in the `integration` vitest project against a Testcontainers Postgres with
`supabase/migrations` applied. Nothing here needs `pnpm db:start`.

| Directory | Suite | Feature-file scenarios |
|---|---|---|
| `integration/` | `visible-people-migration.integration.test.ts` | `app.visible_people`'s catalog shape — `SECURITY INVOKER`, `SET search_path = ''`, argument signature, grants (ADR-0004:25-42, M2.7) |
| `integration/` | `graph-visibility.integration.test.ts` | graph-visibility.feature — one `@e2e` (API-level) + two `@integration` (M2-AC1/AC5) |

`tests/security/visibility-matrix.security.test.ts` and
`tests/security/directional-trust.security.test.ts` carry the B5 (graph half) and B6
security-suite proofs over the same application seam — kept in `tests/security/`
rather than here because a B-row must be provable from that tree alone
(`tests/security/baseline-catalog.security.test.ts`'s own discipline).
