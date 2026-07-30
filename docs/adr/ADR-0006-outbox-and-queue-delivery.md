# ADR-0006 — Transactional outbox and asynchronous delivery

- **Status:** proposed
- **Date:** 2026-07-30
- **Drivers:** addendum §10, §11, §18, §22; PDF §8 "Commands, reads, and events"

## Context

State changes and their events must commit atomically; consumers process at-least-once and must be
idempotent; no custom event framework; and the design must work on both ADR-0001 targets without
touching application code.

## Decision

**PostgreSQL `app.outbox_events` is the authoritative delivery ledger. The queue — Cloudflare Queues or
an in-process poller — is a *dispatch accelerator*, never the record.** This is the single design choice
that makes ADR-0001 reversible: both targets run the same drainer against the same table.

### Schema

```sql
app.outbox_events (
  event_id      uuid primary key,             -- UUID v7
  event_type    text not null,                -- 'BulletinCreated', past tense (§20)
  event_version int  not null default 1,
  occurred_at   timestamptz not null,
  actor_id      uuid,
  aggregate_id  uuid not null,
  payload       jsonb not null,
  status        text not null default 'pending',   -- pending|claimed|published|dead
  attempts      int  not null default 0,
  available_at  timestamptz not null default now(),
  claimed_at    timestamptz,
  claimed_by    text,
  last_error    text
)
-- partial index on (available_at) where status in ('pending','claimed')
```

Envelope fields are exactly §11's list. Nothing added without a concrete need.

**Payloads carry identifiers and the minimum needed to route, never bulletin content or contact
details** (PDF §6: sensitive content is not copied into queue payloads). Consumers re-read what they
need through the owning module's authorized read path — which also means a consumer cannot leak data the
current authorization state no longer permits.

### Writing

Application services insert the outbox row in the same transaction as the state change (§10).
An `OutboxWriter` is injected into the transaction scope; services never publish directly to a queue.

### Draining

- **Claim:**
  `UPDATE app.outbox_events SET status='claimed', claimed_at=now(), claimed_by=$1, attempts=attempts+1
   WHERE event_id IN (SELECT event_id FROM app.outbox_events
                      WHERE status IN ('pending','claimed') AND available_at <= now()
                      ORDER BY available_at FOR UPDATE SKIP LOCKED LIMIT $2)
   RETURNING *`
  `SKIP LOCKED` gives safe concurrent drainers with no leader election and no advisory locks.
- **Cloudflare target:** best-effort immediate dispatch after commit via `waitUntil`, **plus** a
  1-minute Cron trigger as the guaranteed backstop (Cloudflare cron granularity is 1 minute). The cron
  path alone is correct; the immediate path is latency optimisation only. A claimed row untouched for
  5 minutes is reclaimable — crash recovery costs nothing extra.
- **Node target:** an in-process poller on a 2-second interval, same query, same handlers.
- **Retry:** `available_at = now() + least(15 min, 5s * attempts^2)`. Max 8 attempts → `status='dead'`
  + alert. Dead events are never dropped; they are inspectable and manually replayable.

### Consumers

```sql
app.consumer_receipts (consumer_name text, event_id uuid, processed_at timestamptz,
                       primary key (consumer_name, event_id))
```

Each consumer inserts its receipt **in the same transaction as its own effect**; a
unique-violation means "already processed" → skip. This makes at-least-once delivery safe without any
consumer needing bespoke dedup logic. One consumer per event family (§5), named by behaviour
(`SendGroupedPushHandler`, `EvaluateNotifyMeHandler`, `RecordAuditEntryHandler`).

Ordering is **not** guaranteed and consumers must not assume it. Where order matters
(e.g. `BulletinArchived` after `BulletinCreated`), the consumer re-reads current state rather than
replaying a sequence.

### Scheduled (cron) work, same entrypoint family

Outbox drain (1 min) · bulletin expiry sweep · notification grouping window flush ·
`mutation_results` prune (ADR-0005, daily) · dead-event alert.

## Alternatives considered

| Alternative | Why not |
|---|---|
| **Publish to the queue directly from the service** | The classic dual-write bug: commit succeeds, publish fails (or vice versa) and the two diverge silently. §10/§11 require atomicity. |
| **Postgres `LISTEN/NOTIFY`** | Fire-and-forget with no durability — a notification delivered while no listener is connected is gone. Unusable in `workerd` (no long-lived connection). Fine as an *additional* latency hint later; not a ledger. |
| **`pg-boss` / Graphile Worker** | Mature and tempting for the Node target, but they are job queues, not transactional outboxes, and neither runs in `workerd` — adopting one would fork the delivery design across the two ADR-0001 targets, which is exactly what §22 forbids. Revisit if the Node target is chosen *and* scheduling needs outgrow cron. |
| **Cloudflare Queues as the record of truth** | Not transactional with the database; loses the atomicity guarantee entirely; and hard-couples the design to target A. |
| **Redis / SQS / Kafka** | A new stateful dependency and a second consistency model for a workload measured in events per minute. §18/§24. |
| **`FOR UPDATE` without `SKIP LOCKED`** | Drainers serialize and block each other. |

## Consequences

- **Positive:** delivery semantics are identical on both runtimes; a Postgres backup contains the full
  delivery state; no extra infrastructure to operate at v1 scale; consumers get dedup for free.
- **Negative:** polling costs a query per interval; up to ~1 minute worst-case latency on target A if
  the `waitUntil` dispatch is skipped (acceptable — the latency-sensitive path is push notifications,
  which are already batched into grouping windows).
- **Negative:** the outbox table needs pruning of `published` rows (keep 14 days for debugging) — added
  to the daily cron.
- **Risk:** a consumer that is not actually idempotent will corrupt state under retry. Mitigation:
  receipts are mandatory and enforced by a test that replays every event type twice and asserts a single
  effect (§21 "Event idempotency").

## Verification

`accepted` when the M2 slice's `BulletinCreated` → Notify Me evaluation → grouped push path runs through
this table on the chosen runtime, and CI contains a double-delivery test asserting exactly one effect
plus a retry/dead-letter test.
