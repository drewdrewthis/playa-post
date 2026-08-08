-- `app.saved_views` — the named, listable board queries the Saved tab renders (issue
-- #45), plus the one column that makes the comp's per-view bell a *designation* rather
-- than a second notification channel.
--
-- ADR-0007:77 already wrote this table's shape down:
--
--   app.saved_views (id, owner_id, name, source_text, ast jsonb, ast_version int,
--                    sort, created_at, updated_at, version)
--
-- Every column of it is below except `sort`, which is deliberately absent: M2's board
-- has no sort control and ADR-0007's grammar has no sort term, so nothing would write
-- it. That is exactly the trap `create_notification_dismissals.sql` names — "a column no
-- mutation sets is a column every later reader has to guess the meaning of". It arrives
-- with the sort control, together, in the migration that gives it a writer.
--
-- ⚠ **`app.notify_me_queries` stays the single source of truth for who gets notified.**
-- Product decision D1 is that there is exactly one Notify Me query per user — "the
-- prototype's per-view bell becomes the UI affordance for designating *which* view's
-- query is the Notify Me query — toggling a bell on view B moves Notify Me from view A,
-- it does not create a second notifying query." A `notify boolean` column on this table
-- would be a second answer to "who gets pushed", reachable by
-- `EvaluateNotifyMeHandler` only if it learned to read two tables. Instead
-- `app.notify_me_queries` gains a nullable pointer *back* at the view it was designated
-- from, so the evaluator's query is byte-for-byte the one it already runs and D1 stays
-- a primary key rather than an application rule. See ADR-0016.

-- Everything is created, owned, and granted by `app_migrator`, so the catalog comes
-- out identical whether the runner is a superuser (Testcontainers) or Supabase's
-- non-superuser `postgres`.
set role app_migrator;

--------------------------------------------------------------------------------
-- 1. app.saved_views  (ADR-0007:77, M5-AC16, issue #45)
--------------------------------------------------------------------------------

create table app.saved_views (
  id          uuid primary key default pg_catalog.gen_random_uuid(),
  owner_id    uuid not null references app.users (id),
  -- What the person calls it. The board's "Save as view" seeds it from the query text
  -- and `rename` replaces it; bounds live in
  -- modules/views/domain/saved-view-name.policy.ts, where a refusal can carry the
  -- stable SAVED_VIEW_NAME_INVALID code and name the field, rather than surfacing as a
  -- driver-level 500 written for a DBA. Same decision app.bulletins.title records.
  name        text not null,
  -- Round-trips into the board's search field exactly as the person typed it
  -- (ADR-0007's "stores both the source text and the validated AST").
  source_text text not null,
  -- The validated AST, compiled by the same `views` grammar the board and Notify Me
  -- use. One grammar, one validator, one compiler (ADR-0007 "Reuse").
  ast         jsonb not null,
  -- Versions the AST *shape*, not the row — a grammar change ships as a new
  -- ast_version plus a migration that re-validates stored queries, never a silent
  -- reinterpretation of what somebody saved (ADR-0007:70-72).
  ast_version int not null,
  -- ADR-0005's conflict matrix puts `view.save` at `expectedVersion: yes` — a saved
  -- view's name is user-visible state, not a merge candidate. Bumped on every
  -- successful rename; compared against the client's expectedVersion in the WHERE
  -- clause of the update rather than by a prior read.
  version     int not null default 1,
  created_at  timestamptz not null,
  updated_at  timestamptz not null,
  -- ⚠ Redundant with the primary key on its own, and not redundant at all in context:
  -- it is what lets app.notify_me_queries carry a COMPOSITE foreign key on
  -- (owner_id, source_view_id), so the database refuses a Notify Me designation
  -- pointing at somebody else's view. Without it that invariant would be an application
  -- rule a future edit could reorder past (M5-AC16, ADR-0002 B13).
  constraint saved_views_owner_id_id_key unique (owner_id, id)
);

comment on table app.saved_views is
  'One row per saved board query, owned by exactly one user. Read only through '
  'modules/views'' own repository, always scoped WHERE owner_id = <actor>: an actor '
  'naming another owner''s view id gets the same answer an invented id gets (M5-AC16 — '
  '404, never 403).';

comment on column app.saved_views.ast is
  'The validated AST, ADR-0007''s restricted filter grammar compiled by modules/views. '
  'Never raw SQL, never a second grammar — the same shape the board and Notify Me use.';

comment on column app.saved_views.version is
  'ADR-0005 optimistic-concurrency version. view.save is expectedVersion: yes — a '
  'mismatch is a conflict, never a silent overwrite of a deliberate rename.';

-- The read is "this owner's views, oldest first" — `list` is the only query over this
-- table and it is always scoped to one owner. The leading column serves it; created_at
-- makes the ordering an index scan rather than a sort of the owner's rows.
create index saved_views_owner_id_created_at_idx on app.saved_views (owner_id, created_at);

select app.apply_rls_backstop('app.saved_views');
grant select, insert, update, delete on table app.saved_views to app_rw;

--------------------------------------------------------------------------------
-- 2. app.notify_me_queries gains the designation pointer  (D1, ADR-0016)
--------------------------------------------------------------------------------

-- NULL means "this Notify Me query was written directly through views.notifyMe.update
-- and belongs to no saved view" — the pre-existing behaviour, unchanged. Non-NULL means
-- "the bell is lit on this view", which is what the Saved screen renders.
--
-- ⚠ **A composite foreign key, and MATCH SIMPLE is the point.** With a NULL
-- source_view_id the constraint is satisfied outright, so an untied Notify Me query is
-- still legal; with a non-NULL one, BOTH columns must match a saved_views row, so the
-- designation can only ever name a view this same owner owns. Cross-owner designation
-- is refused by the database, not by whichever service happened to remember.
--
-- ⚠ **No ON DELETE clause, deliberately** — this repository has no cascades anywhere,
-- and a cascade here would be the wrong one in both directions. Deleting a view that is
-- currently notifying must *stop the notifications*, because the bell that turned them
-- on lived on the card that just disappeared and there is no other surface to reach it
-- from. `SavedViewRepository#delete` clears the Notify Me row first, inside the same
-- transaction; this constraint is what makes forgetting that a loud failure instead of
-- a silent orphan.
alter table app.notify_me_queries
  add column source_view_id uuid,
  add constraint notify_me_queries_source_view_fkey
    foreign key (owner_id, source_view_id) references app.saved_views (owner_id, id);

comment on column app.notify_me_queries.source_view_id is
  'The app.saved_views row this query was designated from, or NULL when it was written '
  'directly through views.notifyMe.update. D1: there is at most one Notify Me query per '
  'user, so lighting the bell on a second view MOVES the designation rather than adding '
  'one — which is this table''s primary key on owner_id doing the enforcing, not a check '
  'some service performs first.';

--------------------------------------------------------------------------------
-- 3. Sweep (ADR-0002 §3)
--------------------------------------------------------------------------------

-- The baseline's default-privilege revokes already cover objects `app_migrator`
-- creates from here on; this covers the table this migration just created, the same way
-- create_notification_dismissals.sql covers its one.
revoke all on table app.saved_views from anon, authenticated, public;

reset role;
