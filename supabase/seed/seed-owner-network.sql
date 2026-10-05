-- =============================================================================
-- Seed script: owner app.users row + fake "in network" users, connections,
-- and a handful of bulletins the owner should see on his board.
--
-- NOT a migration. Do not put this under supabase/migrations/ and do not run
-- it through `pnpm db:migrate` / `supabase db push` — it is hand-run, once,
-- directly against the target database with psql or the Supabase SQL editor.
--
-- ⚠ MUST run as (or SET ROLE to) `app_rw`.
-- supabase/migrations/20260730195954_create_security_baseline.sql:235-241
-- installs `alter table ... force row level security` plus exactly one
-- permissive policy, `app_rw_full_access ... to app_rw using (true) with
-- check (true)`. FORCE means even the table owner (`app_migrator`) is bound
-- by it, and no other role has a matching policy. The migration's own
-- comment (lines 78-79) records that on Supabase, the `postgres` role is
-- "CREATEROLE and NOT a superuser" — so running this as a bare `postgres`
-- session in the Supabase SQL editor will insert **zero rows silently** (RLS
-- filters, no error) unless that session first does `SET ROLE app_rw;`, or
-- unless `postgres` genuinely holds bypassrls/superuser on this project.
-- Safest path: connect directly with app_rw's own credentials, the same way
-- the API does (docs/engineering/secrets.md). Second-safest: `SET ROLE
-- app_rw;` as below, which only works if the connecting role has been
-- granted membership with the SET option.
-- =============================================================================

begin;

-- set role app_rw;  -- not needed when connecting directly as app_rw

-- -----------------------------------------------------------------------------
-- 0. Fixed IDs, so every later statement can reference them without a
--    round trip. Format is a well-formed v4-shaped uuid; the specific bytes
--    are just legible seed markers, not real random UUIDs.
-- -----------------------------------------------------------------------------
-- owner app.users.id            d9d8c4d9-419c-43e6-9d75-d9f8ede06e05
-- fake  1 dusty_pelican   id/auth  ...0101 / ...0102
-- fake  2 playa_wanderer  id/auth  ...0201 / ...0202
-- fake  3 sunbaked_nomad  id/auth  ...0301 / ...0302
-- fake  4 glitter_bomber  id/auth  ...0401 / ...0402
-- fake  5 lonely_cactus   id/auth  ...0501 / ...0502
-- fake  6 desert_rat_99   id/auth  ...0601 / ...0602
-- fake  7 moop_patrol     id/auth  ...0701 / ...0702
-- fake  8 neon_yeti       id/auth  ...0801 / ...0802

-- 1. Owner row already exists in production (handle 'yetti', id
--    d9d8c4d9-419c-43e6-9d75-d9f8ede06e05, auth fb9e6b65-...) — created via
--    real onboarding 2026-08-07. No owner insert needed; the id above is
--    referenced directly by the connections below.

-- -----------------------------------------------------------------------------
-- 2. app.users — 8 fake users "in network"
--    Emails are seed-only markers (never stored in app.users — ADR-0008 rule 3,
--    "no email column, ever" — apps/server side email lives only in
--    auth.users, never touched by this script; see risk note below).
-- -----------------------------------------------------------------------------

