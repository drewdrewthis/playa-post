-- Lane L3a's table — `app.bulletins` — plus `app.visible_bulletins`, the authorized
-- bulletin set every board, saved view, Notify Me evaluation and single-bulletin fetch
-- composes (ADR-0002 §6, ADR-0004:75-77).
--
-- One migration carrying the lane's table, per the lane-brief C1a carve-out. The
-- ADR-0002 §4 backstop and the explicit per-table grant are not optional and not
-- hand-written: B3 reads the catalog, so a table that skipped either fails the
-- security suite whether or not the SQL looks right.

-- Everything is created, owned, and granted by `app_migrator`, so the catalog comes
-- out identical whether the runner is a superuser (Testcontainers) or Supabase's
-- non-superuser `postgres`.
set role app_migrator;

--------------------------------------------------------------------------------
-- 1. app.bulletins  (plan M2.8, bulletin-request-lifecycle.feature)
--------------------------------------------------------------------------------

-- M2 stores one type — Request — and the column is still `text` rather than an enum
-- or a check constraint, matching app.users.status and app.invitations.status: an
-- unrecognised value must fail CLOSED in the application (nothing but the seven PDF
-- types is creatable or filterable) rather than loudly in a constraint the reader has
-- to go find. ADR-0007's `type:` grammar validates against the enum on the way in.
create table app.bulletins (
  id          uuid primary key default pg_catalog.gen_random_uuid(),
  author_id   uuid not null references app.users (id),
  type        text not null,               -- one of ADR-0007's seven PDF types; M2 writes only 'request'
  title       text not null,
  body        text not null,
  -- Lifecycle timestamps. `created_at` has no default for the reason ADR-0008:29
  -- gives app.users: the writer states when the thing happened rather than inheriting
  -- whatever the row happened to be inserted at.
  created_at  timestamptz not null,
  -- ⚠ Nullable, and absence — not a sentinel — is the unarchived state. A
  -- `default 'infinity'` or an `is_archived boolean` beside it would be two
  -- representations of one fact, and the second one to be updated would be the
  -- one a visibility query read.
  archived_at timestamptz,
  -- ADR-0005 conflict handling. `bulletin.create` and `bulletin.archive` are both
  -- `expectedVersion: no` in the ADR's matrix, so nothing in M2 compares this value —
  -- the column exists because `bulletin.update` (M5) is `expectedVersion: yes` and a
  -- version a row has never carried cannot be compared against retroactively.
  -- Archiving bumps it, so an M5 update racing an archive conflicts rather than
  -- resurrecting an archived bulletin (ADR-0005 precedence rule 5).
  version     int not null default 1,
  -- ADR-0007's free-text index, generated rather than maintained: a trigger or an
  -- application-side write is a second place for title and body to disagree with what
  -- search matches. `simple` rather than `english` because the corpus is short,
  -- multilingual camp shorthand where stemming does more harm than good.
  --
  -- ⚠ Title and body ONLY. Author name is deliberately not in the haystack — ADR-0007
  -- deviation 1: including it makes bare text a people search through the text
  -- channel, which PDF §3/§4 forbid.
  search_document tsvector generated always as (
    pg_catalog.to_tsvector('simple', title || ' ' || body)
  ) stored
);

comment on table app.bulletins is
  'One row per bulletin. Visibility is never read from here directly — every viewer-'
  'scoped read composes app.visible_bulletins, which composes app.visible_people '
  '(ADR-0002 section 6, ADR-0004:75-77). The one sanctioned direct read is the '
  'author''s own list, where the authorized set is trivially the author.';

comment on column app.bulletins.archived_at is
  'NULL means live. Archived bulletins are absent from app.visible_bulletins for '
  'everyone, author included; the author keeps them through bulletins.listMine, which '
  'reads this table by author_id (M2-AC12).';

comment on column app.bulletins.version is
  'ADR-0005 optimistic-concurrency version. Unused by M2''s two mutations (both '
  '`expectedVersion: no`); required so bulletin.update (M5) has a version to compare.';

-- app.visible_bulletins joins on author_id, and bulletins.listMine filters on it.
create index bulletins_author_id_idx on app.bulletins (author_id);

-- ADR-0007: "a Postgres generated tsvector column ... with a GIN index".
create index bulletins_search_document_idx on app.bulletins using gin (search_document);

select app.apply_rls_backstop('app.bulletins');
grant select, insert, update, delete on table app.bulletins to app_rw;

--------------------------------------------------------------------------------
-- 2. app.visible_bulletins  (ADR-0004:75-77, m2-lane-briefs.md §L3a, M2.8/M2.9)
--------------------------------------------------------------------------------

