-- Intro requests — the one-hop introduction (issue #89) — plus
-- `app.intro_via_candidates`, the eligibility set every intro path composes.
--
-- ⚠ **Its own table and its own aggregate, never a note or a bulletin subtype.** A note
-- has one write, two parties and no lifecycle (`modules/notes/domain/note.ts`); an intro
-- request has three parties, three states, and a second actor who decides. Forcing it
-- into `app.notes` would mean nullable `via_id`/`status` columns the note path must
-- always ignore — the placeholder shape addendum §4 refuses. The *idiom* is reused (the
-- same textarea, the same 1–4000 bound); the table is not.
--
-- The ADR-0002 §4 backstop and the explicit per-table grant are not optional and not
-- hand-written: B3 reads the catalog, so a table that skipped either fails the security
-- suite whether or not the SQL looks right.

-- Everything is created, owned, and granted by `app_migrator`, so the catalog comes
-- out identical whether the runner is a superuser (Testcontainers) or Supabase's
-- non-superuser `postgres`.
set role app_migrator;

--------------------------------------------------------------------------------
-- 1. app.intro_requests  (request-an-intro.feature, issue #89)
--------------------------------------------------------------------------------

create table app.intro_requests (
  id           uuid primary key default pg_catalog.gen_random_uuid(),
  -- Who asked. Taken from the resolved actor, never from request input (ADR-0002 §5a).
  requester_id uuid not null references app.users (id),
  -- Who was asked to make the introduction — the only person who may ever decide this
  -- row, and the only one who reads it while it is `requested`.
  via_id       uuid not null references app.users (id),
  -- Who the requester wants to meet. They learn nothing about this row until the via
  -- passes it on, and nothing ever if the via declines.
  target_id    uuid not null references app.users (id),
  note         text not null,
  status       text not null,
  -- No default, for the reason ADR-0008:29 gives app.users and app.bulletins: the
  -- writer states when the thing happened rather than inheriting whatever moment the
  -- row happened to be inserted at.
  created_at   timestamptz not null,
  -- Null until the via acts, and non-null forever after — see intro_requests_decided_at.
  decided_at   timestamptz,
  -- Three distinct people, matching `connections_distinct_parties` and
  -- `notes_distinct_parties`. The sanctioned path can never produce a violation —
  -- `app.intro_via_candidates` returns only degree-1 people for a degree-2 target, so
  -- the requester (degree 0) and the target (degree 2) are excluded by the same
  -- predicate — which is exactly what makes this a backstop rather than the rule.
  constraint intro_requests_distinct_parties
    check (requester_id <> via_id and via_id <> target_id and requester_id <> target_id),
  -- A `text` column with a CHECK rather than an enum, matching `app.connections.status`:
  -- adding a state is then a migration rather than a type rewrite. Target-side action
  -- after `passed_on` (connect / ignore) is out of scope for #89, so it is not listed.
  constraint intro_requests_status
    check (status in ('requested', 'passed_on', 'declined')),
  -- The two columns cannot disagree. An undecided row with a decision timestamp, or a
  -- decided row without one, is a state no reader could interpret — and the equality
  -- form says it in one direction rather than two implications a later editor could
  -- half-delete.
  constraint intro_requests_decided_at
    check ((status = 'requested') = (decided_at is null))
);

comment on table app.intro_requests is
  'One row per one-hop introduction request (issue #89). Three parties: requester, via, '
  'target. Eligibility is decided by app.intro_via_candidates INSIDE the insert and '
  'AGAIN inside a pass-on, never by a read before either. A declined request is '
  'invisible to the target forever — that indistinguishability is what makes declining '
  'safe for the via.';

comment on column app.intro_requests.note is
  'Why the requester wants to meet. Deliberately NOT indexed and NOT part of any '
  'tsvector: no query grammar reaches an intro request, so it can never become a way to '
  'find people through the free-text channel. Never written to a log or an outbox '
  'payload (ADR-0006).';

comment on column app.intro_requests.status is
  'requested -> passed_on | declined. Both decisions are terminal for #89.';

-- **The anti-spam control**, and the reason it keys on (requester, target) rather than
-- on the triple: without it a requester fans one ask out to every shared connection and
-- the target hears about it from all of them. Partial, so a decided request leaves the
-- pair free to ask again.
create unique index intro_requests_open_per_pair_idx
  on app.intro_requests (requester_id, target_id)
  where status = 'requested';

-- The via's inbox: "what have I been asked to pass on". Partial on the same predicate
-- the read uses, so the scan is proportional to the open asks rather than to history.
create index intro_requests_via_pending_idx
  on app.intro_requests (via_id)
  where status = 'requested';

-- The target's half of the dual-role inbox: "who has been introduced to me". Partial on
-- `passed_on` because that is the only status a target may ever see a row in — a
-- `requested` or `declined` row is not merely filtered out of their read, it is not in
-- this index for a query to find.
create index intro_requests_target_passed_idx
  on app.intro_requests (target_id)
  where status = 'passed_on';

-- The requester's outbox, which unlike the two above spans every status: "what did I
-- ask, and what came of it". Not partial for exactly that reason.
create index intro_requests_requester_idx
  on app.intro_requests (requester_id);

select app.apply_rls_backstop('app.intro_requests');
grant select, insert, update, delete on table app.intro_requests to app_rw;

--------------------------------------------------------------------------------
-- 2. app.intro_via_candidates  (ADR-0002 §6/§6a)
--------------------------------------------------------------------------------

-- ⚠ Everything between this comment and the closing `$$;` is a **byte-identical copy**
-- of apps/server/src/modules/intros/persistence/sql/intro-via-candidates.sql, which is
-- the checked-in source ADR-0004:73-74 requires. A migration cannot read a file, and
-- migrations are forward-only, so the copy is the price. It is not left to a reviewer to
-- notice: intro-requests-migration.integration.test.ts asserts the checked-in file
-- appears verbatim in exactly one migration and fails the moment the two drift.
--
-- Changing the function means editing the module file and shipping a NEW migration
-- carrying the new text. Never edit this one once it has shipped — that is what
-- forward-only means, and it is the rule for every migration on main.

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

-- app_rw is the only role that may execute it. The baseline's default-privilege revokes
-- already keep PUBLIC out of anything `app_migrator` creates in `app` (ADR-0002 §3), so
-- this grant adds the one principal that needs it and nothing else.
grant execute on function app.intro_via_candidates(uuid, uuid) to app_rw;

--------------------------------------------------------------------------------
-- 3. Sweep (ADR-0002 §3)
--------------------------------------------------------------------------------

revoke all on table app.intro_requests from anon, authenticated, public;

reset role;
