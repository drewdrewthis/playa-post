# `modules/notes` tests

Beside the code they test, not in a top-level `tests/` tree: a module's suites move,
split, and get deleted with the module.

**The filename is the price** (`CLAUDE.md`, "Conventions"). `*.integration.test.ts` runs
in the `integration` vitest project against a Testcontainers Postgres with
`supabase/migrations` applied; `*.unit.test.ts` runs in `unit` with no infrastructure at
all. Nothing here needs `pnpm db:start`.

| Directory | Suite | Feature-file scenarios |
|---|---|---|
| `integration/` | `visible-notes-migration.integration.test.ts` | `app.notes`' and `app.visible_notes`' catalog shape — RLS backstop, table and EXECUTE grants (both halves: `app_rw` has them, nobody else does), `SECURITY INVOKER`, `SET search_path = ''`, the verbatim-migration pairing, and the two structural facts (no tsvector, no self-addressed note) |
| `integration/` | `pin-a-note.integration.test.ts` | `pin-a-note.feature` — eleven `@integration` scenarios (#88: recipient-only delivery, §6a disclosure, second-degree refusal, stranger/nobody/self indistinguishability, content bounds, sync replay, idempotency-store minimisation, outbox minimisation, and the three post-delivery lifecycle scenarios below) |
| `unit/` | `note-content.policy.unit.test.ts` | `pin-a-note.feature` › "The note body is trimmed, bounded, and never empty" |
| `unit/` | `visible-notes-sql-composition.unit.test.ts` | the checked-in `persistence/sql/visible-notes.sql` composes `app.visible_people`, joins neither `app.connections` nor `app.users`, gates on `recipient_id = viewer_id`, LEFT-joins the authorized set, never projects `n.author_id`, and builds no tsvector |

**Two privacy claims are asserted over storage rather than over a response**, because both are
about a copy that outlives the request:

| Claim | Where it is proved |
|---|---|
| A note's text never reaches `app.mutation_results` | `pin-a-note.integration.test.ts` › "The idempotency store keeps no copy of a pinned note's text" — `result ->> 'body'` is null *and* the raw jsonb contains no phrase from the body. The store holds every sync result verbatim for 30 days (ADR-0005) behind no recipient predicate, so an echoed body would be a second, ungated copy |
| A note's text never reaches `app.outbox_events` | `pin-a-note.integration.test.ts` › "The outbox event for a pinned note carries identifiers only" — asserted over the serialized whole row, not just the payload |

**The post-delivery lifecycle is three scenarios sharing one invariant: the card may go, the
message may not.** A note was addressed and delivered, so it belongs to its recipient — severing
the connection, the author deactivating, or the author lowering their disclosure each change what
the recipient is told about *who wrote it* and none of them removes what they were told. The first
two produce an author-less note and additionally assert the author's `app.users.id` appears
nowhere in it, which is the half that keeps the LEFT JOIN in `visible-notes.sql` from failing
open; the third produces a card that is present and unnamed, which is the ordinary §6a absence.

**The pin gate has no unit suite, deliberately.** "May this author write to this
recipient" is one `INSERT … SELECT … WHERE EXISTS` over `app.visible_people` — it exists
only in SQL, so a unit test could only assert against a fake that reimplements it and
would go green on exactly the bug that matters. `pin-a-note.integration.test.ts`'s
second-degree and stranger scenarios are that rule's only real proof.

`tests/fitness/sql-table-ownership.fitness.test.ts` carries the other half: that no
checked-in `.sql` file here ever names `app.connections` or `app.users`, which is what
keeps reachability defined in one place (ADR-0002 §6, R2).
