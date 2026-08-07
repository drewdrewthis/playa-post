-- `app.visible_edges` — the lines between the nodes `app.visible_people` already
-- returns, for the graph screen's cluster view.
--
-- No table. This migration installs one function over data three existing tables
-- already hold, which is why it adds nothing to the `schema app` inventory
-- (tests/security/app-table-inventory.security.test.ts) and nothing to
-- packages/database/src/schema.ts: a set-returning function is not a table, and its
-- shape is pinned by visible-edges-migration.integration.test.ts instead.

-- Everything is created, owned, and granted by `app_migrator`, so the catalog comes
-- out identical whether the runner is a superuser (Testcontainers) or Supabase's
-- non-superuser `postgres`.
set role app_migrator;

--------------------------------------------------------------------------------
-- 1. app.visible_edges  (ADR-0004 decision 6, graph cluster view)
--------------------------------------------------------------------------------

-- ⚠ Everything between this comment and the closing `$$;` is a **byte-identical
-- copy** of apps/server/src/modules/graph/persistence/sql/visible-edges.sql, which is
-- the checked-in source ADR-0004:73-74 requires. A migration cannot read a file, and
-- migrations are forward-only, so the copy is the price. It is not left to a reviewer
-- to notice: visible-edges-migration.integration.test.ts asserts the checked-in file
-- appears verbatim in exactly one migration and fails the moment the two drift.
--
-- Changing the function means editing the module file and shipping a NEW migration
-- carrying the new text. Never edit this one.

-- app.visible_edges — which connections *between visible people* this viewer may see.
--
-- The cluster the graph screen draws needs lines, not just nodes: `app.visible_people`
-- answers "who is in my network", and this answers "which of them know each other".
-- ADR-0002 §5 (viewer_id passed explicitly), §6 (one composition point), §6a (one
-- person-projection rule); ADR-0004 decision 6 for what an edge may and may not carry.
--
-- ⚠ **The privacy invariant is the double join, and it is the whole function.** A row is
-- emitted only when BOTH endpoints are already in `app.visible_people(viewer_id)`. An
-- edge therefore cannot reveal that somebody exists, cannot reveal a person the viewer
-- could not already name or already see as an unnamed node, and cannot reach past the
-- traversal's own depth bound. Dropping either join — even to "just show the shape one
-- hop further" — turns this into a way to enumerate strangers, which is the people
-- search PDF §3/§4 forbids.
--
-- ⚠ It **composes** app.visible_people rather than re-deriving reachability, exactly as
-- app.visible_bulletins does. It reads app.connections directly, which it may only
-- because this module is allowlisted for that table in
-- tests/fitness/sql-table-ownership-allowlist.json — the same grant app.visible_people
-- holds, recorded rather than inferred.
--
-- ⚠ **No weight, no trust, no direction.** ADR-0004 decision 6: edges incident to the
-- viewer carry the viewer's own trust, and edges between two other people carry no
-- weight at all. The viewer's trust already rides `app.visible_people`'s `trust` column,
-- per person; adding it here would either duplicate it or — for an edge between two
-- other people — invent a value that is nobody's to see (ADR-0002 B6). There is
-- deliberately no column here that could hold one.
--
-- ⚠ This file is the checked-in source. The migration that installs it carries a
-- byte-identical copy of the statement below (a migration is forward-only and cannot
-- read a file), and visible-edges-migration.integration.test.ts asserts the two have
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
create or replace function app.visible_edges(viewer_id uuid)
returns table (
  person_a_id uuid,
  person_b_id uuid
)
language sql
stable
security invoker
set search_path = ''
as $$
  -- The authorized-person set, taken whole from the canonical function. Only
  -- `user_id` is selected: this query decides *which pairs* are visible and never
  -- re-decides *how much of a person* is (ADR-0004 decision 3). The disclosure level and
  -- the identity columns belong to the person rows the caller already has, and reading
  -- them here would invite an edge to start carrying a name.
  with authorized_people as (
    select vp.user_id
      from app.visible_people(viewer_id) vp
  )
  -- `least`/`greatest` put every pair in one canonical order, so an undirected
  -- connection is one edge whichever way round it happens to be stored. The application
  -- writes the lower id first, but reads must work for either order — the pair-key
  -- constraint is deliberately not also a `check (user_a_id < user_b_id)`.
  --
  -- `distinct` for the reason app.visible_people uses `LATERAL … LIMIT 1`: a duplicated
  -- connection row for one pair would otherwise emit the same edge twice, and a
  -- visibility function whose row count is not evidence of anything is worse than one
  -- that is slightly slower.
  select distinct
         least(c.user_a_id, c.user_b_id) as person_a_id,
         greatest(c.user_a_id, c.user_b_id) as person_b_id
    from app.connections c
    join authorized_people a on a.user_id = c.user_a_id
    join authorized_people b on b.user_id = c.user_b_id
   where c.status = 'accepted'
   -- Deterministic, so two reads of an unchanged network render the same picture and a
   -- client can diff one against the next.
   order by 1, 2
$$;
-- app_rw is the only role that may execute it. The baseline's default-privilege
-- revokes already keep PUBLIC out of anything `app_migrator` creates in `app`
-- (ADR-0002 §3), so this grant adds the one principal that needs it and nothing else.
grant execute on function app.visible_edges(uuid) to app_rw;

reset role;
