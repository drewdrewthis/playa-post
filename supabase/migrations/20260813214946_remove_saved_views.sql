-- Saved Views are removed as a feature; Notify Me stands alone (issue #208, owner
-- decision 2026-08-13, ADR-0019 — which supersedes ADR-0016).
--
-- ⚠ **The bells die with their views.** A `notify_me_queries` row with a non-NULL
-- `source_view_id` was a *designation* — "notify me about this view's query" — and the
-- view it designates is being dropped in this same migration. Keeping the row would keep
-- a notification running with no card, no bell, and no off-switch anywhere in the
-- product; deleting it is the same rule `SavedViewRepository#delete` already applied one
-- view at a time. The untied row — the one `views.notifyMe.update` writes — is not a
-- designation and survives untouched, with its text, AST, version and `updated_at`.
--
-- What the key becomes:
--
--   before: primary key (id), unique nulls not distinct (owner_id, source_view_id)
--   after:  primary key (id), unique (owner_id)
--
-- One query per owner — the pre-D16 shape, restored, but keeping the surrogate `id` as
-- the primary key: `app.outbox_events.aggregate_id` has carried the query's own id since
-- D16 and consumers route on it, so reverting the key would change what published events
-- mean. A plain `unique (owner_id)` suffices now that `source_view_id` is gone — there is
-- no NULL to hold NOT DISTINCT, because there is no column left to be NULL in.
--
-- Order matters below: the composite FK from `notify_me_queries` to `saved_views` must
-- be gone before `app.saved_views` can be dropped, and the designated rows must be gone
-- before `unique (owner_id)` can hold — an owner with a lit bell AND an untied query held
-- two rows, legal under the old key and a violation under the new one.

--------------------------------------------------------------------------------
-- 1. The designated queries go — bells were designations of views being removed
--------------------------------------------------------------------------------

-- Run as the migration runner, NOT `app_migrator`: the table is under FORCE ROW LEVEL
-- SECURITY with the deny-all backstop, so a delete as `app_migrator` (nobypassrls,
-- no policy) silently matches zero rows and leaves every bell running. The runner —
-- Testcontainers' superuser or Supabase's `postgres` — bypasses RLS; DDL below is
-- unaffected either way and stays under `app_migrator` for an identical catalog.
delete from app.notify_me_queries where source_view_id is not null;

set role app_migrator;

--------------------------------------------------------------------------------
-- 2. The key swap back to one query per owner
--------------------------------------------------------------------------------

alter table app.notify_me_queries
  drop constraint notify_me_queries_owner_id_source_view_id_key;

-- Dropping the column takes notify_me_queries_source_view_fkey with it, which is what
-- unblocks step 3 — nothing references app.saved_views after this statement.
alter table app.notify_me_queries
  drop column source_view_id;

alter table app.notify_me_queries
  add constraint notify_me_queries_owner_id_key unique (owner_id);

--------------------------------------------------------------------------------
-- 3. app.saved_views goes
--------------------------------------------------------------------------------

drop table app.saved_views;

--------------------------------------------------------------------------------
-- 4. What the table now means
--------------------------------------------------------------------------------

comment on table app.notify_me_queries is
  'One row per owner — the single saved Notify Me query, enforced by '
  'notify_me_queries_owner_id_key (issue #208, which removed saved views and the '
  'per-view designations D16 introduced). EvaluateNotifyMeHandler reads ast/ast_version '
  'on every BulletinCreated; never re-parses source_text on the hot path.';

comment on column app.notify_me_queries.id is
  'The aggregate identity of the saved Notify Me query. Server-internal: it is what '
  'app.outbox_events.aggregate_id carries for NotifyMeQueryChanged, and it never reaches '
  'a client — views.notifyMe.update names no row, because the actor is the address.';

comment on column app.notify_me_queries.ast is
  'The validated AST, ADR-0007''s restricted filter grammar compiled by modules/views. '
  'Never raw SQL, never a second grammar — same shape the board uses.';

comment on column app.notify_me_queries.version is
  'ADR-0005 optimistic-concurrency version. notifyMe.update is expectedVersion: yes — a '
  'mismatch is a conflict, never a silent overwrite of a deliberate change.';

--------------------------------------------------------------------------------
-- 5. No backstop call, no grant, no sweep  (ADR-0002 §3/§4)
--------------------------------------------------------------------------------

-- Deliberately absent: this migration creates no table. `app.notify_me_queries` keeps
-- its `app.apply_rls_backstop` posture, its `app_rw` grant, and its revoke sweep — table
-- privileges and policies attach to the relation, not its column list, so all of it
-- survives the ALTERs above. `app.saved_views`' own grants and policy went with the
-- table.

reset role;
