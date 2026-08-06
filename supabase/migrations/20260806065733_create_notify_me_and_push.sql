-- Lane L3b-notify's two tables — `app.notify_me_queries` and `app.push_subscriptions`
-- (m2-lane-briefs.md §"L3b-notify — Notify Me + push", ADR-0007:77-79).
--
-- One migration carrying the lane's tables, per the same per-lane migration-PR
-- reconciliation `create_bulletins.sql` and `create_connections_and_outbox.sql`
-- already established. The ADR-0002 §4 backstop and the explicit per-table grant are
-- not optional and not hand-written: B3 reads the catalog, so a table that skipped
-- either fails the security suite whether or not the SQL looks right.

-- Everything is created, owned, and granted by `app_migrator`, so the catalog comes
-- out identical whether the runner is a superuser (Testcontainers) or Supabase's
-- non-superuser `postgres`.
set role app_migrator;

--------------------------------------------------------------------------------
-- 1. app.notify_me_queries  (ADR-0007:77-79, D1, plan M2.10)
--------------------------------------------------------------------------------

-- **`owner_id` is the primary key, not a surrogate `id`.** ADR-0007:79 is explicit:
-- "exactly one Notify Me query per user — enforced by the primary key on `owner_id`,
-- which is D1 expressed as a database constraint rather than a convention." A
-- second insert for the same owner is a primary-key violation, not an application
-- check a future edit could forget.
create table app.notify_me_queries (
  owner_id    uuid primary key references app.users (id),
  -- Round-trips into the input exactly as the person typed it (ADR-0007's "stores
  -- both the source text and the validated AST").
  source_text text not null,
  -- The validated AST, stored so the hot notification path
  -- (EvaluateNotifyMeHandler, on every BulletinCreated) never re-parses untrusted
  -- text. Compiled by the same `views` grammar the board and saved views use
  -- (ADR-0007 "Reuse").
  ast         jsonb not null,
  -- Versions the AST *shape*, not the row. A grammar change ships as a new
  -- `ast_version` and a migration that re-validates or re-parses stored queries —
  -- never a silent reinterpretation of what someone saved (ADR-0007:70-72).
  ast_version int not null,
  -- ADR-0005: `view.save` / `notifyMe.update` are `expectedVersion: yes` — "last
  -- saved query is user-visible state, not a merge candidate." Bumped on every
  -- successful update; compared against the client's `expectedVersion` before the
  -- write is attempted.
  version     int not null default 1,
  updated_at  timestamptz not null
);

comment on table app.notify_me_queries is
  'One row per user, at most (D1, ADR-0007:77-79 — the primary key on owner_id IS '
  'the "exactly one query" constraint). EvaluateNotifyMeHandler reads ast/ast_version '
  'on every BulletinCreated; never re-parses source_text on the hot path.';

comment on column app.notify_me_queries.ast is
  'The validated AST, ADR-0007''s restricted filter grammar compiled by modules/views. '
  'Never raw SQL, never a second grammar — same shape the board and saved views use.';

comment on column app.notify_me_queries.version is
  'ADR-0005 optimistic-concurrency version. notifyMe.update is expectedVersion: yes — '
  'mismatch is a conflict, never a silent overwrite of a deliberate change.';

select app.apply_rls_backstop('app.notify_me_queries');
grant select, insert, update, delete on table app.notify_me_queries to app_rw;

--------------------------------------------------------------------------------
-- 2. app.push_subscriptions  (plan M2.11)
--------------------------------------------------------------------------------

-- **`owner_id` is the primary key.** M2 scope is one Web Push subscription per
-- user — "cross-device dedup" and multi-subscription support are cut to M5
-- (notify-me.feature's own scope comment). A second `subscribe` call for the same
-- owner is therefore a primary-key violation the application maps onto M2-AC18's
-- structured "subscribing twice is rejected" error, the same shape
-- `app.notify_me_queries.owner_id` gives D1: the constraint is the enforcement, not
-- a row a service has to remember to check for first.
create table app.push_subscriptions (
  owner_id   uuid primary key references app.users (id),
  -- The Web Push subscription triple (endpoint + the two keys a client's Push API
  -- `subscribe()` call returns). No content or contact data lives here — this table
  -- exists to *route* a push, exactly like an outbox payload (ADR-0006).
  endpoint   text not null,
  p256dh_key text not null,
  auth_key   text not null,
  created_at timestamptz not null
);

comment on table app.push_subscriptions is
  'One Web Push subscription per user (M2 scope — multi-device is M5). Consumed only '
  'by SendGroupedPushHandler at delivery time, inside the same transaction as its '
  'consumer_receipts row (ADR-0002 section 11 delivery-time re-check).';

select app.apply_rls_backstop('app.push_subscriptions');
grant select, insert, update, delete on table app.push_subscriptions to app_rw;

--------------------------------------------------------------------------------
-- 3. Sweep (ADR-0002 §3)
--------------------------------------------------------------------------------

-- The baseline's default-privilege revokes already cover objects `app_migrator`
-- creates from here on; this covers the two tables this migration just created, the
-- same way create_bulletins.sql covers its one and create_connections_and_outbox.sql
-- covers its five.
revoke all on table app.notify_me_queries, app.push_subscriptions from anon, authenticated, public;

reset role;
