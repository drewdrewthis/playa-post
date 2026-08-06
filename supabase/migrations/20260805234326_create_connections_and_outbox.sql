-- Lane L2's tables — invitations, connections, directional trust — plus the two
-- outbox tables ADR-0006 specifies, and `app.visible_people`.
--
-- Five tables in one migration is the lane-brief C1a carve-out: a lane opens with one
-- migration carrying all of its tables, then ships behaviour per work item. The two
-- outbox tables are L2's flatly (ratified decision (a)): M2-AC19 requires
-- `connection.accept` and `trust.set` to demonstrate **zero** rows in
-- `app.outbox_events` on an unauthorized write, and an AC that counts rows in a table
-- needs the table.
--
-- Every table below gets the ADR-0002 §4 backstop through `app.apply_rls_backstop`
-- and an explicit per-table grant. Neither is optional and neither is hand-written:
-- B3 reads the catalog, so a table that skipped either fails the security suite
-- whether or not the SQL looks right.

-- Everything is created, owned, and granted by `app_migrator`, so the catalog comes
-- out identical whether the runner is a superuser (Testcontainers) or Supabase's
-- non-superuser `postgres`.
set role app_migrator;

--------------------------------------------------------------------------------
-- 1. app.invitations  (plan M2.5, invitations.feature)
--------------------------------------------------------------------------------

-- An invite is an opaque bearer credential: whoever holds the token may accept it.
-- That is the product decision (PDF: there is no people search, so an invite link is
-- how a connection starts), and it is why `token` carries no relationship to the
-- inviter — see modules/connections/domain/invite-token.ts and M2-AC17.
create table app.invitations (
  id             uuid primary key default pg_catalog.gen_random_uuid(),
  inviter_id     uuid not null references app.users (id),
  -- Unique because the token IS the lookup key, and a collision would hand one
  -- person's invite to another. 32 CSPRNG bytes make that arithmetically impossible;
  -- the constraint is what makes it structurally impossible.
  token          text unique not null,
  status         text not null default 'pending',   -- pending | accepted | revoked
  created_at     timestamptz not null,
  -- Who spent it. Acceptance is idempotent for the person who accepted (M2-AC18's
  -- "accepting twice") and refused for everyone else — telling those two apart needs
  -- this column, not just `status`.
  accepted_by_id uuid references app.users (id),
  accepted_at    timestamptz,
  revoked_at     timestamptz
);

comment on table app.invitations is
  'One row per invite. `token` is 32 CSPRNG bytes, base64url, and is not derived from '
  'the inviter (M2-AC17). Spent and revoked tokens stay as rows so a second attempt is '
  'answered INVITATION_UNAVAILABLE rather than "no such invite".';

comment on column app.invitations.status is
  'pending | accepted | revoked. Deliberately no check constraint, matching '
  'app.users.status: an unrecognised value must fail CLOSED in the application '
  '(nothing but pending can be opened or accepted) rather than loudly in a constraint '
  'the reader has to go find.';

select app.apply_rls_backstop('app.invitations');
grant select, insert, update, delete on table app.invitations to app_rw;

--------------------------------------------------------------------------------
-- 2. app.connections  (plan M2.5, connections.feature, graph-visibility.feature)
--------------------------------------------------------------------------------

-- A connection is undirected — there is no inviter side once it is accepted — but
-- *disclosure* is directional, so each party's level toward the other is its own
-- column. `a_discloses_to_b_level` is what A grants B, and it is therefore what
-- decides whether B may see A's name. One shared column would make "I show you my
-- name, you do not show me yours" unrepresentable, and that is a state the product
-- explicitly has (ADR-0004 decision 3).
create table app.connections (
  id                     uuid primary key default pg_catalog.gen_random_uuid(),
  user_a_id              uuid not null references app.users (id),
  user_b_id              uuid not null references app.users (id),
  status                 text not null,                  -- accepted (M2 has no other state)
  a_discloses_to_b_level text not null default 'full',   -- full | limited
  b_discloses_to_a_level text not null default 'full',   -- full | limited
  created_at             timestamptz not null,
  constraint connections_distinct_parties check (user_a_id <> user_b_id),
  -- The application writes the pair in a canonical order (lower id first), so this is
  -- a real pair key for everything the application creates. It is deliberately NOT
  -- also a `check (user_a_id < user_b_id)`: reads have to work for either storage
  -- order regardless (app.visible_people walks both directions), and a check would
  -- turn a fixture inserting in natural order into a schema violation.
  constraint connections_pair_key unique (user_a_id, user_b_id)
);

