# `modules/identity` tests

Beside the code they test, not in a top-level `tests/` tree: a module's suites move,
split, and get deleted with the module.

**The filename is the price** (`CLAUDE.md`, "Conventions"). `*.unit.test.ts` runs in
the `unit` vitest project and touches no infrastructure; `*.integration.test.ts` runs
in `integration` against a Testcontainers Postgres with `supabase/migrations` applied.
Nothing here needs `pnpm db:start`.

| Directory | Suite | Feature-file scenarios |
|---|---|---|
| `domain/` | `handle.policy.unit.test.ts` | the three `@unit` handle rules — reserved, charset, over-length |
| `integration/` | `handle-uniqueness.integration.test.ts` | case collision, confusable, `HANDLE_IMMUTABLE` |
| `integration/` | `actor-resolution.integration.test.ts` | the three `@integration` auth-boundary scenarios (M2-AC2) |
| `integration/` | `app-users-migration.integration.test.ts` | the `app.users` migration's catalog shape (ADR-0008:22-34) |

The split is not a preference. `citext` case-collision and confusable-normalization
are questions about *other rows*, so they cannot be answered without a database;
length, charset, and the reserved-word blocklist are questions about the submitted
string alone, which is what keeps `domain/handle.policy.ts` free of I/O.
