# `modules/views` tests

Beside the code they test, not in a top-level `tests/` tree: a module's suites move,
split, and get deleted with the module.

**The filename is the price** (`CLAUDE.md`, "Conventions"). `*.unit.test.ts` runs in
the `unit` vitest project — no database, no container, fast enough to run on save;
`*.integration.test.ts` runs in `integration` against a Testcontainers Postgres with
`supabase/migrations` applied. The grammar needs no infrastructure to prove — it is a
total function from text to a validated AST — and the saved Notify Me query needs
nothing but, because "an unrelated actor changes zero rows and writes zero outbox
events" is a claim about SQL.

| Directory | Suite | Feature-file scenarios |
|---|---|---|
| `unit/` | `board-query-grammar.unit.test.ts` | `board-visibility-query.feature`'s four `@unit` scenarios — ADR-0007's rejection rule and both sides of the 256-character and 16-term boundaries (M2-AC13) |
| `integration/` | `notify-me-queries-schema-migration.integration.test.ts` | `app.notify_me_queries`' catalog shape — RLS, ownership, grants, and the key that carries decision D16: `id` as the primary key with `UNIQUE NULLS NOT DISTINCT (owner_id, source_view_id)` beside it, replacing the `owner_id` key that was D1 (#172, ADR-0007:77-79). Plus `notify-me.feature` › "An existing single-notify user keeps their notification through the migration" (#172 AC3) |
| `unit/` | `saved-view-name.unit.test.ts` | The name policy's bounds, and that a refusal names the bound rather than echoing what was typed |
| `integration/` | `notify-me-query.integration.test.ts` | `notify-me.feature` › "notifyMe.update fails closed for an actor unrelated to the query" (M2-AC19) |
| `integration/` | `saved-view.integration.test.ts` | Saved-views CRUD (issue #45), the viewer-scoping M5-AC16 asks for, and decision D16 — `notify-me.feature`'s "A second saved view can be notified on without switching the first off", "Switching one saved view's notifications off leaves the others on", and "Switching on more notifications than the per-person cap is refused" (#172 AC1/AC2/AC4, ADR-0016) |

The Notify Me *push* half is `modules/notifications`' — this module owns the queries, their
table, and `views.notifyMe.update`; that one owns matching, grouping, and delivery. Its
suites are in `modules/notifications/tests/`. D16's corollary lives on that side of the
seam and not here: "a person is matched once per bulletin however many of their queries
match" is a decision about notifications, so it is proved by
`modules/notifications/tests/unit/evaluate-notify-me-multiple-queries.unit.test.ts`.

The compiler half lives with its SQL, in
`modules/bulletins/persistence/board-filter.ts`: `domain/` may not emit SQL, and the
authorized set the filter narrows is bulletins'. `tests/security/board-query-narrowing.security.test.ts`
carries the B10 proof over that seam — kept in `tests/security/` rather than here
because a B-row must be provable from that tree alone.

`notify-me-query.integration.test.ts`'s unrelated-actor scenario is duplicated into
`tests/security/write-path-idor-bulletins.security.test.ts`'s `notifyMe.update`
`describe` block, extending that file's B13 proof beyond the `bulletin.*` coverage
L3a shipped it with — same discipline, same reason: a B-row must be provable from
`tests/security/` alone. `saved-view.integration.test.ts`'s unrelated-actor scenario is
duplicated the same way into that file's `view.save` block, which closes the row the
manifest had recorded as owed.
