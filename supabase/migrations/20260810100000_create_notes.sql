-- Notes — the private person-to-person channel (issue #88, decision D6) — plus
-- `app.visible_notes`, the authorized note set every read composes.
--
-- ⚠ **A separate table and a separate function, never a bulletin type.** PDF §6: "A
-- future fixed-recipient private messaging feature… must not be silently mixed into the
-- bulletin model." Decision D2 cut notes from v1 on exactly that reasoning; the owner
-- directive behind #88 reopens the feature and D6 records that the separation is how it
-- is honoured. `note` therefore stays refused by `bulletins.create` — see
-- `bulletin-post-types.feature`'s refusal scenario, which must keep passing.
--
-- The ADR-0002 §4 backstop and the explicit per-table grant are not optional and not
-- hand-written: B3 reads the catalog, so a table that skipped either fails the security
-- suite whether or not the SQL looks right.

-- Everything is created, owned, and granted by `app_migrator`, so the catalog comes
-- out identical whether the runner is a superuser (Testcontainers) or Supabase's
-- non-superuser `postgres`.
set role app_migrator;

--------------------------------------------------------------------------------
-- 1. app.notes  (pin-a-note.feature, issue #88)
--------------------------------------------------------------------------------

create table app.notes (
  id           uuid primary key default pg_catalog.gen_random_uuid(),
  author_id    uuid not null references app.users (id),
  -- Who the note is for, and the whole of its authorization: `app.visible_notes`
  -- returns rows where this equals the viewer, so a note has exactly one reader.
  recipient_id uuid not null references app.users (id),
  body         text not null,
  -- No default, for the reason ADR-0008:29 gives app.users and app.bulletins: the
  -- writer states when the thing happened rather than inheriting whatever moment the
  -- row happened to be inserted at.
  created_at   timestamptz not null,
  -- A note to yourself is not a note — the product statement is "left on somebody
  -- else's board". A CHECK rather than a comment, matching `connections_distinct_
  -- parties` and `connection_trust_distinct_parties`: the pin path already cannot
  -- produce one (it requires the recipient at degree 1 of the author, and nobody is at
  -- degree 1 of themselves), so this constraint is a backstop that can never fire from
  -- the sanctioned path and exists to keep a future second writer honest.
  constraint notes_distinct_parties check (author_id <> recipient_id)
);

comment on table app.notes is
  'One row per private note pinned to a direct connection''s board (issue #88, '
  'decision D6). NOT a bulletin type — PDF section 6 forbids mixing fixed-recipient '
  'messaging into the bulletin model. Every read composes app.visible_notes, which '
  'composes app.visible_people for the author card only; the authorization is '
  'recipient_id = viewer_id.';

comment on column app.notes.recipient_id is
  'The one person who may read this note. Pinning requires them to be a first-degree '
  'connection of the author at write time; reading requires nothing but being them.';

comment on column app.notes.body is
  'The note. Deliberately NOT indexed and NOT part of any tsvector: no query grammar '
  'reaches a note, so a note can never become a way to find people through the '
  'free-text channel. Never written to a log or an outbox payload (ADR-0006).';

-- Every read of this table is "the notes addressed to one person", so recipient_id is
-- the access path. There is deliberately no index on author_id: nothing asks "what have
-- I sent", because a note is a thing you leave, not a thread you keep.
create index notes_recipient_id_idx on app.notes (recipient_id);

select app.apply_rls_backstop('app.notes');
grant select, insert, update, delete on table app.notes to app_rw;

--------------------------------------------------------------------------------
-- 2. app.visible_notes  (ADR-0002 §6/§6a)
--------------------------------------------------------------------------------

-- ⚠ Everything between this comment and the closing `$$;` is a **byte-identical copy**
-- of apps/server/src/modules/notes/persistence/sql/visible-notes.sql, which is the
-- checked-in source ADR-0004:73-74 requires. A migration cannot read a file, and
-- migrations are forward-only, so the copy is the price. It is not left to a reviewer to
-- notice: visible-notes-migration.integration.test.ts asserts the checked-in file appears
-- verbatim in exactly one migration and fails the moment the two drift.
--
-- Changing the function means editing the module file and shipping a NEW migration
-- carrying the new text. Never edit this one **once it has shipped** — that is what
-- forward-only means, and it is the rule for every migration on main. The author-join
-- correction in this file's function was made in place because this migration had never
-- left its own branch: no database anywhere had applied it, so there was no forward to
-- be only. The moment it merges, the sentence above is absolute again.

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
-- ⚠ **The author join is LEFT, and this is the one place notes deliberately part company
-- with app.visible_bulletins.** A bulletin is published outward, to whoever can reach its
-- author, so an author who leaves a viewer's world rightly takes their bulletins with
-- them. A note was addressed to one person and delivered: it is the recipient's. Severing
-- the connection, the author deactivating, or the traversal stopping at its own max_depth
-- or node_budget may each take away the author CARD, and none of them may take away the
-- MESSAGE. A delivered note that vanished off somebody's board because a third party
-- changed a setting would be this product quietly editing what a person was told.
--
-- ⚠ What makes that safe is that **every author column is projected from the authorized
-- set, never from app.notes**. When the LEFT JOIN matches nobody, author_id comes back
-- NULL with the disclosure and the name: `n.author_id` — the real app.users.id of a
-- person the graph has already decided this viewer may not see — is not in the select
-- list at all, so no shape of this result can hand one back. A note therefore arrives
-- with a whole author card or with none, which is exactly what
-- packages/contracts/src/notes.ts promises the client (render no author line, never a
-- reconstructed one).
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
  -- a product rule about notes — which is why a note may not depend on them for its own
  -- survival, and under the LEFT JOIN below it does not.
  with authorized_people as (
    select vp.user_id,
           vp.disclosure,
           vp.display_name,
           vp.handle
      from app.visible_people(viewer_id) vp
  )
  select n.id,
         -- The author, from the authorized set and never from n.author_id. NULL here is
         -- the honest answer to "who wrote this" when the writer is outside this viewer's
         -- world: the note stays, the person does not, and the identifier goes with them.
         p.user_id,
         -- The note itself. Unlike a bulletin's title and body this is never indexed and
         -- never searched: there is no tsvector column on app.notes, so no query grammar
         -- can ever reach a note's text, and a note cannot become a way to find people
         -- through the free-text channel.
         n.body,
         n.created_at,
         -- ADR-0002 §6a, applied at the source. Below `full` the identity columns are
         -- not projected at all, so they never leave the database and no layer above can
         -- forget to strip them. A degree-1 author is reachable at the moment of pinning
         -- — that is what pinning required — but reachable is not the same as disclosed,
         -- and a connection that grants only `limited` still shows up here unnamed.
         --
         -- The `case` is belt-and-braces over app.visible_people, which already withholds
         -- these below `full`. It is kept so a reader of this function can see the §6a
         -- rule being applied, and so a future widening of visible_people's projection
         -- cannot silently widen a note's author card with it.
         p.disclosure,
         case when p.disclosure = 'full' then p.display_name end,
         case when p.disclosure = 'full' then p.handle end
    from app.notes n
    left join authorized_people p on p.user_id = n.author_id
   -- The whole authorization rule, and the reason this function needs no other predicate:
   -- a note has exactly one reader. Because the person join is LEFT, this predicate is
   -- also the only thing standing between a viewer and a row — which is as it should be,
   -- since it is the only thing that was ever deciding readability. The author does not
   -- appear in their own result, which is the product statement PDF §6 asks for — a note
   -- is left on somebody else's board, not posted to a shared one.
   where n.recipient_id = viewer_id
   -- Newest first, inside the function rather than at the caller. There is no query
   -- grammar over notes and no second ordering anyone could want, so ordering here means
   -- every reader gets the same order instead of each repository choosing one.
   order by n.created_at desc, n.id desc
$$;

-- app_rw is the only role that may execute it. The baseline's default-privilege revokes
-- already keep PUBLIC out of anything `app_migrator` creates in `app` (ADR-0002 §3), so
-- this grant adds the one principal that needs it and nothing else.
grant execute on function app.visible_notes(uuid) to app_rw;

--------------------------------------------------------------------------------
-- 3. Sweep (ADR-0002 §3)
--------------------------------------------------------------------------------

revoke all on table app.notes from anon, authenticated, public;

reset role;