comment on table app.connections is
  'One row per accepted connection. Undirected membership, directional disclosure. '
  'Trust is NOT here — it lives in app.connection_trust so a query that forgets to '
  'join simply has no trust to leak (ratified decision (b), ADR-0002 B6).';

comment on column app.connections.a_discloses_to_b_level is
  'What user A grants user B: full | limited. Consumed by app.visible_people, which '
  'fails closed — anything that is not exactly full is topology_only.';

select app.apply_rls_backstop('app.connections');
grant select, insert, update, delete on table app.connections to app_rw;

--------------------------------------------------------------------------------
-- 3. app.connection_trust  (plan M2.6, directional-trust.feature)
--------------------------------------------------------------------------------

-- Its own table, keyed (owner_id, subject_id) — ratified decision (b), for two
-- mechanical reasons. A query that forgets to join has no trust to project away, so
-- absence is cheaper to guarantee than removal (M2-AC3 asserts absence across six
-- surfaces). And ADR-0002:218-219 excludes trust from `app_operator_ro` at *table*
-- granularity, which a column-level exclusion cannot express.
create table app.connection_trust (
  owner_id   uuid not null references app.users (id),
  subject_id uuid not null references app.users (id),
  -- ⚠ Nullable, and NO default. ADR-0004:70-71 is explicit that `unset` is a
  -- first-class value distinct from 0 and "must be modelled as NULL … never defaulted
  -- to zero". A `default 0` here would silently turn every never-touched connection
  -- into "I trust this person not at all", which is a different statement.
  --
  -- Under this lane's ratified model `unset` is the ABSENCE of the row and a LEFT
  -- JOIN yields NULL. The column stays nullable anyway because the ADR requires the
  -- shape, and because clearing a trust value needs somewhere to land.
  trust      smallint,
  updated_at timestamptz not null,
  constraint connection_trust_pkey primary key (owner_id, subject_id),
  constraint connection_trust_range check (trust between 0 and 100),
  constraint connection_trust_distinct_parties check (owner_id <> subject_id)
);

comment on table app.connection_trust is
  'One row per (owner, subject) the owner has deliberately assigned trust to. No row '
  'means unset, which is NOT zero (ADR-0004:70-71). Never returned to anyone but the '
  'owner (ADR-0002 B6).';

select app.apply_rls_backstop('app.connection_trust');
grant select, insert, update, delete on table app.connection_trust to app_rw;

--------------------------------------------------------------------------------
-- 4. app.outbox_events  (ADR-0006:20-34, verbatim)
--------------------------------------------------------------------------------

-- The authoritative delivery ledger. A state change and its event commit together or
-- not at all (§10); the queue is a dispatch accelerator, never the record.
--
-- ⚠ Payloads carry identifiers and routing data only — never bulletin content, never
-- contact details (ADR-0006, PDF §6). A consumer re-reads what it needs through the
-- owning module's authorized read path, which is also what stops a delivery leaking
-- data the *current* authorization state no longer permits.
create table app.outbox_events (
  -- No default: the writer mints the ID. ADR-0006 names UUID v7 for index locality;
  -- PostgreSQL 17 ships no `uuidv7()` and M2 adds no dependency for one, so the
  -- writer currently mints v4. That is a correct primary key — ADR-0006 guarantees no
  -- ordering and consumers must not assume any — and the upgrade is a one-line change
  -- at the writer with no migration.
  event_id      uuid primary key,
  event_type    text not null,                     -- past tense (§20), e.g. ConnectionAccepted
  event_version int not null default 1,
  occurred_at   timestamptz not null,
  actor_id      uuid,
  aggregate_id  uuid not null,
  payload       jsonb not null,
  status        text not null default 'pending',   -- pending | claimed | published | dead
  attempts      int not null default 0,
  available_at  timestamptz not null default now(),
  claimed_at    timestamptz,
  claimed_by    text,
  last_error    text
);

