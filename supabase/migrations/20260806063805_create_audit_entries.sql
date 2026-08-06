-- Lane L3b-infra's one table (m2-lane-briefs.md §L3b-infra, plan M2.15): the audit
-- log `RecordAuditEntryHandler` writes to, one row per audited outbox event
-- (ADR-0002 Q4's v1 audit scope).
--
-- Same backstop discipline as L2's migration: `app.apply_rls_backstop` plus an
-- explicit `app_rw` grant, applied while `app_migrator` owns the create, so the
-- catalog comes out identical under Testcontainers and under Supabase's
-- non-superuser `postgres`.
set role app_migrator;

--------------------------------------------------------------------------------
-- app.audit_entries  (plan M2.15, ADR-0002 Q4, ADR-0006 consumer pattern)
--------------------------------------------------------------------------------

-- ⚠ Structurally carries **internal IDs only** — there is no `payload jsonb` column
-- here, unlike `app.outbox_events`. `app.outbox_events.payload` may carry whatever a
-- future event needs to route; an audit entry must never carry bulletin content or
-- contact data (lane brief, ADR-0002 Q4), and the cheapest way to guarantee that is
-- to give the table no column capable of holding it. `RecordAuditEntryHandler` reads
-- an outbox event's envelope fields and copies exactly the five below — nothing it
-- extracts from `payload` — so a payload carrying content has nowhere in this schema
-- to land even if the handler had a bug.
--
-- `entry_id` is a fresh uuid, not `event_id`, so a source event's own audit fact is
-- addressable independently of the outbox row it came from (which is pruned after
-- fourteen days per ADR-0006; an audit trail is not).
create table app.audit_entries (
  entry_id      uuid primary key default pg_catalog.gen_random_uuid(),
  -- Past tense (addendum §20), matching `app.outbox_events.event_type` — e.g.
  -- 'ConnectionAccepted'. Not a foreign key to any event catalog: ADR-0002 Q4 names
  -- the *categories* audited, not a closed enum, and a check constraint here would
  -- fail closed on the next audited event type before the application does.
  event_type    text not null,
  -- Copied from the source event's `occurred_at`, so an entry's timeline reflects
  -- when the underlying fact happened, not when the drainer got around to it.
  occurred_at   timestamptz not null,
  -- When this audit fact was recorded — always >= occurred_at, and the two diverging
  -- is exactly the drainer's queuing latency, which is useful to keep visible rather
  -- than collapse into one timestamp.
  recorded_at   timestamptz not null default now(),
  -- Who acted, and what the event was about. Both nullable: `app.outbox_events`
  -- allows `actor_id is null` for system-originated events, and an audited event's
  -- `aggregate_id` may equally be a person or a non-person aggregate — the column
  -- name stays generic rather than `user_id` for that reason.
  actor_id      uuid,
  aggregate_id  uuid not null,
  -- The event this entry was recorded from. **No foreign key to
  -- `app.outbox_events.event_id`**, deliberately, mirroring
  -- `app.consumer_receipts`'s own no-FK note one migration back: a published outbox
  -- row is pruned after fourteen days and an audit entry must outlive it, so a FK
  -- here would either block the prune or cascade away the very record the audit
  -- trail exists to keep.
  source_event_id uuid not null
);

comment on table app.audit_entries is
  'One row per audited outbox event (ADR-0002 Q4 v1 scope). Carries internal IDs '
  'only — no bulletin content, no contact data — by construction: there is no '
  'payload column for either to occupy. Written by RecordAuditEntryHandler in the '
  'same transaction as its app.consumer_receipts row (ADR-0006 idempotency).';

comment on column app.audit_entries.source_event_id is
  'app.outbox_events.event_id at write time. Not a foreign key: outbox rows are '
  'pruned after fourteen days (ADR-0006) and this table must outlive that prune.';

-- The drainer and any future audit read surface both filter by aggregate and by
-- recency; a plain btree on each keeps both proportional to their result rather than
-- to the whole table.
create index audit_entries_aggregate_id_idx on app.audit_entries (aggregate_id);
create index audit_entries_occurred_at_idx on app.audit_entries (occurred_at);

select app.apply_rls_backstop('app.audit_entries');
grant select, insert, update, delete on table app.audit_entries to app_rw;

--------------------------------------------------------------------------------
-- Sweep (ADR-0002 §3)
--------------------------------------------------------------------------------

-- The baseline's default-privilege revokes already cover objects `app_migrator`
-- creates from here on; this covers the one table this migration just created, the
-- same way `create_app_users` and `create_connections_and_outbox` cover theirs.
--
-- No sequence to sweep: `entry_id` is a uuid default, not a bigserial, so this
-- migration introduces no new `app` sequence and the B1 leak query's
-- `expectedVacuousKinds = ['sequence']` in
-- tests/security/baseline-catalog.security.test.ts stays correct as written — a
-- deliberate choice, recorded here so the next migration that reaches for
-- `bigserial` knows it is the one that has to update that assertion.
revoke all on table app.audit_entries from anon, authenticated, public;

reset role;