insert into app.users (id, auth_user_id, handle, display_name, status, created_at)
values
  ('00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000102', 'dusty_pelican',  'Dusty Pelican (seed)',  'active', now() - interval '120 days'),
  ('00000000-0000-4000-8000-000000000201', '00000000-0000-4000-8000-000000000202', 'playa_wanderer', 'Playa Wanderer (seed)', 'active', now() - interval '110 days'),
  ('00000000-0000-4000-8000-000000000301', '00000000-0000-4000-8000-000000000302', 'sunbaked_nomad', 'Sunbaked Nomad (seed)', 'active', now() - interval '100 days'),
  ('00000000-0000-4000-8000-000000000401', '00000000-0000-4000-8000-000000000402', 'glitter_bomber', 'Glitter Bomber (seed)', 'active', now() - interval '90 days'),
  ('00000000-0000-4000-8000-000000000501', '00000000-0000-4000-8000-000000000502', 'lonely_cactus',  'Lonely Cactus (seed)',  'active', now() - interval '80 days'),
  ('00000000-0000-4000-8000-000000000601', '00000000-0000-4000-8000-000000000602', 'desert_rat_99',  'Desert Rat (seed)',     'active', now() - interval '70 days'),
  ('00000000-0000-4000-8000-000000000701', '00000000-0000-4000-8000-000000000702', 'moop_patrol',    'Moop Patrol (seed)',    'active', now() - interval '60 days'),
  ('00000000-0000-4000-8000-000000000801', '00000000-0000-4000-8000-000000000802', 'neon_yeti',      'Neon Yeti (seed)',      'active', now() - interval '50 days')
on conflict (auth_user_id) do nothing;

