# `modules/sync` tests

Beside the code they test, not in a top-level `tests/` tree: a module's suites move,
split, and get deleted with the module.

**The filename is the price** (`CLAUDE.md`, "Conventions"). `*.integration.test.ts`
runs in the `integration` vitest project against a Testcontainers Postgres with
`supabase/migrations` applied; `*.unit.test.ts` runs in `unit` with no infrastructure
at all.

| Directory | Suite | Feature-file scenarios |
|---|---|---|
| `integration/` | `offline-replay.integration.test.ts` | `offline-replay.feature` — 1 `@e2e` (API-level) + 2 `@integration` (M2-AC9/AC19) |
| `unit/` | `submit-mutations-batch-limit.unit.test.ts` | Not a feature-file scenario — pins the ADR-0005 "Transport" max-50-envelope bound the L4 dispatch brief calls out |

M2 wires exactly one **replayable** handler, `bulletin.create` (lane brief
`m2-lane-briefs.md` §L4). The other six mutation types in ADR-0005's v1 conflict
matrix have no M2 handler; a submission naming one gets `rejected` /
`UNSUPPORTED_MUTATION_TYPE` — but only *after* the type-agnostic, pre-dispatch
actorship gate has run (ADR-0005:68-82, B-2 in `m2-lane-briefs.md`'s revision log).
That ordering is what `offline-replay.integration.test.ts`'s third scenario proves.
