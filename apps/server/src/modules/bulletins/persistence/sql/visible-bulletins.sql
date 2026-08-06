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
