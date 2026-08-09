-- Multi-hop visibility, and the setting that bounds it.
--
-- Two changes that only make sense together:
--
-- 1. `app.visible_people` stops clamping the traversal to one hop. ADR-0004 decision 2
--    says there is no product depth cap and that `max_depth` is an operational safety
--    bound; the `least(max_depth, 1)` installed by 20260805234326 was M2's feature scope,
--    which the ADR said M5 would delete rather than raise. It is deleted here.
--
-- 2. `app.users` gains `visible_to_distance` — the person's own answer to "who can see me
--    at all", enforced inside the same function. Without it, lifting the cap would put
--    every person in the network into every other person's result with no way to opt out.
--
-- ⚠ **Known, accepted deviation from ADR-0004 decision 4.** Ghost surrogate IDs are still
-- not implemented, so a `topology_only` person is returned carrying their real
-- `app.users.id` and is correlatable across views. Before the cap was lifted this only
-- reached first-degree connections the viewer already knew; it now reaches everyone within
-- `max_depth` who has not narrowed their own setting. The product owner was shown this
-- specific trade and took it deliberately to get multi-hop visibility into alpha. It is
-- recorded here so the next reader finds a decision rather than a bug. Closing it is M5 B1.
--
-- Forward-only: 20260805234326 keeps its original text and is never edited. This migration
-- carries the new body, and visible-people-migration.integration.test.ts asserts the
-- checked-in modules/graph/persistence/sql/visible-people.sql appears verbatim in exactly
-- one migration — which, once this lands, is this one.

-- `text` with a check constraint rather than an enum: ADR-0012 §2 already models
-- disclosure as a text vocabulary, and widening a check constraint is a plain DDL
-- statement where widening an enum is a type change other objects depend on.
--
-- `default 'anyone'` is a product decision, not a neutral one. The prototype's dial
-- defaults to a narrower setting, but this column lands on an existing network whose
-- members never chose anything — and silently hiding people who had been visible would
-- read as data loss rather than as privacy. New accounts start open and narrow by choice;
-- when real users arrive that default deserves revisiting.
alter table app.users
  add column visible_to_distance text not null default 'anyone';

-- Named, so a future migration can widen it by name rather than by hunting for a
-- system-generated constraint. The four values are the dial in design/Playa Post.dc.html,
-- least-restrictive last so the ordering reads as distance.
alter table app.users
  add constraint users_visible_to_distance_check
  check (visible_to_distance in ('first', 'second', 'third', 'anyone'));

