# `modules/notifications` tests

Beside the code they test, not in a top-level `tests/` tree: a module's suites move,
split, and get deleted with the module.

**The filename is the price** (`CLAUDE.md`, "Conventions"). `*.integration.test.ts`
runs in the `integration` vitest project against a Testcontainers Postgres with
`supabase/migrations` applied. Nothing here needs `pnpm db:start`.

| Directory | Suite | Feature-file scenarios |
|---|---|---|
| `integration/` | `push-subscriptions-schema-migration.integration.test.ts` | `app.push_subscriptions`' catalog shape — RLS, ownership, grants, the primary key on `owner_id` that makes "one subscription per user" a constraint |
| `integration/` | `notify-me-push.integration.test.ts` | `notify-me.feature` — two `@e2e` (API-level) + four `@integration` (M2-AC7 ×3, M2-AC8, M2-AC21, M2-AC22) |
| `integration/` | `push-subscription.integration.test.ts` | `notify-me.feature` › "Subscribing to push twice is rejected" (M2-AC18) |

There is no `unit/` directory, and that is a statement rather than an omission: the two
pure rules this module owns — the 60-second tumbling window
(`domain/notification-window.ts`) and the payload's fixed shape
(`domain/push-transport.ts`) — are asserted through the integration suite above, at
both boundaries the feature file names (59 s joins, 61 s starts a new group) and by a
full-object equality on the captured payload. A unit test of the grouper alone would
re-assert the same two boundaries one layer down.

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
