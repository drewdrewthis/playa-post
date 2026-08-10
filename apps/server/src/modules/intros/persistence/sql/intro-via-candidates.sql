-- app.intro_via_candidates — the one definition of "who could introduce me to them".
--
-- ADR-0002 §5 (viewer_id passed explicitly), §6 (one composition point) and §6a (one
-- person-projection rule). Issue #89.
--
-- An intro travels exactly one hop: the target stands at degree 2, and a candidate via
-- is somebody standing between them — directly connected to the requester on one side
-- and to the target on the other.
--
-- ⚠ **Both sides compose `app.visible_people`; neither re-derives reachability.** The
-- requester side is obvious (`app.visible_people(requester_id)` decides who they can see
-- and how far away the target is). The target side is the one that looks like a question
-- about `app.connections` and is not: "who is directly connected to the target" is
-- `app.visible_people(target_id)` at degree 1, because degree 1 always clears a person's
-- own `visible_to_distance` floor (the function's `else 1` case) and the composition
-- inherits the person lifecycle for free — a deactivated, suspended or erased via is
-- absent from the function and therefore is not a candidate (ADR-0002 B11). Joining
-- `app.connections` here instead would be a second definition of reachability living in
-- the one module whose whole job is putting two strangers in touch, and
-- `sql-table-ownership` would need a cross-module grant to permit it.
--
-- ⚠ **This function discloses nothing `graph.list` did not.** Every row it returns is
-- already a first-degree person on the requester's own graph, and it returns rows only
-- when the target is already on that graph at degree 2. The target's own
-- `visible_to_distance` drops them out of `app.visible_people` before this function sees
-- them, so a person you cannot see cannot be introduced to you, for free.
--
-- ⚠ An empty result is the answer to every refusal — the target is at degree 1, at
-- degree 3 or beyond, absent, deactivated, the requester themselves, or hidden by their
-- own reach setting. Nothing here distinguishes them, which is what keeps
-- `intros.viaCandidates` from becoming the user-existence oracle ADR-0002 §10 forbids.
--
-- ⚠ This file is the checked-in source. The migration that installs it carries a
-- byte-identical copy of the statement below (a migration is forward-only and cannot
-- read a file), and intro-requests-migration.integration.test.ts asserts the two have
-- not drifted. Changing the function means editing this file and shipping a NEW
-- migration carrying the new text — never editing the old one.
--
-- SECURITY INVOKER (ADR-0004:25): it must run as app_rw, so it can never become a
-- second, unreviewed privilege-escalation surface the way a SECURITY DEFINER function
-- would (ADR-0002 B4).
--
-- SET search_path = '' (ADR-0002:164): under a transaction-mode pooler this function
-- can be handed to a session whose search_path means something else, and every
-- unqualified identifier inside it would change meaning with it.
create or replace function app.intro_via_candidates(requester_id uuid, target_id uuid)
returns table (
  via_id       uuid,
  disclosure   text,
  display_name text,
  handle       text
)
language sql
stable
security invoker
set search_path = ''
as $$
  -- The requester's own world, two hops wide. `max_depth => 2` changes no answer — a
  -- shortest path of one or two hops is found by a two-hop traversal — it only stops the
  -- recursion doing work whose rows this function would discard.
  --
  -- ⚠ The node budget is deliberately far above the function's own default of 1500, for
  -- the reason `postgres-note.repository.ts` gives its membership check: the default
  -- bounds a *display* read, where ordering by (degree, person_id) and truncating is a
  -- reasonable answer. Here a truncated set would refuse a legitimate intro because of
  -- where somebody's UUID sorts, which is an availability bug wearing a privacy costume.
  with requester_world as (
    select vp.user_id,
           vp.degree,
           vp.disclosure,
           vp.display_name,
           vp.handle
      from app.visible_people(requester_id, 2, 1000000) vp
  ),
  -- The gate. Exactly degree 2: degree 1 needs no introduction, and degree 3 or beyond
  -- is more than one hop — an intro chain nobody in it consented to.
  target_at_second_degree as (
    select 1
      from requester_world w
     where w.user_id = target_id
       and w.degree = 2
  ),
  -- The target's own direct connections, taken from the canonical function rather than
  -- from `app.connections`. At degree 1 the reach filter cannot bind, so this set is
  -- exactly "the target's active accepted connections" — and stays that way if the
  -- person rules gain a term (blocking prunes here the day it lands, with nothing to
  -- change in this file).
  target_direct as (
    select vp.user_id
      from app.visible_people(target_id, 1, 1000000) vp
     where vp.degree = 1
  )
  select w.user_id,
         -- ADR-0002 §6a, carried through from the projection rather than recomputed. The
         -- candidate is projected as the REQUESTER sees them, because the requester is
         -- who reads this list — a via who discloses only `limited` arrives unnamed, and
         -- the sheet renders a no-name chip rather than an id or an initial.
         w.disclosure,
         w.display_name,
         w.handle
    from requester_world w
    join target_direct t on t.user_id = w.user_id
   -- Degree 1 on the requester's side. This is also what excludes the requester
   -- themselves (degree 0) and the target (degree 2), so the three-party distinctness the
   -- table's CHECK backstops is decided here, by the same predicate that decides
   -- everything else, with no separate test to forget.
   where w.degree = 1
     and exists (select 1 from target_at_second_degree)
   -- Ordered inside the function rather than at the caller: there is no second ordering
   -- anybody could want for a chip row, so every reader gets the same one.
   order by w.user_id
$$;