-- -----------------------------------------------------------------------------
-- 3. app.connections — the graph edge that makes a bulletin visible.
--    supabase/migrations/20260805234326_create_connections_and_outbox.sql:70-97
--    "in the owner's network" = an accepted app.connections row between the
--    owner and the fake user. Undirected membership, directional disclosure
--    (a_discloses_to_b_level / b_discloses_to_a_level: full | limited).
--    Visibility direction proven by app.visible_people
--    (same migration:249-373): it builds directed edges from BOTH sides of
--    every accepted connection (lines 273-285), so storage order of
--    user_a_id/user_b_id does not matter for reachability. What DOES matter
--    for the owner seeing the author's NAME on the board is the disclosure
--    the fake user (as "target") grants the owner (as "source") — i.e. the
--    column naming the author's side must be 'full', or app.visible_people
--    falls back to 'topology_only' and app.visible_bulletins withholds
--    display_name/handle (bulletins migration:163-176). Both directions are
--    set to 'full' below so this is unambiguous regardless of storage order.
--    status is 'accepted' — M2 has no other state (line 74's comment).
--    constraint connections_distinct_parties / connections_pair_key (lines
--    78, 84) are satisfied since each pair is (owner, one fake user), once.
-- -----------------------------------------------------------------------------

insert into app.connections
  (user_a_id, user_b_id, status, a_discloses_to_b_level, b_discloses_to_a_level, created_at)
values
  ('d9d8c4d9-419c-43e6-9d75-d9f8ede06e05', '00000000-0000-4000-8000-000000000101', 'accepted', 'full', 'full', now() - interval '119 days'),
  ('d9d8c4d9-419c-43e6-9d75-d9f8ede06e05', '00000000-0000-4000-8000-000000000201', 'accepted', 'full', 'full', now() - interval '109 days'),
  ('d9d8c4d9-419c-43e6-9d75-d9f8ede06e05', '00000000-0000-4000-8000-000000000301', 'accepted', 'full', 'full', now() - interval '99 days'),
  ('d9d8c4d9-419c-43e6-9d75-d9f8ede06e05', '00000000-0000-4000-8000-000000000401', 'accepted', 'full', 'full', now() - interval '89 days'),
  ('d9d8c4d9-419c-43e6-9d75-d9f8ede06e05', '00000000-0000-4000-8000-000000000501', 'accepted', 'full', 'full', now() - interval '79 days'),
  ('d9d8c4d9-419c-43e6-9d75-d9f8ede06e05', '00000000-0000-4000-8000-000000000601', 'accepted', 'full', 'full', now() - interval '69 days'),
  ('d9d8c4d9-419c-43e6-9d75-d9f8ede06e05', '00000000-0000-4000-8000-000000000701', 'accepted', 'full', 'full', now() - interval '59 days'),
  ('d9d8c4d9-419c-43e6-9d75-d9f8ede06e05', '00000000-0000-4000-8000-000000000801', 'accepted', 'full', 'full', now() - interval '49 days')
on conflict on constraint connections_pair_key do nothing;

-- -----------------------------------------------------------------------------
-- 4. app.bulletins — a few requests authored by the fake users, which the
--    owner will see on his board because app.visible_bulletins composes
--    app.visible_people (bulletins migration:127-189) and each author above
--    is a first-degree accepted connection of the owner.
--    supabase/migrations/20260806012322_create_bulletins.sql:24-57
--    type: M2 writes only 'request' (line 27's comment) — used for all rows.
--    title: BULLETIN_TITLE_MAX_LENGTH = 120
--      (apps/server/src/modules/bulletins/domain/bulletin-content.ts:10),
--      must be 1..120 chars after trim (bulletin-content.policy.ts:24-25).
--    body: BULLETIN_BODY_MAX_LENGTH = 4000 (bulletin-content.ts:13); empty
--      body is allowed (policy.ts:12-14,27-28) but these rows use real text.
--    created_at: not null, no default (line 33) — supplied explicitly.
--    archived_at: left NULL (omitted) = live, visible (line 66's comment).
--    search_document is a generated column (lines 54-56) — never inserted.
-- -----------------------------------------------------------------------------

insert into app.bulletins (id, author_id, type, title, body, created_at)
values
  (
    '00000000-0000-4000-8000-000000001001',
    '00000000-0000-4000-8000-000000000101',
    'request',
    'Need a hand striking shade structure Sunday AM',
    'Camp is breaking down our 20x20 shade Sunday at first light. Looking for 2-3 people for about an hour, coffee and playa magic provided.',
    now() - interval '2 days'
  ),
  (
    '00000000-0000-4000-8000-000000001002',
    '00000000-0000-4000-8000-000000000201',
    'request',
    'Borrow a socket set for generator repair',
    'Our generator''s alternator bracket rattled loose. Need a metric socket set for an afternoon, will return clean and full of thanks.',
    now() - interval '1 days 6 hours'
  ),
  (
    '00000000-0000-4000-8000-000000001003',
    '00000000-0000-4000-8000-000000000301',
    'request',
    'Looking for a ride to the airport Tuesday',
    'Flying out Tuesday morning, camp vehicle is already committed to strike duty. Happy to chip in for gas.',
    now() - interval '1 days'
  ),
  (
    '00000000-0000-4000-8000-000000001004',
    '00000000-0000-4000-8000-000000000501',
    'request',
    'Spare shade cloth or tarps for a leaky roof',
    'Wind tore a seam in our shade roof last night. Any spare shade cloth or heavy tarp would save our kitchen tent.',
    now() - interval '10 hours'
  ),
  (
    '00000000-0000-4000-8000-000000001005',
    '00000000-0000-4000-8000-000000000701',
    'request',
    'Bike pump and patch kit needed',
    'Flat tire on the way back from center camp, no pump or patches at our camp. Anyone nearby able to lend one for 20 minutes?',
    now() - interval '3 hours'
  )
on conflict (id) do nothing;

-- -----------------------------------------------------------------------------
-- 5. Notifications / notify_me matches — intentionally SKIPPED.
--    There is no standalone "notifications" table. The only persistence is
--    app.outbox_events rows of event_type 'NotifyMeMatched'
--    (apps/server/src/modules/notifications/persistence/postgres-notify-me-match.repository.ts:112-134)
--    plus app.consumer_receipts rows recording delivery
--    (postgres-delivered-notification.repository.ts:65-74, notify-me-match
--    repository.ts:172-208). Both are written transactionally by application
--    handlers (EvaluateNotifyMeHandler / SendGroupedPushHandler), never by
--    hand — a hand-inserted outbox row would need a matching
--    consumer_receipts row to look "delivered" and there is no product
--    guarantee that shape stays stable. Per the task's own instruction,
--    outbox-generated-only state is skipped here. If a demo genuinely needs
--    a "delivered notification" to show up, seed an app.notify_me_queries
--    row for the owner instead and let EvaluateNotifyMeHandler produce the
--    real event on the next BulletinCreated — that exercises the real path
--    rather than fabricating its output.
-- -----------------------------------------------------------------------------

-- reset role;

commit;