-- app.visible_people — the one definition of "who can this viewer reach".
--
-- ADR-0004 decisions 1-8, ADR-0002 §5 (viewer_id passed explicitly), §6 (one
-- composition point) and §6a (one person-projection rule). Every other read that
-- needs a person — the board's author card, a notification recipient, search — must
-- compose this function rather than join app.users itself. That rule is what the
-- sql-table-ownership fitness rule polices; this file is the single sanctioned
-- exception, recorded in tests/fitness/sql-table-ownership-allowlist.json.
--
-- ⚠ This file is the checked-in source. The migration that installs it carries a
-- byte-identical copy of the statement below (a migration is forward-only and cannot
-- read a file), and visible-people-migration.integration.test.ts asserts the two have
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
--
-- Scope: the viewer plus every person reachable within `max_depth`, minus anyone whose
-- own `visible_to_distance` setting puts this viewer too far away to see them at all.
--
-- ⚠ **Ghost surrogate IDs (ADR-0004 decision 4) are still not implemented, and the depth
-- cap that used to hide the problem is gone.** A `topology_only` person is returned with
-- their real `app.users.id`, so a client holding two views of the network can correlate a
-- hidden person against a named one. The product owner was shown this trade and accepted
-- it explicitly for alpha in order to get multi-hop visibility now; it is a known,
-- documented deviation from decision 4, not an oversight. `path_via`, `mutual_count` and
-- truncation reporting remain unimplemented (M5 B1/B2).
--
-- What *is* enforced is `visible_to_distance`: a person beyond their own limit is absent
-- from the result entirely rather than present as an unnamed node, which is the weaker
-- half of decision 4 doing the work the surrogate would otherwise do.
create or replace function app.visible_people(
  viewer_id uuid,
  max_depth int default 4,
  node_budget int default 1500
)
returns table (
  user_id      uuid,
  degree       int,
  disclosure   text,
  display_name text,
  handle       text,
  trust        int
)
language sql
stable
security invoker
set search_path = ''
as $$
  with recursive
  -- Every accepted connection as two directed edges, because a connection is
  -- undirected but a traversal is not. `target_discloses_to_source` is the level the
  -- person at the far end grants the person at the near end — which is exactly what
  -- decides disclosure for a viewer standing at the near end (ADR-0004 decision 3:
  -- disclosure follows the *target's* settings, never the viewer's wishes).
  edge as (
    select c.user_a_id as source_id,
           c.user_b_id as target_id,
           c.b_discloses_to_a_level as target_discloses_to_source
      from app.connections c
     where c.status = 'accepted'
     union all
    select c.user_b_id,
           c.user_a_id,
           c.a_discloses_to_b_level
      from app.connections c
     where c.status = 'accepted'
  ),
  -- The traversal itself, seeded at the viewer.
  --
  -- ⚠ Pruning happens INSIDE the recursive term, never as a post-filter (ADR-0004
  -- decision 1). A blocked person must not be traversable at all, or a path routes
  -- *through* them and their existence leaks from the shape of the result even though
  -- their row was filtered out. Blocking itself is M5; the seam is the `where` below,
  -- which gains `and not exists (... block ...)` and nothing else has to move.
  traversal as (
    select viewer_id as person_id, 0 as degree
     union
    select e.target_id, t.degree + 1
      from traversal t
      join edge e on e.source_id = t.person_id
     -- `max_depth` alone, as ADR-0004 decision 2 always intended: an operational safety
     -- bound, never a product depth cap. The `least(max_depth, 1)` that used to sit here
     -- was M2's feature scope, and the ADR said M5 would delete it rather than raise the
     -- default — so it is deleted rather than raised.
     --
     -- ⚠ This bound is the traversal's, not a person's. How far *this viewer* may travel
     -- is `max_depth`; how far away someone may stand and still see *you* is your own
     -- `visible_to_distance`, applied in `reachable` below. Conflating the two would let
     -- one person's privacy setting shorten everybody else's view of the network.
     where t.degree + 1 <= max_depth
  ),
  -- One row per person at their shortest distance, then each person's own reach
  -- setting, then the node budget. Ordering before the limit is what makes truncation
  -- take the far edge of the network rather than an arbitrary slice of it.
  --
  -- ⚠ **"Who can see you at all", not "who sees your name".** `visible_to_distance` is
  -- the person's own answer to how far away somebody may stand and still see that they
  -- exist. Past that distance they are not a nameless node — they are not a row. That
  -- is what makes this setting meaningful without the ghost surrogate ID decision 4
  -- asks for: there is no ghost to correlate, because there is no ghost.
  --
  -- ⚠ It fails **closed**: only the four values below are honoured, and anything else —
  -- a value written by a future migration, a typo — collapses to first-degree-only
  -- rather than to `anyone`. A privacy setting whose unknown state is "visible to
  -- everybody" is a privacy setting that fails in the one direction that matters.
  --
  -- The filter runs BEFORE `limit node_budget` so that hidden people do not spend
  -- budget and push visible ones off the far edge of the result.
  --
  -- ⚠ Applied here rather than inside the recursive term, and that is deliberate — the
  -- opposite of how a *block* must behave (ADR-0004 decision 1). A block makes a person
  -- untraversable so no path routes through them; this setting must NOT, or choosing to
  -- hide yourself from strangers would silently disconnect your own friends from each
  -- other. Paths still route through a hidden person; the person is what is withheld.
  -- Residual, stated plainly: a viewer can still infer that *somebody* stands between
  -- them and a person they can see, which is topology, not identity.
  reachable as (
    select t.person_id, pg_catalog.min(t.degree) as degree
      from traversal t
      join app.users setter on setter.id = t.person_id
     group by t.person_id, setter.visible_to_distance
    having pg_catalog.min(t.degree) <= case setter.visible_to_distance
             when 'anyone' then 2147483647
             when 'third'  then 3
             when 'second' then 2
             else 1
           end
     order by pg_catalog.min(t.degree), t.person_id
     limit node_budget
  ),
  -- Disclosure is computed here, in SQL, never in a client (ADR-0004 decision 3).
  --
  -- ⚠ It fails **closed**: anything that is not the viewer and is not explicitly
  -- granted `full` is `topology_only`. A disclosure level this function has never
  -- heard of — a value written by a future migration, a typo — therefore withholds
  -- identity rather than disclosing it.
  disclosed as (
    select r.person_id,
           r.degree,
           case
             when r.person_id = viewer_id then 'full'
             when granted.level = 'full' then 'full'
             else 'topology_only'
           end as disclosure
      from reachable r
      -- LATERAL … LIMIT 1 rather than a plain join: a duplicated connection row for
      -- one pair would otherwise multiply a person's rows, and a visibility function
      -- that can return a person twice is a visibility function whose row count is
      -- not evidence of anything.
      left join lateral (
        select e.target_discloses_to_source as level
          from edge e
         where e.source_id = viewer_id
           and e.target_id = r.person_id
         limit 1
      ) granted on true
  )
  select d.person_id,
         d.degree,
         d.disclosure::text,
         -- ADR-0002 §6a, applied at the source. Below `full`, the identity columns are
         -- not projected at all — they never leave the database, so no layer above can
         -- forget to strip them (ADR-0004: "Hidden information must never be sent to
         -- the client merely to be concealed by the UI"). `avatar_path` is absent from
         -- the projection entirely: it is a private bucket key, a signed URL has to be
         -- minted through this same predicate, and the module that mints one is not
         -- built in M2.
         case when d.disclosure = 'full' then u.display_name end,
         case when d.disclosure = 'full' then u.handle::text end,
         -- The viewer's OWN trust toward this person, and only ever that: the join is
         -- keyed on owner_id = viewer_id, so no other person's directional trust is
         -- reachable through this function (ADR-0004 decision 6, ADR-0002 B6). Absent
         -- row means unset, which is a first-class value distinct from 0 and arrives
         -- here as NULL through the LEFT JOIN.
         ct.trust::int
    from disclosed d
    join app.users u on u.id = d.person_id
    left join app.connection_trust ct
      on ct.owner_id = viewer_id
     and ct.subject_id = d.person_id
   -- Deactivated, suspended and erased people are pruned (ADR-0004 decision 1,
   -- ADR-0002 B11): an erased user must fail closed everywhere on the next read, with
   -- no invalidation step in between.
   where u.status = 'active'
   order by d.degree, d.person_id
$$;
