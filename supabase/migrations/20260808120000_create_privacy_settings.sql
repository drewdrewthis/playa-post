-- `app.privacy_settings` — the two standing limits the You screen calls "who sees your
-- name" and "who can pin to your board" (design/Playa Post.dc.html, the You screen;
-- issue #49).
--
-- ⚠ **A policy, not a materialised answer.** `app.connections` already carries a
-- per-connection, per-direction grant (`a_discloses_to_b_level`), and this table does not
-- replace it — `app.visible_people` ANDs the two. One is "what I granted this person",
-- the other is "the rule I want applied to everyone"; collapsing them into one column
-- would mean either recomputing every connection row whenever a rule changes, or letting
-- a stale row out-vote the rule. Neither can widen the other, so adding this table cannot
-- disclose anything that was previously withheld.
--
-- ⚠ **One row per user, and most users have none.** Absence is the permissive default,
-- spelled out in `app.visible_people` as `coalesce(..., 3)` / `is null` rather than
-- backfilled. That is what makes this migration a strict no-op on existing data: before
-- it, every first-degree connection saw a name; after it, every first-degree connection
-- still does, until somebody deliberately tightens something.
--
-- ⚠ **`note_*` stores a preference nothing enforces yet, and that is not a hole.**
-- "Pinning to a board" is a private, addressed bulletin, and `app.bulletins` has no
-- recipient column in M2 — nobody can pin to anybody's board at all. The stored value is
-- therefore never violated; it becomes live in the same migration that gives a bulletin a
-- recipient, and that migration owes the enforcement point. Recording the user's choice
-- now is what stops that later change from silently defaulting everyone to open.

-- Everything is created, owned, and granted by `app_migrator`, so the catalog comes
-- out identical whether the runner is a superuser (Testcontainers) or Supabase's
-- non-superuser `postgres`.
set role app_migrator;