comment on table app.outbox_events is
  'Transactional outbox (ADR-0006). Written in the same transaction as the state '
  'change it describes. Drained by the M2.14 entrypoint with FOR UPDATE SKIP LOCKED.';

-- The drainer claims on `status in (pending, claimed) and available_at <= now()`,
-- ordered by available_at. A partial index on exactly that predicate keeps the scan
-- proportional to the backlog rather than to the fourteen days of published rows
-- sitting beside it.
create index outbox_events_available_at_idx
  on app.outbox_events (available_at)
  where status in ('pending', 'claimed');

select app.apply_rls_backstop('app.outbox_events');
grant select, insert, update, delete on table app.outbox_events to app_rw;

--------------------------------------------------------------------------------
-- 5. app.consumer_receipts  (ADR-0006:72-73, verbatim)
--------------------------------------------------------------------------------

-- Each consumer writes its receipt in the same transaction as its own effect; a
-- unique violation means "already processed" and the delivery is skipped. That is
-- what makes at-least-once delivery safe without any consumer writing bespoke dedup
-- logic (M2-AC8).
--
-- No foreign key to app.outbox_events on purpose: published rows are pruned after
-- fourteen days (ADR-0006's daily cron), and a FK would either block that prune or
-- cascade the receipts away — losing exactly the record that says "this was already
-- done".
create table app.consumer_receipts (
  consumer_name text not null,
  event_id      uuid not null,
  processed_at  timestamptz not null,
  constraint consumer_receipts_pkey primary key (consumer_name, event_id)
);

comment on table app.consumer_receipts is
  'Idempotency ledger for outbox consumers (ADR-0006). One row per (consumer, event); '
  'the primary key IS the dedup mechanism.';

select app.apply_rls_backstop('app.consumer_receipts');
grant select, insert, update, delete on table app.consumer_receipts to app_rw;

--------------------------------------------------------------------------------
-- 6. app.visible_people  (ADR-0004:25-42, M2.7)
--------------------------------------------------------------------------------

-- ⚠ Everything between this comment and the closing `$$;` is a **byte-identical
-- copy** of apps/server/src/modules/graph/persistence/sql/visible-people.sql, which
-- is the checked-in source ADR-0004:73-74 requires. A migration cannot read a file,
-- and migrations are forward-only, so the copy is the price. It is not left to a
-- reviewer to notice: `visible-people-migration.integration.test.ts` asserts the
-- checked-in file appears verbatim in exactly one migration and fails the moment the
-- two drift.
--
-- Changing the function means editing the module file and shipping a NEW migration
-- carrying the new text. Never edit this one.

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

-- app_rw is the only role that may execute it. The baseline's default-privilege
-- revokes already keep PUBLIC out of anything `app_migrator` creates in `app`
-- (ADR-0002 §3), so this grant adds the one principal that needs it and nothing else.
grant execute on function app.visible_people(uuid, int, int) to app_rw;

--------------------------------------------------------------------------------
-- 7. Sweep (ADR-0002 §3)
--------------------------------------------------------------------------------

-- The baseline's default-privilege revokes already cover objects `app_migrator`
-- creates from here on; this covers the five tables this migration just created, the
-- same way `create_app_users` covers its one.
revoke all on table
  app.invitations, app.connections, app.connection_trust,
  app.outbox_events, app.consumer_receipts
  from anon, authenticated, public;

reset role;
