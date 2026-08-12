# `modules/notifications` tests

Beside the code they test, not in a top-level `tests/` tree: a module's suites move,
split, and get deleted with the module.

**The filename is the price** (`CLAUDE.md`, "Conventions"). `*.integration.test.ts`
runs in the `integration` vitest project against a Testcontainers Postgres with
`supabase/migrations` applied. Nothing here needs `pnpm db:start`.

| Directory | Suite | Feature-file scenarios |
|---|---|---|
| `integration/` | `push-subscriptions-schema-migration.integration.test.ts` | `app.push_subscriptions`' catalog shape — RLS, ownership, grants, the primary key on `owner_id` that makes "one subscription per user" a constraint |
| `integration/` | `notification-seen-watermarks-schema-migration.integration.test.ts` | `app.notification_seen_watermarks`' catalog shape (issue #178) — RLS, ownership, grants, the primary key on `recipient_id` that makes "one watermark per person" a constraint, and the two-column-only shape |
| `integration/` | `notify-me-push.integration.test.ts` | `notify-me.feature` — two `@e2e` (API-level) + four `@integration` (M2-AC7 ×3, M2-AC8, M2-AC21, M2-AC22) |
| `integration/` | `push-subscription.integration.test.ts` | `notify-me.feature` › "Re-subscribing to push replaces the stored subscription" (M2-AC18) |
| `integration/` | `notifications-list.integration.test.ts` | **none** — `notifications.list` (issue #31) is the data source `vertical-slice-e2e.feature` step 9 reads, and no feature-file scenario states it. Its own docblock carries the four design choices that stand in for the missing scenarios, the same disclosure discipline `notify-me-push.integration.test.ts` uses |
| `integration/` | `notification-dismissal.integration.test.ts` | **none** — `notifications.dismiss` (issue #50) has no feature-file scenario either; its docblock states the rule it proves (a dismissal is durable, converging, and one person's) |
| `integration/` | `notification-seen.integration.test.ts` | **none** — `notifications.markSeen` (issue #178). Proves what only a database can: the watermark survives a new caller, a second open replaces rather than accumulates, a stale write never moves it backwards, and it is scoped to one recipient. Every scenario asserts `unread` beside `seen`, because the regression this feature can ship is one flag implying the other |
| `unit/` | `list-notifications-unread.unit.test.ts` | **none** — the `unread`/dismiss rule's boundary cases, against in-memory fakes |
| `unit/` | `list-notifications-seen.unit.test.ts` | **none** — the `seen` rule's boundary cases (no watermark, a timestamp exactly on it, either side of it, a second open) and all four `seen`×`unread` combinations, against in-memory fakes |
| `unit/` | `evaluate-notify-me-multiple-queries.unit.test.ts` | `notify-me.feature` › "A bulletin matching two of one viewer's queries is matched once" — the feature's one `@unit` scenario, tagged that way because the claim settles at evaluation and needs no database (#172, decision D16) — one match per person however many of their queries match, the scan stopping at a person's first match, people kept apart, and the author skipped before any read. The authorized-read half stays in `notify-me-push.integration.test.ts`: a fake here would prove nothing about `app.visible_bulletins` |

The two pure rules this module owns — the 60-second tumbling window
(`domain/notification-window.ts`) and the payload's fixed shape
(`domain/push-transport.ts`) — are asserted through the integration suite above, at
both boundaries the feature file names (59 s joins, 61 s starts a new group) and by a
full-object equality on the captured payload. A unit test of the grouper alone would
re-assert the same two boundaries one layer down.

**A unit test lives beside the file it covers when it covers one file, and under `unit/`
when it covers a rule.** The two above are under `unit/` because `unread` and `seen` are
each a claim about a query and a service *together* — the fake dismissal store and the fake
watermark store are shared by both sides of each rule, and a suite pinned to either file
alone could assert a write nothing reads back.

`infrastructure/web-push.transport.unit.test.ts` is the other kind, and sits beside the
file: it holds the `web-push` adapter's three
decisions — the VAPID details it signs each call with, the payload it puts on the wire
(M2-AC21 one layer further out than the integration suite reaches), and what it does
with a failure. That last one is the reason the file exists: a `404`/`410` endpoint-gone
must **resolve**, because `send` runs inside the flush's receipt transaction and a throw
would roll that window back on every round forever, starving every recipient sorted
after it. Everything else must throw, because at-least-once is the contract (ADR-0006).

`notify-me.feature`'s remaining two scenarios do not live here:

- **`notifyMe.update` fails closed for an unrelated actor** (M2-AC19) is in
  `modules/views/tests/integration/` — `views` owns the saved query and its table
  (ADR-0007:77-79); this module only reads it, through views' public directory.
- **Retry/backoff and two concurrent drainers** (M2-AC23, M2-AC24) belong to the outbox
  drainer entrypoint (M2.14, lane L3b-infra). They are infrastructure assertions about
  `app.outbox_events` and are not about notifications at all — they sit in
  `notify-me.feature` only because that is where the feature file collected the
  delivery guarantees the push path depends on.

**No mock of the database, and one fake at exactly one seam.** `PushTransport` is faked
because the alternative is a network call to a push service (`CLAUDE.md` /
`references/principles/coding.md`: mock only a boundary you cannot cheaply or
deterministically call). Everything else — the outbox, the receipts, `app.visible_people`,
`app.visible_bulletins` — runs for real, because "the recipient lost authorization
between compute and flush" (M2-AC22) is a claim about SQL that a fake repository would
assert against itself.
