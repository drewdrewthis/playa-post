# `modules/audit` tests

Beside the code they test, not in a top-level `tests/` tree: a module's suites move,
split, and get deleted with the module.

**The filename is the price** (`CLAUDE.md`, "Conventions"). `*.unit.test.ts` runs in
the `unit` vitest project and touches no infrastructure; `*.integration.test.ts` runs
in `integration` against a Testcontainers Postgres with `supabase/migrations` applied.
Nothing here needs `pnpm db:start`.

| Directory | Suite | Covers |
|---|---|---|
| `domain/` | `record-audit-entry.unit.test.ts` | the pure envelope-to-entry mapping, including the negative "payload is never copied" assertion (ADR-0002 Q4) |
| `integration/` | `record-audit-entry-handler.integration.test.ts` | the transactional write into `app.audit_entries` + `app.consumer_receipts`, and the same negative assertion at the database (ADR-0006 consumer idempotency) |
| `integration/` | `audit-entries-migration.integration.test.ts` | the `app.audit_entries` migration's catalog shape (plan M2.15) |

`notify-me.feature`'s two `@integration` scenarios this lane owns — M2-AC23 "a
throwing consumer is retried with growing backoff and eventually dead-lettered" and
M2-AC24 "two concurrent drainers claim disjoint events" — are pure outbox-drainer
assertions with no audit-specific behavior. They live at
`apps/server/src/entrypoints/outbox-drainer/outbox-drainer.integration.test.ts`,
beside the entrypoint they test, not here — audit is one of the entrypoint's
consumers, not the thing under test in those two scenarios.
