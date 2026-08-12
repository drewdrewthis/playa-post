-- Soft delete becomes the uniform shape of every user-facing delete, and the rows it
-- leaves behind finally become finite (issue [#169]).
--
-- Two of this product's three deletable things already disagreed with each other:
--
--   * `app.bulletins.archived_at` is a soft delete and always was. Decision D9 renamed
--     the action to "Remove" and deferred "how long soft-deleted rows live" to #169 —
--     this file is where that deferral is answered. **`archived_at` IS the soft-delete
--     column**; nothing is added to that table but the index the sweep reads.
--   * `app.saved_views` hard-deleted. That is the half this migration changes: it gains
--     `deleted_at`, and `SavedViewRepository#delete` becomes an UPDATE.
--   * `app.notes` has no delete at all, deliberately (decision D6's "no lifecycle"
--     corollary, kept by D14). It is therefore **absent from this migration**: there is
--     no user-facing delete to make soft, and a `deleted_at` no mutation ever sets is
--     the column-with-no-writer trap `create_notification_dismissals.sql` names. See
--     decision D17.
--
-- ⚠ **The purge is what makes a soft delete a delete rather than a rename.** Without it,
-- "removed" means "hidden from every read and kept forever", which is the gap issue
-- [#118] raised. `PURGE_RETENTION_DAYS` (default 30) is the window; the sweep itself is
-- `apps/server/src/entrypoints/purge/`, and it is application code rather than a
-- database job because scheduled work in this system is an in-process poller and nothing
-- else (ADR-0006, ADR-0009 — no cron facility, no second service).
--
-- What the purge deletes is **user-deleted state only**. An expired-but-never-removed
-- bulletin is still its author's, so it is untouched here; ADR-0006's own retention
-- chores (pruning `published` outbox rows at fourteen days, `app.mutation_results`
-- daily) are also untouched, and both remain [#118]'s scope — see decision D17 for why
-- they are not folded into this sweep.

-- Everything is created, owned, and granted by `app_migrator`, so the catalog comes out
-- identical whether the runner is a superuser (Testcontainers) or Supabase's
-- non-superuser `postgres`.
set role app_migrator;

--------------------------------------------------------------------------------
-- 1. app.saved_views gains a soft delete
--------------------------------------------------------------------------------

-- Nullable, and absence — not a sentinel, not an `is_deleted boolean` beside it — is the
-- live state, for the reason `app.bulletins.archived_at` states in full: two
-- representations of one fact means the second one to be updated is the one some read
-- believed. The two columns are deliberately spelled differently rather than renamed to
-- match, because `archived_at` is on the wire (`archivedAt`, `bulletin.archive`, stored
-- offline mutations) and D9 already refused to churn that for a name.
--
-- ⚠ **Every read of this table now carries `deleted_at is null`.** That is not a
-- convention: `modules/views/persistence/postgres-saved-view.repository.ts` is the only
-- file in the repository allowed to name `app.saved_views`, so the predicate lives in
-- five statements in one file and nowhere else. There is no partial unique index to add
-- beside it — this table has never constrained `(owner_id, name)`, so a soft-deleted row
-- cannot block re-saving a view under the same name.
alter table app.saved_views add column deleted_at timestamptz;

comment on column app.saved_views.deleted_at is
  'NULL means live. A non-NULL value is the instant views.saved.delete removed it: the '
  'row is absent from every read (all of them scoped WHERE owner_id = <actor> AND '
  'deleted_at IS NULL) and is hard-deleted by the purge once it is older than '
  'PURGE_RETENTION_DAYS. Deleting a view still clears its Notify Me designation outright '
  'in the same transaction — a bell whose card is gone has no off-switch left (D16).';

-- Serves the purge's sweep and nothing else, which is why it is partial: the predicate
-- `deleted_at < <cutoff>` reads only rows that have been deleted, and those are a small
-- minority of a table every *other* read filters them out of. A full index on the column
-- would carry an entry per live view to answer a question no live view is ever part of.
create index saved_views_deleted_at_idx
  on app.saved_views (deleted_at)
  where deleted_at is not null;

--------------------------------------------------------------------------------
-- 2. app.bulletins — the soft delete is already there; the sweep needs an index
--------------------------------------------------------------------------------

-- No column is added. `archived_at` has been the soft delete since
-- `create_bulletins.sql`, and this migration's only claim about it is that it is now
-- *swept*. Partial for the same reason as the index above, and it matters more here:
-- `app.bulletins` is the largest table this product grows, and a removed bulletin is a
-- small fraction of it.
create index bulletins_archived_at_idx
  on app.bulletins (archived_at)
  where archived_at is not null;

--------------------------------------------------------------------------------
-- 3. The two dependents a purged bulletin takes with it  (ADR-0002 B9/M2-AC10)
--------------------------------------------------------------------------------

-- ⚠ **The first `ON DELETE` clause in this repository, and it is a considered exception
-- rather than a change of policy.** `create_saved_views.sql` states the rule it is an
-- exception to: no cascades, because deleting a saved view that is currently notifying
-- has to *stop the notifications* — a user-visible act with an outbox event — and a
-- cascade would perform it silently and unobservably.
--
-- Neither of these two tables is like that. A report and a dismissal are facts *about
-- one bulletin*, with no meaning once it is gone, no user-visible consequence to
-- removing them, and no event anybody consumes. What they do have is a `NOT NULL`
-- foreign key with no cascade, which makes them the thing that would refuse the purge's
-- DELETE — permanently, and quietly, since a wedged sweep looks exactly like an empty
-- one.
--
-- The alternative was to pre-delete them from the purge, and it is worse in the way this
-- architecture cares about: these are `modules/moderation`'s tables, so a statement in
-- `modules/bulletins`' persistence naming them is precisely the cross-module reach-in
-- addendum §19 forbids. Expressed as a constraint, "a report cannot outlive its
-- bulletin" is enforced by the database for every future deleter, rather than by
-- whichever sweep remembered.
--
-- ⚠ **This does not widen what any actor can delete.** Nothing but the purge deletes an
-- `app.bulletins` row — `bulletin.archive` is an UPDATE — so the only statement these
-- clauses can fire from is the one in
-- `modules/bulletins/persistence/postgres-bulletin-purge.repository.ts`. In particular
-- `moderation.undismiss` still deletes one dismissal by `(bulletin_id, viewer_id)` and
-- can still never reach a report (B13).
--
-- PostgreSQL has no `ALTER CONSTRAINT ... ON DELETE`, so each is dropped and re-added
-- under the same auto-generated name it already had.
alter table app.bulletin_reports
  drop constraint bulletin_reports_bulletin_id_fkey;

alter table app.bulletin_reports
  add constraint bulletin_reports_bulletin_id_fkey
    foreign key (bulletin_id) references app.bulletins (id) on delete cascade;

alter table app.bulletin_dismissals
  drop constraint bulletin_dismissals_bulletin_id_fkey;

alter table app.bulletin_dismissals
  add constraint bulletin_dismissals_bulletin_id_fkey
    foreign key (bulletin_id) references app.bulletins (id) on delete cascade;

comment on table app.bulletin_reports is
  'One row per reporter/bulletin pair. Hides the bulletin from reporter_id only '
  '(M2-AC10/AC11) and is never joined against by any read the bulletin''s author can '
  'reach — that is the whole privacy property (B9). Cascades away when the purge '
  'hard-deletes the bulletin it is about (#169): a report is a fact about one bulletin '
  'and outlives nothing.';

comment on table app.bulletin_dismissals is
  'One row per viewer/bulletin pair. Hides the bulletin from viewer_id only '
  '(M2-AC11) — no strike count, no author-visible effect, no aggregation (M5). Cascades '
  'away when the purge hard-deletes the bulletin it is about (#169).';

--------------------------------------------------------------------------------
-- 4. No backstop call, no grant, no sweep  (ADR-0002 §3/§4)
--------------------------------------------------------------------------------

-- Deliberately absent, for the reason `add_intro_via_note.sql` records: this migration
-- creates no table. `app.saved_views`, `app.bulletins`, `app.bulletin_reports` and
-- `app.bulletin_dismissals` each already carry `app.apply_rls_backstop`'s posture, their
-- own `app_rw` grant, and their `revoke all … from anon, authenticated, public` sweep.
-- Table privileges cover columns added later and a policy attaches to the relation
-- rather than to its column list, so all of it survives an ALTER — and calling the
-- backstop again would fail on the existing policy name.

reset role;
