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
| `integration/` | `read-a-note.integration.test.ts` | `pin-a-note.feature` — the `@integration` scenarios for the expanded view's read (#176, decision D14: the recipient opens a note and gets exactly what the list carries; stranger, author and never-existent refused identically; a malformed id refused at the schema; §6a re-evaluated on this read in both its absences) |
| `unit/` | `note-content.policy.unit.test.ts` | `pin-a-note.feature` › "The note body is trimmed, bounded, and never empty" |
| `unit/` | `get-note.query.unit.test.ts` | the one decision in `application/get-note.query.ts` — a `null` from the port becomes one `NoteGoneError`, with no branch that could grow a second (#176) |
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

**The read gate is split the same way, and `get-note.query.unit.test.ts` is deliberately
not testing it.** "May this viewer read this note" is `app.visible_notes`' own
`recipient_id = viewer_id`; the unit suite covers only the translation above it — whatever
the port answers `null` for becomes one refusal — over a fake port. The authorization is
`read-a-note.integration.test.ts`'s, and the indistinguishability claim is additionally
proved from `tests/security/` (B17), because a B-row must stand without reading a module's
own test tree.

**Answering a note is `pin`'s scenarios, not a suite of its own** (#176, decision D14).
Pin-back composes a new note through the same mutation and the same degree-1 gate, so
everything about the write is already asserted above; what is new is *whether the control
is offered*, which is a client decision and lives in `apps/web/src/app/notes/
note-pin-back.unit.test.ts`. Nothing here writes a second time, because the read path adds
no state.

`tests/fitness/sql-table-ownership.fitness.test.ts` carries the other half: that no
checked-in `.sql` file here ever names `app.connections` or `app.users`, which is what
keeps reachability defined in one place (ADR-0002 §6, R2).
