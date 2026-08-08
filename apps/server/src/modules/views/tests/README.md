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
| `integration/` | `notify-me-queries-schema-migration.integration.test.ts` | `app.notify_me_queries`' catalog shape — RLS, ownership, grants, and the primary key on `owner_id` that makes D1 a constraint (ADR-0007:77-79) |
| `unit/` | `saved-view-name.unit.test.ts` | The name policy's bounds, and that a refusal names the bound rather than echoing what was typed |
| `integration/` | `notify-me-query.integration.test.ts` | `notify-me.feature` › "notifyMe.update fails closed for an actor unrelated to the query" (M2-AC19) |
| `integration/` | `saved-view.integration.test.ts` | Saved-views CRUD (issue #45), the viewer-scoping M5-AC16 asks for, and decision D1 surviving a per-view bell — one `app.notify_me_queries` row however many bells are tapped (ADR-0016) |

The Notify Me *push* half is `modules/notifications`' — this module owns the query, its
table, and `views.notifyMe.update`; that one owns matching, grouping, and delivery. Its
suites are in `modules/notifications/tests/`.

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
