-- Location and expiry on `app.bulletins`, plus the `app.visible_bulletins` predicate
-- that makes an elapsed expiry invisible everywhere at once.
--
-- Two columns and one function. The columns are what the compose screen collects
-- ("Where — e.g. 7:30 & E, Center Camp"; 24h / 3 days / 1 week) and what the board card
-- renders in its `◦ {loc} · {author}` meta line. The function is where expiry becomes a
-- *visibility* rule rather than a column somebody has to remember to filter on — the
-- seam `create_bulletins.sql`'s own scope note reserved for it: "Tags, location, expiry
-- … each arrives as another predicate here rather than as another visibility query
-- somewhere else."

-- Everything is created, owned, and granted by `app_migrator`, so the catalog comes
-- out identical whether the runner is a superuser (Testcontainers) or Supabase's
-- non-superuser `postgres`.
set role app_migrator;

--------------------------------------------------------------------------------
-- 1. app.bulletins gains loc + expires_at
--------------------------------------------------------------------------------

-- ⚠ Both nullable, and both `text`/`timestamptz` with **no check constraint** — the
-- same decision `title`, `body` and `type` already record on this table. The 120-
-- character bound on `loc` lives in modules/bulletins/domain/bulletin-content.ts, where
-- a refusal can carry the stable `BULLETIN_CONTENT_INVALID` code and name the field;
-- as a constraint it would surface as a driver-level 500 with a message written for a
-- DBA. The "must be in the future" rule on `expires_at` likewise lives in
-- bulletin-expiry.policy.ts, and could not be a constraint at all: it is a comparison
-- against the clock at *write* time, which a row-level check would re-evaluate on every
-- later UPDATE and start refusing legitimate archives of expired bulletins.
alter table app.bulletins add column loc text;
alter table app.bulletins add column expires_at timestamptz;

comment on column app.bulletins.loc is
  'Free-text place as the author typed it, at most 120 characters (enforced in '
  'modules/bulletins/domain/bulletin-content.policy.ts). A display string and never a '
  'lookup key: it is deliberately absent from search_document, so bare text can never '
  'become a way to ask who is camped where.';

comment on column app.bulletins.expires_at is
  'NULL means the bulletin never expires. An elapsed expiry is absent from '
  'app.visible_bulletins for everyone, author included — exactly as archived_at is; '
  'the author keeps it through bulletins.listMine, which reads this table directly.';

-- No index. The predicate is evaluated over rows app.visible_bulletins has already
-- narrowed to one viewer's authorized authors, so it filters a handful of rows rather
-- than scanning the table — an index here would cost every write to buy nothing
-- measurable. Revisit if the board's plan ever shows a sequential scan of app.bulletins.

--------------------------------------------------------------------------------
-- 2. app.visible_bulletins, re-installed with loc, expires_at, and the expiry filter
--------------------------------------------------------------------------------

-- ⚠ `drop` first, not `create or replace`: the return type gains two columns, and
-- PostgreSQL refuses to replace a set-returning function whose `returns table` shape
-- changed. Dropping and recreating inside one migration is atomic — no transaction ever
-- observes the function missing.
drop function if exists app.visible_bulletins(uuid);

-- ⚠ Everything between this comment and the closing `$$;` is a **byte-identical
-- copy** of apps/server/src/modules/bulletins/persistence/sql/visible-bulletins.sql,
-- which is the checked-in source ADR-0004:73-74 requires. A migration cannot read a
-- file, and migrations are forward-only, so the copy is the price. It is not left to
-- a reviewer to notice: visible-bulletins-migration.integration.test.ts asserts the
-- checked-in file appears verbatim in exactly one migration and fails the moment the
-- two drift — which is also why `create_bulletins.sql`'s now-superseded copy must
-- never be edited to match this one.
--
-- Changing the function again means editing the module file and shipping a NEW
-- migration carrying the new text. Never edit this one.

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
-- M2 scope: Request bulletins from reachable authors, unarchived and unexpired. Tags,
-- the other six types, dismissals and reports are M5 — each arrives as another
-- predicate here rather than as another visibility query somewhere else.
create or replace function app.visible_bulletins(viewer_id uuid)
returns table (
  bulletin_id         uuid,
  author_id           uuid,
  type                text,
  title               text,
  body                text,
  created_at          timestamptz,
  loc                 text,
  expires_at          timestamptz,
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
         -- Free-text place, projected as written. Deliberately NOT part of
         -- search_document: a location that joined the haystack would make bare text a
         -- way to ask "who is camped at 7:30 & E", which is a people search through the
         -- text channel — the same thing ADR-0007 deviation 1 keeps author names out
         -- for.
         b.loc,
         b.expires_at,
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
     -- Expiry is the same statement about a different clause of the same lifecycle, so
     -- it is the same kind of predicate in the same place. Putting it in the board's
     -- compiled filter instead would leave getById, the notification read-time
     -- re-check, and the moderation actorship check each seeing an expired bulletin —
     -- three surfaces disagreeing with the board about what is live.
     --
     -- `pg_catalog.now()` is the transaction timestamp, which is what keeps this
     -- function `stable`; unqualified it would resolve against whatever search_path the
     -- pooler handed the session, and this one has none (ADR-0002:164).
     and (b.expires_at is null or b.expires_at > pg_catalog.now())
$$;
-- app_rw is the only role that may execute it. Re-granted because the DROP above took
-- the previous grant with it, and the baseline's default-privilege revokes keep PUBLIC
-- out of anything `app_migrator` creates in `app` (ADR-0002 §3).
grant execute on function app.visible_bulletins(uuid) to app_rw;

reset role;
