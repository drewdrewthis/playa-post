-- `app.notify_me_queries` stops being one row per person (issue #172).
--
-- ⚠ **This migration reopens product decision D1.** D1 read the PDF's "one special saved
-- query called Notify Me" against the prototype's per-view bell and resolved it in the
-- PDF's favour: "exactly one Notify Me query per user", expressed here as the primary key
-- on `owner_id` (ADR-0007:79, ADR-0016 D1) so that a second notifying query was a row the
-- database could not hold rather than a rule a service had to remember. The owner has
-- since asked for the other behaviour — "you should be able to enable multiple
-- notifications at once" — and **decision D16 supersedes the single-query half of D1**.
-- Everything else D1 settled stands: the bell is still a *designation* pointing at a saved
-- view, `app.saved_views` still carries no notify flag, and `app.notify_me_queries` is
-- still the sole answer to "who gets notified".
--
-- What changes is only *how many* answers it may hold per person, and therefore what its
-- key is:
--
--   before: primary key (owner_id)
--   after:  primary key (id), unique nulls not distinct (owner_id, source_view_id)
--
-- The unique constraint is the new invariant and it says two things at once:
--
--   * **one query per (owner, view)** — lighting a bell that is already lit is still an
--     upsert onto the same row, so a double tap cannot produce two notifications for one
--     card;
--   * **one untied query per owner** — `NULLS NOT DISTINCT` (PostgreSQL 15+, and this
--     repository pins 17) makes two `NULL` `source_view_id`s collide rather than count as
--     distinct, which keeps `views.notifyMe.update` addressable with no identifier at all.
--     That procedure names no row: the actor *is* the address, and after this migration
--     the address is "your query that belongs to no view". Without `NULLS NOT DISTINCT` a
--     person could accumulate untied queries none of which any procedure could name again.
--
-- ⚠ **Data-preserving, and that is the whole design of the statement order below**
-- (issue #172 AC3). Every existing row keeps its `owner_id`, `source_text`, `ast`,
-- `ast_version`, `version`, `updated_at` and — the part that matters to a person — its
-- `source_view_id`, so somebody who had the bell lit on a view before this ran still has
-- it lit on that view afterwards. Nothing is dropped but a constraint, nothing is
-- rewritten but the addition of a defaulted column, and no row is deleted or re-inserted.
-- A pre-existing row is legal under the new key by construction: one row per owner is a
-- subset of one row per (owner, view).
--
-- The per-owner *cap* that bounds the evaluator's read cost is deliberately NOT here. It
-- is `NOTIFY_ME_QUERY_LIMIT_PER_OWNER` in `modules/views/domain/notify-me-query.ts`,
-- counted inside the write's transaction — the same shape and the same trade
-- `SAVED_VIEW_LIMIT_PER_OWNER` records (ADR-0016 D3): a bound that stops a list growing
-- without limit, not a constraint anything depends on, and raisable as a one-constant
-- change with no migration. See decision D16 for why the number is not 24.

-- Everything is created, owned, and granted by `app_migrator`, so the catalog comes out
-- identical whether the runner is a superuser (Testcontainers) or Supabase's
-- non-superuser `postgres`.
set role app_migrator;

--------------------------------------------------------------------------------
-- 1. A surrogate key, because the aggregate is now the query rather than the person
--------------------------------------------------------------------------------

-- ⚠ Added **before** the old primary key is dropped, and with a volatile default, so the
-- backfill is what PostgreSQL does on its own: `gen_random_uuid()` is evaluated per row,
-- giving every stored query a distinct identity without a single UPDATE of ours.
--
-- `id` exists because `app.outbox_events.aggregate_id` is one `uuid` column and the thing
-- these events are about has changed. It was the owner while a person had at most one
-- query; now that they may have several, an event routed on `owner_id` could not say
-- *which* query changed or was cleared, and "somebody's notifications changed" is not a
-- fact a consumer can order or act on. It is not on the wire: clients speak in the view
-- ids the bells sit on (`notifyingViewIds`), never in this.
alter table app.notify_me_queries
  add column id uuid not null default pg_catalog.gen_random_uuid();

comment on column app.notify_me_queries.id is
  'The aggregate identity of one saved Notify Me query (D16). Server-internal: it is what '
  'app.outbox_events.aggregate_id carries for NotifyMeQueryChanged/Cleared, and it never '
  'reaches a client — the API names a designation by the saved view its bell sits on.';

--------------------------------------------------------------------------------
-- 2. The key swap  (D16, reopening D1)
--------------------------------------------------------------------------------

-- Dropping the constraint, not the column: `owner_id` keeps its NOT NULL and its
-- `references app.users (id)`. The `set not null` below is belt and braces — PostgreSQL
-- leaves the attribute's NOT NULL in place when a primary key is dropped — written out so
-- a reader of this file does not have to know that to trust the result.
alter table app.notify_me_queries
  drop constraint notify_me_queries_pkey;

alter table app.notify_me_queries
  alter column owner_id set not null;

alter table app.notify_me_queries
  add constraint notify_me_queries_pkey primary key (id);

-- ⚠ **This is D16 as a database constraint, exactly as the owner_id key was D1's.** The
-- two write paths onto this table each name a row through it and neither can reach the
-- other's: `views.saved.setNotify` upserts on `(owner_id, <this view>)`, and
-- `views.notifyMe.update` writes `(owner_id, NULL)`. Toggling one bell therefore cannot
-- disturb another (#172 AC2) because the statements cannot address the same row.
alter table app.notify_me_queries
  add constraint notify_me_queries_owner_id_source_view_id_key
    unique nulls not distinct (owner_id, source_view_id);

-- The dropped primary key took its index with it, and every read of this table is either
-- "this owner's queries" (`listFor`, the designation reads, the cap count) or a full scan
-- filtered by `ast_version` (the evaluator's `findAllCurrent`). The unique constraint's
-- index leads with `owner_id`, so the first set is served without a second index; the
-- evaluator's scan wanted none before this migration and wants none after it.

--------------------------------------------------------------------------------
-- 3. What the table now means
--------------------------------------------------------------------------------

comment on table app.notify_me_queries is
  'One row per saved Notify Me query. At most one per (owner, saved view) plus at most '
  'one untied query per owner, enforced by notify_me_queries_owner_id_source_view_id_key '
  '(D16, which supersedes D1''s "exactly one query per user" and the primary key on '
  'owner_id that expressed it). EvaluateNotifyMeHandler reads ast/ast_version on every '
  'BulletinCreated and matches a recipient at most once per bulletin however many of '
  'their queries match; never re-parses source_text on the hot path.';

comment on column app.notify_me_queries.source_view_id is
  'The app.saved_views row this query was designated from, or NULL when it was written '
  'directly through views.notifyMe.update. D16: a person may light the bell on several '
  'views at once, so this is what tells their queries apart — one row per (owner, view), '
  'with the NULL row reserved for the query that belongs to no view. Cross-owner '
  'designation is refused by notify_me_queries_source_view_fkey, which is unchanged.';

comment on column app.notify_me_queries.version is
  'ADR-0005 optimistic-concurrency version, per query rather than per person (D16). '
  'notifyMe.update is expectedVersion: yes and addresses the untied row — a mismatch is a '
  'conflict, never a silent overwrite of a deliberate change.';

reset role;
