-- app.visible_notes — the one definition of "which notes can this viewer read".
--
-- ADR-0002 §5 (viewer_id passed explicitly), §6 (one composition point) and §6a (one
-- person-projection rule). Issue #88, decision D6.
--
-- ⚠ **A note is not a bulletin, and this is not app.visible_bulletins with a filter.**
-- PDF §6 requires fixed-recipient messaging to stay out of the bulletin model, so notes
-- are their own table, their own function, and their own module. The two functions look
-- alike because they answer the same *shape* of question through the same §6a rule —
-- not because a note is a kind of bulletin.
--
-- ⚠ The authorization predicate is `recipient_id = viewer_id`, and it is complete on its
-- own: a note is addressed, so the authorized set is exactly the notes addressed to you.
-- Reachability decides nothing here. The join to app.visible_people is for the **author
-- card** — who you are allowed to be told wrote it — which is a different question and
-- is answered by composing the canonical function rather than by joining app.users
-- (ADR-0002 §6a: "no direct join to app.users for an author card, ever").
--
-- ⚠ The author join is INNER, so a note from somebody who has left this viewer's world
-- entirely — deactivated, suspended, erased (ADR-0002 B11) — disappears from the list
-- rather than surviving as an unnamed card. A LEFT JOIN would keep the note and withhold
-- the name, which reads kinder and fails open: it would hand back the real
-- app.users.id of a person the graph has already decided this viewer may not see. Notes
-- follow app.visible_bulletins here on purpose, so the system has one answer to "the
-- author is gone" rather than two.
--
-- ⚠ This file is the checked-in source. The migration that installs it carries a
-- byte-identical copy of the statement below (a migration is forward-only and cannot
-- read a file), and visible-notes-migration.integration.test.ts asserts the two have not
-- drifted. Changing the function means editing this file and shipping a NEW migration
-- carrying the new text — never editing the old one.
--
-- SECURITY INVOKER (ADR-0004:25): it must run as app_rw, so it can never become a
-- second, unreviewed privilege-escalation surface the way a SECURITY DEFINER function
-- would (ADR-0002 B4).
--
-- SET search_path = '' (ADR-0002:164): under a transaction-mode pooler this function
-- can be handed to a session whose search_path means something else, and every
-- unqualified identifier inside it would change meaning with it.
create or replace function app.visible_notes(viewer_id uuid)
returns table (
  note_id             uuid,
  author_id           uuid,
  body                text,
  created_at          timestamptz,
  author_disclosure   text,
  author_display_name text,
  author_handle       text
)
language sql
stable
security invoker
set search_path = ''
as $$
  -- The authorized-person set, taken whole from the canonical function. Its columns are
  -- consumed exactly as given: this query decides *which notes* are readable and never
  -- re-decides *how much of a person* is (ADR-0004 decision 3).
  --
  -- max_depth and node_budget are left to the function's own defaults, exactly as
  -- app.visible_bulletins leaves them. They are operational bounds on the traversal, not
  -- a product rule about notes.
  with authorized_people as (
    select vp.user_id,
           vp.disclosure,
           vp.display_name,
           vp.handle
      from app.visible_people(viewer_id) vp
  )
  select n.id,
         n.author_id,
         -- The note itself. Unlike a bulletin's title and body this is never indexed and
         -- never searched: there is no tsvector column on app.notes, so no query grammar
         -- can ever reach a note's text, and a note cannot become a way to find people
         -- through the free-text channel.
         n.body,
         n.created_at,
         -- ADR-0002 §6a, applied at the source. Below `full` the identity columns are
         -- not projected at all, so they never leave the database and no layer above can
         -- forget to strip them. A degree-1 author is reachable by construction — that
         -- is what pinning required — but reachable is not the same as disclosed, and a
         -- connection that grants only `limited` still shows up here unnamed.
         --
         -- The `case` is belt-and-braces over app.visible_people, which already withholds
         -- these below `full`. It is kept so a reader of this function can see the §6a
         -- rule being applied, and so a future widening of visible_people's projection
         -- cannot silently widen a note's author card with it.
         p.disclosure,
         case when p.disclosure = 'full' then p.display_name end,
         case when p.disclosure = 'full' then p.handle end
    from app.notes n
    join authorized_people p on p.user_id = n.author_id
   -- The whole authorization rule, and the reason this function needs no other predicate:
   -- a note has exactly one reader. The author does not appear in their own result, which
   -- is the product statement PDF §6 asks for — a note is left on somebody else's board,
   -- not posted to a shared one.
   where n.recipient_id = viewer_id
   -- Newest first, inside the function rather than at the caller. There is no query
   -- grammar over notes and no second ordering anyone could want, so ordering here means
   -- every reader gets the same order instead of each repository choosing one.
   order by n.created_at desc, n.id desc
$$;
