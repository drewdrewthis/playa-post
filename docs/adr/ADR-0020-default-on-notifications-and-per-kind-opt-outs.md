# ADR-0020 — Bulletin notifications are default-on; every kind gets an off-switch

- **Status:** accepted — executes issue
  [#209](https://github.com/drewdrewthis/playa-post/issues/209)
- **Date:** 2026-08-14
- **Drivers:** issue #209; amends ADR-0006's `EvaluateNotifyMeHandler` semantics and
  ADR-0019 D3; extends the notifications surface ADR-0014 declares

## Context

Since ADR-0006, a person is notified about a new bulletin only when they have saved a
Notify Me query that matches it. Nobody has a query until they type one, so the default
experience is silence — the opposite of what the owner wants for a small-community
board. Pinned-note notifications (`NotePinned` → the receipt-is-the-notification read
side) have no off-switch at all.

Issue #209 asks for a Notifications settings affordance: each notification type listed with
an on/off toggle, **on by default**, storing only the opt-outs.

## Decision

### D1 — BulletinCreated notifies everyone who can see the bulletin, by default

On `BulletinCreated`, the candidate recipient set is **every user who can see the
bulletin** under `app.visible_bulletins(viewer_id)` — the same function the read path
trusts (ADR-0002) — minus the author and minus anyone opted out of kind `bulletins`.
One SQL statement enumerates the candidates; it reads `app.users` for **ids only**,
which keeps the module's no-identity-disclosure rule intact (the rule guards names and
contact fields, not the existence of a user id the outbox already carries).

Enumerating candidates is O(users) per bulletin. At this product's scale (a camp's
worth of people) that is a deliberate, acceptable cost; a future scale problem is an
index/materialization problem, not a semantics problem.

### D2 — a saved Notify Me query is a narrowing filter, not a subscription

A person **with no saved query matches everything** they can see. A person **with** a
saved query is notified only when it matches — same authorized-read SQL as before
(`isAuthorizedMatch`). The one-match-per-person-per-bulletin invariant (ADR-0019 D3)
and receipt-based idempotency (ADR-0006) are unchanged.

Stale-grammar edge, accepted: the directory excludes queries stored under an old
`ast_version`, so such a person is treated as queryless and notified of everything
until the grammar migration ADR-0007 requires re-validates their AST. Default-on makes
"notify" the honest fallback where ADR-0007's was "notify nobody".

### D3 — opt-outs are stored; defaults are absence

New table, migration `20260814095157_create_notification_optouts.sql`:

```sql
create table app.notification_optouts (
  owner_id   uuid not null references app.users (id) on delete cascade,
  kind       text not null check (kind in ('bulletins', 'note')),
  created_at timestamptz not null default now(),
  primary key (owner_id, kind)
);
```

RLS backstop, `app_rw` grant, revoke sweep — the standard owner-scoped posture
(ADR-0002 §3/§4). A row means "off"; no row means "on". Storing opt-outs rather than a
preference row per person means every existing and future user is default-on with no
backfill, ever.

### D4 — `DeliverNotePinnedHandler` consults the opt-out before writing the receipt

The receipt **is** the note notification, so opting out of kind `note` means the
handler returns **without writing the receipt**; the drainer still publishes the row,
so there is no retry loop and no notification, ever — an opt-out at delivery time is
permanent for that event, which is what "off" means. The handler now reads
`payload['recipientId']` — an identifier, nothing more; a malformed payload keeps the
old behaviour (receipt written, row settled).

### D5 — the settings surface is two procedures and one panel affordance

`notifications.settings.get` (query → every kind with its `enabled` state, derived
from the absence of an opt-out row) and `notifications.settings.update` (mutation
`{ kind, enabled }` → the updated settings). Declared in `PlayaPostApi` per ADR-0014.
**Not** in `MUTATION_TYPES`: a settings flip replayed hours later from an offline
queue would silently undo a decision made since — online-only, like
`notifications.dismiss`.

The web affordance lives on the notifications panel: a settings toggle revealing one
accessible switch per kind, optimistic per the panel's existing mutation pattern.

## Consequences

- Bulletin notification volume rises from "people who typed a query" to "people who
  can see the bulletin". That is the point of #209; the per-kind off-switch ships in
  the same change.
- `EvaluateNotifyMeHandler` gains a repository read (`findEligibleRecipients`) and
  loses its notify-nobody default. Existing matched-query behaviour is a subset of the
  new behaviour, so saved queries keep working unchanged.
- `schema app` grows one table; `tests/security/app-table-inventory.security.test.ts`
  admits it by name.
- ADR-0006's "no query, no notification" sentence is superseded by D1/D2. ADR-0007's
  notify-nobody stale-grammar rule is amended by D2 for the default-on path.

## Verification

| Claim | Evidence |
|---|---|
| The table exists with the declared key, check, FK, RLS posture and grants | `apps/server/src/modules/notifications/tests/integration/notification-optouts-schema-migration.integration.test.ts` |
| A queryless connection is matched by default; a person outside the graph is not | `apps/server/src/modules/notifications/tests/integration/notification-settings.integration.test.ts` › D1 scenario |
| A saved query narrows — a non-matching query drops its owner | `apps/server/src/modules/notifications/tests/unit/evaluate-notify-me-multiple-queries.unit.test.ts` |
| An opted-out recipient gets no bulletin match and no note receipt | `notification-settings.integration.test.ts` › opt-out scenarios |
| One match per person per bulletin, whatever the directory returns | `evaluate-notify-me-multiple-queries.unit.test.ts` |
| `settings.get` covers every kind; `update` round-trips both directions | `notification-settings.integration.test.ts` |
| The contracts surface matches the router, two procedures more | `tests/fitness/contracts-api-parity.fitness.test.ts` |
