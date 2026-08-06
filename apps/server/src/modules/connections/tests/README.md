# `modules/connections` tests

Beside the code they test, not in a top-level `tests/` tree: a module's suites move,
split, and get deleted with the module.

**The filename is the price** (`CLAUDE.md`, "Conventions"). `*.unit.test.ts` runs in
the `unit` vitest project and touches no infrastructure; `*.integration.test.ts` runs
in `integration` against a Testcontainers Postgres with `supabase/migrations` applied.
Nothing here needs `pnpm db:start`.

| Directory | Suite | Feature-file scenarios |
|---|---|---|
| `domain/` | `invitations.unit.test.ts` | the three `@unit` invite-token scenarios (M2-AC17) |
| `integration/` | `invitations.integration.test.ts` | the three `@integration` invitations.feature scenarios (M2-AC17) |
| `integration/` | `connections.integration.test.ts` | connections.feature — one `@e2e` (API-level) + four `@integration` (M2-AC1/AC18/AC19) |
| `integration/` | `directional-trust.integration.test.ts` | directional-trust.feature — one `@e2e` (API-level) + six `@integration` (M2-AC1/AC3/AC4/AC18/AC19) |
| `integration/` | `connections-schema-migration.integration.test.ts` | the L2 migration's catalog shape — `app.invitations`, `app.connections`, `app.connection_trust`, `app.outbox_events`, `app.consumer_receipts` |

`tests/fitness/invite-token-csprng.fitness.test.ts` carries M2-AC17's fitness-rule
half (a non-CSPRNG source in `domain/invite-token.ts` fails the build) — architecture,
not domain behavior, so it lives in the fitness suite alongside
`no-sql-outside-persistence` rather than here.
