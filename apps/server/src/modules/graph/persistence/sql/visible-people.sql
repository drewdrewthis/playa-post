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
-- M2 scope: the viewer plus accepted first-degree connections. Degrees >= 2, ghost
-- surrogate IDs, path_via and truncation reporting are M5 (ADR-0004 decisions 4-5,
-- graph-visibility.feature's own scope comment).
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
     -- `least(max_depth, 1)` is two bounds doing different jobs. `max_depth` is the
     -- operational safety bound ADR-0004 decision 2 insists is never a product depth
     -- cap; the literal 1 is M2's feature scope, and M5 deletes it rather than raising
     -- the default.
     --
     -- Unqualified because `least` is a SQL construct rather than a function — there
     -- is no `pg_catalog.least` to name, and search_path cannot redefine a keyword.
     where t.degree + 1 <= least(max_depth, 1)
  ),
  -- One row per person at their shortest distance, then the node budget. Ordering
  -- before the limit is what makes truncation take the far edge of the network rather
  -- than an arbitrary slice of it.
  reachable as (
    select t.person_id, pg_catalog.min(t.degree) as degree
      from traversal t
     group by t.person_id
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
