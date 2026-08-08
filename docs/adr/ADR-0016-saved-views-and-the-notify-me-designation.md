# ADR-0016 — Saved views, and the per-view bell as a designation rather than a second query

- **Status:** proposed
- **Date:** 2026-08-08
- **Drivers:** issue #45; product decision D1 (`docs/product/decisions.md`); ADR-0007:73-79
  (the `app.saved_views` shape and the shared AST); ADR-0005:102 (`view.save` is
  `expectedVersion: yes`); ADR-0002 B10/B13; M5-AC16; `design/Playa Post.dc.html` 123-139

## Context

The Saved tab has been in the bar since the shell shipped and has pointed at an explicit
"Not built yet" placeholder, and the board's "☆ Save as view" control has been drawn and
disabled with a tooltip explaining that nothing could store a query. Both were honest
gaps: `app.notify_me_queries` keys on `owner_id`, so it holds exactly one unnamed query
per user, and a named, listable set of views cannot be modelled on it.

ADR-0007 already wrote the table down:

```sql
app.saved_views (id, owner_id, name, source_text, ast jsonb, ast_version int,
                 sort, created_at, updated_at, version)
```

What it did not settle is the part the comp forces: **the comp draws a notify bell on
every saved view, and the PDF says there is exactly one Notify Me query.** Product
decision D1 resolved that conflict in the PDF's favour and named the resolution —

> The prototype's per-view bell becomes the UI affordance for designating *which* view's
> query is the Notify Me query — toggling a bell on view B moves Notify Me from view A
> (with clear UI feedback), it does not create a second notifying query.

— but a decision phrased as UI behaviour still has to become a schema, and the obvious
schema is the wrong one. A `notify boolean` column on `app.saved_views` would make
"who gets notified" answerable from two tables, and `EvaluateNotifyMeHandler` — which
today runs one `SELECT` against `app.notify_me_queries` on every `BulletinCreated` — would
have to learn to read both and reconcile them. The moment two tables can answer the same
question, D1 stops being a primary key and becomes a rule some service has to remember.

Two smaller questions came with it: where the card's "N match now" count comes from, and
whether a saved view is `sort`-able before anything can sort.

## Decision

### D1 — `app.notify_me_queries` stays the sole answer to "who gets notified"

`app.saved_views` is created with every column ADR-0007 named except `sort` (see D4), and
carries **no notify flag**. Instead `app.notify_me_queries` gains one nullable column:

```sql
alter table app.notify_me_queries
  add column source_view_id uuid,
  add constraint notify_me_queries_source_view_fkey
    foreign key (owner_id, source_view_id) references app.saved_views (owner_id, id);
```

`NULL` means the query was written directly through `views.notifyMe.update` and belongs to
no view — the pre-existing behaviour, unchanged. Non-`NULL` means the bell is lit on that
view. Because the table's primary key is `owner_id`, **at most one view per person can
carry the bell, and lighting a second one is an `ON CONFLICT DO UPDATE` that moves it.**
D1 is enforced by a constraint, not by application code.

The foreign key is deliberately **composite**, which requires a matching
`unique (owner_id, id)` on `app.saved_views`. With `MATCH SIMPLE` (the default) a `NULL`
`source_view_id` satisfies the constraint outright, so an untied Notify Me query is still
legal; with a non-`NULL` one, *both* columns must match, so **the database refuses a
designation pointing at another owner's view.** That is M5-AC16's write half made
structural rather than procedural.

It carries **no `ON DELETE` clause**, matching every other foreign key in this schema.
Deleting a view that is currently the Notify Me source must *stop* the notifications —
the bell that turned them on lives on the card being removed, and there is no other
surface to reach it from — so `SavedViewRepository#delete` clears the query first, in the
same transaction. The constraint is what makes forgetting that a loud failure instead of
a silent orphan.

`EvaluateNotifyMeHandler` and `NotifyMeQueryDirectory#findAllCurrent` are **unchanged, to
the character.** That is the test of this decision.

### D2 — the card's match count is `bulletins.board`, called by the client, once per view

`views.saved.list` reports no counts. The Saved screen issues one
`bulletins.board({ query })` per view, under the same react-query cache key `board.tsx`
uses, and `httpBatchLink` folds them into a single HTTP request.

Computing the count server-side would require `modules/views` to consume
`modules/bulletins`, which already consumes this module's grammar (ADR-0013) — a module
cycle — or a counting port injected at composition, which is a second implementation of
"what does this query match". Neither is worth it, and the client-side version is strictly
*more* correct: the number on a card is the number the board shows when that card's "OPEN
ON BOARD" is tapped, page-size ceiling included, because it is literally the same read.

### D3 — a soft cap of 24 views per owner

D2's fan-out is proportional to the number of views, so an unbounded list is an unbounded
per-render cost a person can create for themselves. The cap is counted inside the save's
transaction but is not locked, so a race can land one extra row; that is the correct
trade for a bound whose purpose is to stop a list growing without limit, not to be a
constraint anything depends on. Raising it is a one-constant change with no migration.

### D4 — no `sort` column until something sorts

ADR-0007's column list includes `sort`. M2's board has no sort control and ADR-0007's
grammar has no sort term, so nothing would write it. It arrives with its writer.

### D5 — `NotifyMeQueryCleared` beside `NotifyMeQueryChanged`

Turning notifications off is a state change worth announcing for the same reason turning
them on is. `NotifyMeQueryChanged` carries a `version` "so a consumer can order its own
state", and a removal has no version to carry, so it is a second event type rather than a
`Changed` with an empty payload. Written when the bell is cleared and when a designated
view is deleted.

