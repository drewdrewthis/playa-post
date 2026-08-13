# ADR-0019 — Saved views are removed; Notify Me stands alone

- **Status:** accepted — executes the owner's decision of 2026-08-13
  (issue [#208](https://github.com/drewdrewthis/playa-post/issues/208), product decision D19)
- **Date:** 2026-08-13
- **Drivers:** issue #208; supersedes ADR-0016; amends ADR-0007's storage section;
  product decisions D1/D16 (both reopened by D19) and D17 (its saved-views half)

## Context

ADR-0016 shipped the Saved tab, `views.saved.*`, `app.saved_views`, and the per-view
notify bell; D16 (#172) then let several bells notify at once, capped at six. The owner
has now cut the feature entirely: nobody needs named, listable views, and the bell —
built as a *designation* precisely so "who gets notified" would have one answer — had
become the most intricate machinery in the product (a composite FK, a
`NULLS NOT DISTINCT` unique key, a cap with its own scope rules, a two-event lifecycle)
in service of a screen being deleted.

What is **not** cut is Notify Me itself. The PDF's original shape — "one special saved
query called Notify Me", D1 before D16 reopened it — is the shape that returns.

## Decision

### D1 — everything Saved-Views is deleted, not deprecated

`app.saved_views` is dropped. The five `views.saved.*` procedures, their services,
repositories, domain objects, events, the Saved screen, the "☆ Save as view" control,
and the Saved tab are all removed. `schema app` shrinks by one table and
`tests/security/app-table-inventory.security.test.ts` opens the door by name in the
other direction.

### D2 — Notify Me returns to one query per person, keyed by a plain unique

Migration `20260813214946_remove_saved_views.sql`:

```sql
delete from app.notify_me_queries where source_view_id is not null;
alter table app.notify_me_queries
  drop constraint notify_me_queries_owner_id_source_view_id_key;
alter table app.notify_me_queries
  drop column source_view_id;  -- takes the composite FK with it
alter table app.notify_me_queries
  add constraint notify_me_queries_owner_id_key unique (owner_id);
drop table app.saved_views;
```

Designated rows are deleted rather than untied: each was created by lighting a bell on
a card, the card is gone, and folding several bells' queries into one untied slot has
no defensible merge rule. The **untied** query — the one written through
`views.notifyMe.update`, the only surface that survives — is preserved intact.

The surrogate `id` **stays the primary key** even though `owner_id` is now unique on
its own: `NotifyMeQueryChanged` outbox events route on the query's `id` as
`aggregate_id`, and swapping the key would re-identify the aggregate under its
consumers. "One per person" is `unique (owner_id)`; identity is `id`. Two constraints,
two jobs.

### D3 — the defence-in-depth dedup in the evaluator stays

`EvaluateNotifyMeHandler` still settles a person at their first match rather than
trusting the directory to hand back one row per person. `unique (owner_id)` makes a
second row impossible today, but a duplicate directory row must degrade to a duplicate
*read*, never a duplicate push — the dedup is one loop guard, and the failure it
prevents is user-visible.

### D4 — `modules/views` keeps its name, for now

The module now holds the board-query grammar and one procedure. Renaming the directory
touches every import path and the dependency-cruiser rules for no behavioural gain;
the rename is deferred and recorded in the module barrel.

## Consequences

- `views.notifyMe.update` is the entire `views` transport surface. The web app never
  called it — the only writers were the bells — so **no Notify Me UI exists** after
  this change; building one is follow-up work, out of #208's scope.
- ADR-0016 is superseded whole. ADR-0007's storage section loses `app.saved_views`
  and `source_view_id`; the grammar's consumers are the board list and Notify Me
  matching, two rather than three.
- D17's purge sweeps bulletins alone; the saved-views target is gone with its table.
- The migration destroys designated rows on purpose. Pre-production, owner-accepted;
  the untied-row survival is proved by
  `modules/views/tests/integration/notify-me-queries-schema-migration.integration.test.ts`.

## Verification

| Claim | Evidence |
|---|---|
| `id` stays the primary key, `owner_id` is unique, `source_view_id` is gone, a second query per owner is refused | `notify-me-queries-schema-migration.integration.test.ts` › "the one-query-per-owner key (#208, ADR-0019)" |
| An existing untied query survives the removal migration; a designated one does not | same file › "Scenario: an untied Notify Me query survives the Saved Views removal" — migrations applied in two halves around `20260813214946_remove_saved_views.sql` |
| `schema app` holds exactly the declared tables, `saved_views` no longer among them | `tests/security/app-table-inventory.security.test.ts` |
| An unrelated actor still cannot write another person's query (B13) | `tests/security/write-path-idor-bulletins.security.test.ts` › `notifyMe.update` |
| One person is pushed at most once per bulletin whatever the directory returns | `modules/notifications/tests/unit/evaluate-notify-me-multiple-queries.unit.test.ts` |
| The contracts surface matches the router, five procedures fewer | `tests/fitness/contracts-api-parity.fitness.test.ts` |
