# `modules/notes` tests

Beside the code they test, not in a top-level `tests/` tree: a module's suites move,
split, and get deleted with the module.

**The filename is the price** (`CLAUDE.md`, "Conventions"). `*.integration.test.ts` runs
in the `integration` vitest project against a Testcontainers Postgres with
`supabase/migrations` applied; `*.unit.test.ts` runs in `unit` with no infrastructure at
all. Nothing here needs `pnpm db:start`.

| Directory | Suite | Feature-file scenarios |
|---|---|---|
| `integration/` | `visible-notes-migration.integration.test.ts` | `app.notes`' and `app.visible_notes`' catalog shape — RLS backstop, grants, `SECURITY INVOKER`, `SET search_path = ''`, the verbatim-migration pairing, and the two structural facts (no tsvector, no self-addressed note) |
| `integration/` | `pin-a-note.integration.test.ts` | `pin-a-note.feature` — seven `@integration` scenarios (#88: recipient-only delivery, §6a disclosure, second-degree refusal, stranger indistinguishability, content bounds, sync replay, outbox minimisation) |
| `unit/` | `note-content.policy.unit.test.ts` | `pin-a-note.feature` › "The note body is trimmed, bounded, and never empty" |
| `unit/` | `visible-notes-sql-composition.unit.test.ts` | the checked-in `persistence/sql/visible-notes.sql` composes `app.visible_people`, joins neither `app.connections` nor `app.users`, gates on `recipient_id = viewer_id`, and builds no tsvector |

**The pin gate has no unit suite, deliberately.** "May this author write to this
recipient" is one `INSERT … SELECT … WHERE EXISTS` over `app.visible_people` — it exists
only in SQL, so a unit test could only assert against a fake that reimplements it and
would go green on exactly the bug that matters. `pin-a-note.integration.test.ts`'s
second-degree and stranger scenarios are that rule's only real proof.

`tests/fitness/sql-table-ownership.fitness.test.ts` carries the other half: that no
checked-in `.sql` file here ever names `app.connections` or `app.users`, which is what
keeps reachability defined in one place (ADR-0002 §6, R2).