### D6 — one AST version constant for one grammar

`NOTIFY_ME_AST_VERSION` is renamed to `BOARD_QUERY_AST_VERSION` and moves to
`domain/board-query-grammar.ts`. `app.saved_views.ast_version` and
`app.notify_me_queries.ast_version` mean the same thing — which shape of `BoardQuery` is
in the `ast` column — and two constants could drift invisibly, each table's reader
filtering on its own number and quietly ceasing to see the other's rows.

### D7 — the grammar is not widened

`views.saved.save` parses through the same `parseBoardQuery`, so `from:`, `deg:`,
`trust:`, `is:`, negation and quoted phrases are still refused *naming the token*
(ADR-0007:53-56). A query the board will not run must not become a view claiming to run
it. Widening the grammar is separate work.

## Alternatives considered

| Alternative | Why not |
|---|---|
| **`notify boolean` on `app.saved_views`, with a partial unique index** | The index would enforce "one per owner" correctly, but the evaluator would then read two tables and reconcile them, and `views.notifyMe.update` — which writes a query belonging to no view — would have no row to set the flag on. Two answers to "who gets notified" is the failure D1 exists to prevent. |
| **Drop `views.notifyMe.update` and make the bell the only way to notify** | It is a shipped, tested procedure with an integration test asserting M2-AC19, and removing it would strand anyone whose Notify Me query is not a saved view. The brief for this work asked explicitly for the conservative path. |
| **`ON DELETE SET NULL` on the designation, so deleting a view leaves the query notifying** | The person deleted the card the bell was on and would keep receiving pushes with no surface left to switch them off. Unstoppable notifications is the worse surprise. |
| **`ON DELETE CASCADE`** | Correct behaviour, but this schema has no cascades anywhere and an implicit one would hide the clear from anybody reading the delete path. The explicit two-statement transaction says what happens; the FK backstops it. |
| **Counts computed in `views.saved.list`** | See D2 — a module cycle or a second definition of what a query matches, in exchange for a number that could then differ from the board's. |
| **A rename affordance on the card** | The comp draws none, and the design file is the owner-mandated SSOT for this screen. `views.saved.rename` exists behind the API (M5-AC16 covers update, and ADR-0005:102 gives it optimistic concurrency) but no control calls it yet. |
| **Optimistic concurrency on the bell** | A designation is not a document and has nothing to merge; the last tap winning is what a switch means. `setNotify` takes the desired state rather than toggling, so two racing taps cannot land in an order nobody chose. |

## Consequences

- The Saved tab renders the comp's screen, and "☆ Save as view" works. Both were
  deliberately inert; neither is any more.
- `schema app` grows to fifteen tables. `tests/security/app-table-inventory.security.test.ts`
  is the door that has to be opened by name, and it was.
- The notification path is untouched. `EvaluateNotifyMeHandler`,
  `NotifyMeQueryDirectory`, `SendGroupedPushHandler` and the outbox drainer all see
  exactly what they saw before, plus one new event type they ignore.
- `views.saved.rename` has no caller in `apps/web`. That is a known, recorded gap
  (see the alternatives table), not an oversight.
- The client-side fan-out in D2 is one batched HTTP request but *N* database round trips
  server-side. At the D3 cap that is at most 24, each an already-indexed authorized read.
  If the Saved screen ever gets paging, D2 is the decision to revisit first.
- M5's saved-views work (A6) is partly done early: CRUD, viewer scoping, and the bell.
  Sorts, defaults, and the wider grammar remain M5's.

## Verification

| Claim | Evidence |
|---|---|
| The table carries the ADR-0002 §4 backstop and only `app_rw` is granted | `tests/security/baseline-catalog.security.test.ts` (B3) quantifies over every table in `schema app`; the migration calls `app.apply_rls_backstop('app.saved_views')` |
| `schema app` holds exactly the declared tables | `tests/security/app-table-inventory.security.test.ts`, updated to fifteen names |
| One owner's views are unreachable by anybody else, and a refusal leaks none of their state | `apps/server/src/modules/views/tests/integration/saved-view.integration.test.ts` › "a saved view is reachable only by its owner" — rename, delete and setNotify each attempted by an unrelated actor; the owner's row unchanged, zero outbox rows, and the serialized rejections asserted not to contain the query text |
| Lighting a second bell moves the designation instead of adding one (D1) | same file › "writes exactly one notify_me_queries row however many bells are tapped" |
| Deleting the designated view stops the notifications | same file › "stops the notifications when the view the bell is on is deleted" |
| A stale client cannot switch off a bell that has already moved | same file › "does not switch off a bell that has already moved" |
| `views.notifyMe.update` still works and still owns its own query | same file › "leaves the designation clear when views.notifyMe.update writes a query of its own", plus the pre-existing `notify-me-query.integration.test.ts` unchanged and passing |
| The saved query goes through the one grammar and a refused query stores nothing | same file › "parses the query through the one grammar and stores nothing when it is refused" |
| The five new procedures are declared in `packages/contracts` and match the router | `tests/fitness/contracts-api-parity.fitness.test.ts`, at compile time and at run time |
| No procedure accepts a caller-supplied owner identifier | `tests/fitness/viewer-id-provenance.fitness.test.ts` (B14) walks the built router including the new sub-router |
| **Owed:** a B13 row for `view.save` in `tests/security/b-rows.manifest.json` | The manifest currently records `view.save` as "owed to its owning lane". The integration scenario above is the evidence; promoting it into the security suite is follow-up work, called out in this PR rather than silently left. |
| **Owed:** rename has no UI | Recorded in the alternatives table. A later PR adds the control or removes the procedure. |
