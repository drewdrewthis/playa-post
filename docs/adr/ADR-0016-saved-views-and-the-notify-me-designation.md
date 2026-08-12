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

⚠ **Amended by issue [#172](https://github.com/drewdrewthis/playa-post/issues/172) /
product decision D16: the count is reopened, the structure is not.** The owner asked to be
able to notify on several views at once, so "at most one view per person can carry the
bell" no longer holds and neither does the primary key that enforced it:

```sql
-- migration 20260812120000_notify_me_queries_per_view.sql
alter table app.notify_me_queries add column id uuid not null default pg_catalog.gen_random_uuid();
alter table app.notify_me_queries drop constraint notify_me_queries_pkey;
alter table app.notify_me_queries add constraint notify_me_queries_pkey primary key (id);
alter table app.notify_me_queries
  add constraint notify_me_queries_owner_id_source_view_id_key
    unique nulls not distinct (owner_id, source_view_id);
```

Everything above this paragraph that is *not* about the count still stands, and that is
most of it: `app.saved_views` still carries no notify flag, `app.notify_me_queries` is
still the sole answer to "who gets notified", the composite foreign key is untouched, and
D1 is still a constraint rather than application code — it is now `UNIQUE NULLS NOT
DISTINCT (owner_id, source_view_id)` instead of a primary key, reading "one query per
(owner, view), plus one untied query per owner". The `NULLS NOT DISTINCT` is what keeps
`views.notifyMe.update` addressable with no identifier, and it costs that procedure its old
side effect: it no longer detaches a lit bell, because the bells are other rows.

Two claims above did not survive. **"Lighting a second one is an `ON CONFLICT DO UPDATE`
that moves it"** is now an upsert on the *pair*, so a second bell adds a query and only
re-lighting the same bell converges. And **`EvaluateNotifyMeHandler` is no longer unchanged
to the character**: `findAllCurrent` may return several rows per owner, so the handler
settles a person at their first match — a `NotifyMeMatched` per query would push one
bulletin at somebody once per bell. The read cost that used to be bounded by the primary
key is bounded instead by `NOTIFY_ME_QUERY_LIMIT_PER_OWNER` (six), which is deliberately
**not** D3's 24; D16 records why the two caps have different payers and therefore different
numbers.

### D2 — the card's match count is `bulletins.board`, called by the client, once per view

`views.saved.list` reports no counts. The Saved screen issues one
`bulletins.board({ query })` per view, under the same react-query cache key `board.tsx`
uses, and `httpBatchLink` folds them into a single HTTP request.

Computing the count **in `modules/views`** would require it to consume `modules/bulletins`,
which already consumes this module's grammar (ADR-0013) — a module cycle — or a counting
port injected at composition, which is a second implementation of "what does this query
match". The client-side version avoids both, and is strictly *more* correct: the number on
a card is the number the board shows when that card's "OPEN ON BOARD" is tapped,
page-size ceiling included, because it is literally the same read.

⚠ **That is an argument for who computes the count, not for how much this costs, and the
two were conflated when D2 was first written.** Two things it did not weigh:

**A counting procedure inside `modules/bulletins` is a third option, and it has no module
cycle.** `bulletins.countMatching({ queries })` sits in the module that already owns
matching and already consumes this module's grammar, so the dependency direction is
exactly today's — no new edge, and none of what the paragraph above rules out applies to
it. It is still called by the client, still runs the one read that decides visibility, and
returning `LEAST(count, BOARD_PAGE_SIZE)` preserves D2's actual load-bearing property. It
is the "coordinating application service / shared contract" escape hatch CLAUDE.md names.

**The batching claim is about round trips and says nothing about bytes.** `useQueries` +
`httpBatchLink` genuinely fold N calls into one HTTP request, so 24 views cost 2 round
trips rather than 25 — but each `bulletins.board` answers with up to `BOARD_PAGE_SIZE`
(50) **complete** `VisibleBulletin` objects, bodies bounded at `BULLETIN_BODY_MAX_LENGTH`
(4000). At the D3 cap that is 24 × 50 bulletins downloaded, parsed, and retained in the
query cache to render **24 integers**; `saved-views.tsx`'s `select` narrows what the
screen observes and deliberately does not narrow what the cache holds. Realistically
high-hundreds-of-KB, and multiple MB at the contract ceiling — on the screen a
poor-connectivity PWA opens most.

**This decision stands as implemented**, because correctness-by-same-read is worth more
than payload on a first cut and the cache sharing with `board.tsx` is real. But it stands
on the record above rather than on a two-way choice that was never exhaustive; the
`countMatching` procedure is the change to make if the payload is ever measured as a
problem, and it is a follow-up rather than a rewrite.

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
| **A `bulletins.countMatching({ queries })` procedure in `modules/bulletins`** | **Not rejected on architecture — it adds no module edge**, since `modules/bulletins` already owns matching and already consumes this module's grammar. It would cut the response from 24 × 50 full bulletins to 24 integers. Deferred rather than dismissed: the shipped version shares a cache key with `board.tsx` and is provably the number the board will show, and no payload measurement has been taken yet. See D2's amendment for the cost this trades away. |
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
| ~~Lighting a second bell moves the designation instead of adding one (D1)~~ **Superseded by D16**: lighting a second bell *adds* a query, and switching one off leaves the others lit | same file › "writes one notify_me_queries row per lit bell rather than moving a single one" and "switches one bell off without touching the others" |
| The per-person cap that replaced D1's primary key as the evaluator's read bound (D16) | same file › "refuses the 7th bell, bounding what the evaluator reads per bulletin" — and re-lighting an already-lit bell at the cap still succeeds, because it adds nothing to count |
| The cap counts **lit bells**, never the untied query, so no slot is spent on a row no card could free (D16) | same file › "lets someone at the bell cap still save their untied query, which the cap does not count" — the seventh row lands via `views.notifyMe.update`, the screen is unchanged by it, and the bell cap still refuses a seventh bell in the same test |
| A person is matched once per bulletin however many of their queries match (D16) | `modules/notifications/tests/unit/evaluate-notify-me-multiple-queries.unit.test.ts` |
| An existing single-notify user's bell survives the key swap (#172 AC3) | `notify-me-queries-schema-migration.integration.test.ts` › "Scenario: an existing Notify Me user survives the key swap" — the migrations are applied in two halves around #172's, with the pre-#172 row written in between |
| Deleting the designated view stops the notifications | same file › "stops the notifications when a view a bell is on is deleted, and only that one" |
| A stale client cannot switch off a bell it is wrong about | same file › "does not switch off a bell whose view was never lit — a stale client must not undo a live choice" |
| A write names **one** view, not every view its owner holds — the `id` predicate on `rename` and `delete` | same file › "renames only the view it was given" and "deletes only the view it was given". Both need an owner holding **two** views: with one row per owner, `WHERE owner_id = X` and `WHERE owner_id = X AND id = V` select the identical set and no assertion can tell them apart. The delete case carries no lit bell on purpose, so the composite FK cannot mask the missing predicate. |
| Deleting one view does not switch off a bell lit on another | same file › "leaves a bell lit on another view alone when a different view is deleted" — the surviving designation still points at its own view and no `NotifyMeQueryCleared` is written. The identical predicate pair in `setNotify` was already pinned by the stale-client row above; `delete`'s copy was not. |
| `views.notifyMe.update` still works and still owns its own query | same file › "leaves the designation clear when views.notifyMe.update writes a query of its own", plus the pre-existing `notify-me-query.integration.test.ts` unchanged and passing |
| The saved query goes through the one grammar and a refused query stores nothing | same file › "parses the query through the one grammar and stores nothing when it is refused" |
| The five new procedures are declared in `packages/contracts` and match the router | `tests/fitness/contracts-api-parity.fitness.test.ts`, at compile time and at run time |
| No procedure accepts a caller-supplied owner identifier | `tests/fitness/viewer-id-provenance.fitness.test.ts` (B14) walks the built router including the new sub-router |
| An unrelated actor cannot save, rename, delete or re-point another owner's view through the write path (B13) | `tests/security/write-path-idor-bulletins.security.test.ts` › `describe('view.save')`. `tests/security/b-rows.manifest.json`'s B13 row is `"status": "live"` and names that file in `provenBy`; its assertion text records `view.save` as proven here alongside `bulletin.archive` and `notifyMe.update`. `view.save` is the first B13 case with a genuine unrelated-actor scenario rather than a by-construction one — a saved view has a client-suppliable id, so an unrelated actor really can name another owner's row, and the `owner_id` predicate on every statement is what fails it closed. |
| **Owed:** rename has no UI | Recorded in the alternatives table. A later PR adds the control or removes the procedure. |