-- ⚠ Everything between this comment and the closing `$$;` is a **byte-identical
-- copy** of apps/server/src/modules/bulletins/persistence/sql/visible-bulletins.sql,
-- which is the checked-in source ADR-0004:73-74 requires. A migration cannot read a
-- file, and migrations are forward-only, so the copy is the price. It is not left to
-- a reviewer to notice: visible-bulletins-migration.integration.test.ts asserts the
-- checked-in file appears verbatim in exactly one migration and fails the moment the
-- two drift.
--
-- Changing the function means editing the module file and shipping a NEW migration
-- carrying the new text. Never edit this one.

-- app.visible_bulletins — the one definition of "which bulletins can this viewer see".
--
-- ADR-0004:75-77, ADR-0002 §5 (viewer_id passed explicitly), §6 (one composition
-- point) and §6a (one person-projection rule); m2-lane-briefs.md §L3a.
--
-- ⚠ It **composes** app.visible_people rather than re-deriving reachability. Joining
-- the connections table here would be a second, subtly different answer to "who can
-- this viewer reach" — R2, the plan's only Critical-severity risk — and the board
-- would drift from the graph the first time either changed. The
-- sql-table-ownership fitness rule is what stops that mechanically: modules/bulletins'
-- SQL may name app.bulletins and a sanctioned app.visible_* call, and nothing else.
--
-- ⚠ This file is the checked-in source. The migration that installs it carries a
-- byte-identical copy of the statement below (a migration is forward-only and cannot
-- read a file), and visible-bulletins-migration.integration.test.ts asserts the two
-- have not drifted. Changing the function means editing this file and shipping a NEW
-- migration carrying the new text — never editing the old one.
--
-- SECURITY INVOKER (ADR-0004:25): it must run as app_rw, so it can never become a
-- second, unreviewed privilege-escalation surface the way a SECURITY DEFINER function
-- would (ADR-0002 B4).
--
-- SET search_path = '' (ADR-0002:164): under a transaction-mode pooler this function
-- can be handed to a session whose search_path means something else, and every
-- unqualified identifier inside it would change meaning with it.
--
-- M2 scope: Request bulletins from reachable authors. Tags, location, expiry, the
-- other six types, dismissals and reports are M5 — each arrives as another predicate
-- here rather than as another visibility query somewhere else.
create or replace function app.visible_bulletins(viewer_id uuid)
returns table (
  bulletin_id         uuid,
  author_id           uuid,
  type                text,
  title               text,
  body                text,
  created_at          timestamptz,
  version             int,
  author_disclosure   text,
  author_display_name text,
  author_handle       text,
  search_document     tsvector
)
language sql
stable
security invoker
set search_path = ''
as $$
  -- The authorized-person set, taken whole from the canonical function. Its columns
  -- are consumed exactly as given: this query decides *which bulletins* are visible
  -- and never re-decides *how much of a person* is (ADR-0004 decision 3).
  with authorized_people as (
    select vp.user_id,
           vp.disclosure,
           vp.display_name,
           vp.handle
      from app.visible_people(viewer_id) vp
  )
  select b.id,
         b.author_id,
         b.type,
         b.title,
         b.body,
         b.created_at,
         b.version,
         -- ADR-0002 §6a, applied at the source. A bulletin can be legitimately
         -- visible while its author is not: visibility follows reachability, identity
         -- follows the author's own disclosure setting. Below `full` the identity
         -- columns are not projected at all, so they never leave the database and no
         -- layer above can forget to strip them.
         --
         -- The `case` is belt-and-braces over app.visible_people, which already
         -- withholds these below `full`. It is kept because a caller reading this
         -- function has to be able to see the §6a rule being applied, and because a
         -- future widening of visible_people's projection must not silently widen the
         -- board's author card with it.
         p.disclosure,
         case when p.disclosure = 'full' then p.display_name end,
         case when p.disclosure = 'full' then p.handle end,
         -- ADR-0007's free-text haystack: title and body only. Author name is
         -- deliberately absent — including it would make bare text a people search
         -- through the text channel, which the PDF forbids and which ADR-0007 names
         -- as deviation 1 from the prototype.
         b.search_document
    from app.bulletins b
    join authorized_people p on p.user_id = b.author_id
   -- Archived is gone for everybody who reads through this function, author included.
   -- Retention lives on the author's own list (bulletins.listMine), which reads the
   -- table directly, so "still mine, archived" and "visible to a viewer" stay two
   -- questions with two answers instead of one answer with an exception (M2-AC12).
   where b.archived_at is null
$$;
-- app_rw is the only role that may execute it. The baseline's default-privilege
-- revokes already keep PUBLIC out of anything `app_migrator` creates in `app`
-- (ADR-0002 §3), so this grant adds the one principal that needs it and nothing else.
grant execute on function app.visible_bulletins(uuid) to app_rw;

--------------------------------------------------------------------------------
-- 3. Sweep (ADR-0002 §3)
--------------------------------------------------------------------------------

-- The baseline's default-privilege revokes already cover objects `app_migrator`
-- creates from here on; this covers the table this migration just created, the same
-- way create_connections_and_outbox covers its five.
revoke all on table app.bulletins from anon, authenticated, public;

reset role;