--------------------------------------------------------------------------------
-- 1. app.privacy_settings  (You screen, issue #49)
--------------------------------------------------------------------------------

create table app.privacy_settings (
  -- The primary key IS the one-row-per-user rule. A user with two policies is a user
  -- whose privacy depends on which row a query happened to read first.
  user_id         uuid primary key references app.users (id),
  -- ⚠ Nullable, and NULL is the design's `ANYONE` — not `0`. The same argument
  -- `app.connection_trust.trust` makes (ADR-0004:70-71) applies from the other end: with
  -- `0` the gate would read `trust >= 0`, which is *null* for an unrated person and would
  -- therefore hide the name from everyone the owner has not scored. "No trust
  -- requirement" and "a requirement of zero" are different rules and only one of them is
  -- on the screen.
  name_min_trust  smallint,
  -- The design's `UP TO 3RD° | UP TO 2ND° | 1ST° ONLY`, stored as the number rather than
  -- the label so the comparison in app.visible_people is arithmetic. 3 is the loosest
  -- value the UI offers and therefore the default; the check keeps a future UI from
  -- writing a degree the traversal's own bound (ADR-0004 decision 2) cannot honour.
  name_max_degree smallint not null default 3,
  note_min_trust  smallint,
  note_max_degree smallint not null default 3,
  updated_at      timestamptz not null,
  constraint privacy_settings_name_min_trust_range check (name_min_trust between 0 and 100),
  constraint privacy_settings_note_min_trust_range check (note_min_trust between 0 and 100),
  constraint privacy_settings_name_max_degree_range check (name_max_degree between 1 and 3),
  constraint privacy_settings_note_max_degree_range check (note_max_degree between 1 and 3)
);

comment on table app.privacy_settings is
  'One row per user who has changed a privacy limit. No row means the permissive '
  'default, which app.visible_people spells out rather than backfilling. Read by '
  'app.visible_people to decide name disclosure; the note_* columns are the same rule '
  'for addressed bulletins and have no enforcement point until a bulletin has a '
  'recipient.';

comment on column app.privacy_settings.name_min_trust is
  'NULL is the design''s ANYONE — no trust requirement at all. A number is the owner''s '
  'OWN directional trust in the viewer (app.connection_trust keyed owner_id = this user), '
  'never the viewer''s trust in the owner, which the owner cannot see.';

comment on column app.privacy_settings.note_max_degree is
  'Stored, not yet enforced: app.bulletins has no recipient column in M2, so nobody can '
  'pin to any board. The migration that adds a recipient owes the enforcement point.';

-- The only read is "this one user's policy", by primary key, plus app.visible_people's
-- per-person join which is also by primary key. No second index.

select app.apply_rls_backstop('app.privacy_settings');
grant select, insert, update, delete on table app.privacy_settings to app_rw;

--------------------------------------------------------------------------------
-- 2. app.visible_people — the name limit's enforcement point
--------------------------------------------------------------------------------

-- ⚠ Everything between this comment and the closing `$$;` is a **byte-identical copy**
-- of apps/server/src/modules/graph/persistence/sql/visible-people.sql, which is the
-- checked-in source ADR-0004:73-74 requires. A migration cannot read a file, and
-- migrations are forward-only, so the copy is the price. It is not left to a reviewer to
-- notice: visible-people-migration.integration.test.ts asserts the checked-in file
-- appears verbatim in exactly ONE migration, so this file replacing
-- 20260805234326_create_connections_and_outbox.sql's copy is what that test now measures.
--
-- What changed versus that copy: the `disclosed` CTE ANDs the target's own
-- `app.privacy_settings` policy onto the existing per-connection grant, and gains two
-- primary-key LEFT JOINs to evaluate it. Reachability is untouched — the `traversal`,
-- `reachable` and `edge` CTEs are identical — so the SET of people this function returns
-- is unchanged and app.visible_edges, which composes this function for `user_id` alone,
-- cannot be affected. Only the `disclosure` column and the two identity columns it gates
-- can narrow, which is exactly what app.visible_bulletins should inherit.
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
  --
  -- ⚠ **Two independent gates, ANDed, and both belong to the person being looked at.**
  -- `granted.level` is the per-connection grant on `app.connections`; the `limits`
  -- clauses are that person's standing policy in `app.privacy_settings` — the "who sees
  -- your name" control on the You screen. Neither can widen the other, which is what
  -- makes adding the policy incapable of disclosing anything that was previously
  -- withheld. Both express ADR-0004 decision 3 from the same side: disclosure follows
  -- the *target's* settings, never the viewer's wishes.
  disclosed as (
    select r.person_id,
           r.degree,
           case
             when r.person_id = viewer_id then 'full'
             when granted.level = 'full'
              -- Absent policy row is the permissive default, and it has to be, because
              -- no row exists until somebody opens the You screen and tightens
              -- something. Writing that default as `coalesce(..., 3)` / `is null` here
              -- rather than backfilling a row per user keeps "never chose" and "chose
              -- the loosest setting" the same observable state, so a backfill that
              -- never runs cannot change what anyone can see.
              and r.degree <= coalesce(limits.name_max_degree, 3)
              -- ⚠ `is null` FIRST, and the trust comparison only inside the `or`. Trust
              -- is nullable and unset is not zero (ADR-0004:70-71), so a policy of
              -- `trust >= 50` withholds the name from somebody the owner has never
              -- rated — `null >= 50` is null, not true. That is the fail-closed reading
              -- and it is the one the design's copy promises: outside your limits you
              -- are an unnamed circle.
              and (limits.name_min_trust is null
                   or (owner_trust.trust is not null
                       and owner_trust.trust >= limits.name_min_trust))
             then 'full'
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
      -- Both joins are on a primary key, so neither can fan a person's row out the way
      -- the `edge` join could — that is why these are plain LEFT JOINs and `granted` is
      -- a LATERAL.
      left join app.privacy_settings limits on limits.user_id = r.person_id
      -- ⚠ **The OTHER person's trust toward the viewer**, keyed `owner_id = r.person_id`
      -- — the mirror image of the `ct` join in the final select, and the only place in
      -- this function where a trust value the viewer does not hold is read at all. It is
      -- consumed as a boolean and never projected: no column of this function's result
      -- carries it, and directional-trust.security.test.ts asserts that (ADR-0002 B6).
      -- What a viewer *can* infer is one bit — whether they cleared this person's own
      -- threshold — and that bit is the feature, stated to the user in as many words on
      -- the You screen.
      left join app.connection_trust owner_trust
        on owner_trust.owner_id = r.person_id
       and owner_trust.subject_id = viewer_id
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

-- app_rw is the only role that may execute it. The baseline's default-privilege
-- revokes already keep PUBLIC out of anything `app_migrator` creates in `app`
-- (ADR-0002 §3), so this grant adds the one principal that needs it and nothing else.
--
-- Restated rather than inherited: `create or replace function` keeps the existing ACL, so
-- this line is a no-op today. It is written anyway because a future migration that has to
-- `drop` and recreate the function would otherwise leave app_rw unable to execute it, and
-- the failure would surface as an empty graph rather than as an error.
grant execute on function app.visible_people(uuid, int, int) to app_rw;

--------------------------------------------------------------------------------
-- 3. Sweep (ADR-0002 §3)
--------------------------------------------------------------------------------

-- The baseline's default-privilege revokes already cover objects `app_migrator` creates
-- from here on; this covers the table this migration just created, the same way
-- create_notification_dismissals covers its one.
revoke all on table app.privacy_settings from anon, authenticated, public;

reset role;
