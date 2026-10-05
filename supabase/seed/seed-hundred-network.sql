-- =============================================================================
-- Seed script: ~100 app.users forming a realistic social network around the
-- owner, with varying connection degree, trust level, and distance.
--
-- Distribution:
--   ~12 direct connections (degree 1) to the owner
--   ~35 degree 2 (connected to owner's connections but not the owner)
--   ~35 degree 3 (connected to degree-2 but isolated from owner)
--   ~18 in disconnected clusters (invisible to owner)
--
-- NOT a migration. Do not put this under supabase/migrations/ and do not run
-- it through `pnpm db:migrate` / `supabase db push` — it is hand-run, once,
-- directly against the target database with psql or the Supabase SQL editor.
--
-- ⚠ MUST run as (or SET ROLE to) `app_rw` (see seed-owner-network.sql for details).
-- =============================================================================

begin;

-- set role app_rw;  -- not needed when connecting directly as app_rw

-- ---------------------------------------------------------------------------
-- Owner reference
-- ---------------------------------------------------------------------------
-- Owner: yetti (d9d8c4d9-419c-43e6-9d75-d9f8ede06e05)
-- The owner already exists from real onboarding; the id is referenced directly.

-- Fixed ID ranges for new users (using seed marker format):
-- Degree 1 (direct to owner):  d9d9xxxx-yyyy-4000-8000-00000000d1nn
-- Degree 2 (friend-of-friend):  d9d9xxxx-yyyy-4000-8000-00000000d2nn
-- Degree 3 (distant):            d9d9xxxx-yyyy-4000-8000-00000000d3nn
-- Disconnected clusters:         d9d9xxxx-yyyy-4000-8000-00000000ddnn

-- ---------------------------------------------------------------------------
-- 1. app.users — ~100 users with Burning Man / playa flavors, varied bios
-- ---------------------------------------------------------------------------

insert into app.users (id, auth_user_id, handle, display_name, status, created_at)
values
  -- DEGREE 1: 12 direct connections to the owner
  -- This cohort exercises first-degree visibility, full disclosure
  ('d9d9d9d9-0101-4000-8000-00000000d101', 'd9d9d9d9-0102-4000-8000-00000000d102', 'dust_wanderer',     'Dust Wanderer',        'active', now() - interval '95 days'),
  ('d9d9d9d9-0201-4000-8000-00000000d101', 'd9d9d9d9-0202-4000-8000-00000000d102', 'spark_dancer',       'Spark Dancer',          'active', now() - interval '91 days'),
  ('d9d9d9d9-0301-4000-8000-00000000d101', 'd9d9d9d9-0302-4000-8000-00000000d102', 'silver_shadow',      'Silver Shadow',         'active', now() - interval '88 days'),
  ('d9d9d9d9-0401-4000-8000-00000000d101', 'd9d9d9d9-0402-4000-8000-00000000d102', 'desert_echo',        'Desert Echo',           'active', now() - interval '85 days'),
  ('d9d9d9d9-0501-4000-8000-00000000d101', 'd9d9d9d9-0502-4000-8000-00000000d102', 'playa_sage',         'Playa Sage',            'active', now() - interval '82 days'),
  ('d9d9d9d9-0601-4000-8000-00000000d101', 'd9d9d9d9-0602-4000-8000-00000000d102', 'neon_gryphon',       'Neon Gryphon',          'active', now() - interval '79 days'),
  ('d9d9d9d9-0701-4000-8000-00000000d101', 'd9d9d9d9-0702-4000-8000-00000000d102', 'shade_architect',    'Shade Architect',        'active', now() - interval '76 days'),
  ('d9d9d9d9-0801-4000-8000-00000000d101', 'd9d9d9d9-0802-4000-8000-00000000d102', 'cipher_monk',        'Cipher Monk',            'active', now() - interval '73 days'),
  ('d9d9d9d9-0901-4000-8000-00000000d101', 'd9d9d9d9-0902-4000-8000-00000000d102', 'stellar_vibe',       'Stellar Vibe',           'active', now() - interval '70 days'),
  ('d9d9d9d9-1001-4000-8000-00000000d101', 'd9d9d9d9-1002-4000-8000-00000000d102', 'mirage_keeper',      'Mirage Keeper',         'active', now() - interval '67 days'),
  ('d9d9d9d9-1101-4000-8000-00000000d101', 'd9d9d9d9-1102-4000-8000-00000000d102', 'radiant_flow',       'Radiant Flow',          'active', now() - interval '64 days'),
  ('d9d9d9d9-1201-4000-8000-00000000d101', 'd9d9d9d9-1202-4000-8000-00000000d102', 'synth_mystic',       'Synth Mystic',          'active', now() - interval '61 days'),

  -- DEGREE 2: 35 users connected to some degree-1 users but NOT to owner
  -- This cohort exercises degree-2 visibility, limited/full disclosure variation
  ('d9d9d9d9-2101-4000-8000-00000000d201', 'd9d9d9d9-2102-4000-8000-00000000d202', 'sand_drifter',       'Sand Drifter',          'active', now() - interval '58 days'),
  ('d9d9d9d9-2201-4000-8000-00000000d201', 'd9d9d9d9-2202-4000-8000-00000000d202', 'mosaic_soul',        'Mosaic Soul',            'active', now() - interval '56 days'),
  ('d9d9d9d9-2301-4000-8000-00000000d201', 'd9d9d9d9-2302-4000-8000-00000000d202', 'flame_heart',        'Flame Heart',            'active', now() - interval '54 days'),
  ('d9d9d9d9-2401-4000-8000-00000000d201', 'd9d9d9d9-2402-4000-8000-00000000d202', 'cosmic_jest',        'Cosmic Jest',            'active', now() - interval '52 days'),
  ('d9d9d9d9-2501-4000-8000-00000000d201', 'd9d9d9d9-2502-4000-8000-00000000d202', 'prism_walker',       'Prism Walker',           'active', now() - interval '50 days'),
  ('d9d9d9d9-2601-4000-8000-00000000d201', 'd9d9d9d9-2602-4000-8000-00000000d202', 'dune_singer',        'Dune Singer',            'active', now() - interval '48 days'),
  ('d9d9d9d9-2701-4000-8000-00000000d201', 'd9d9d9d9-2702-4000-8000-00000000d202', 'twilight_guide',      'Twilight Guide',         'active', now() - interval '46 days'),
  ('d9d9d9d9-2801-4000-8000-00000000d201', 'd9d9d9d9-2802-4000-8000-00000000d202', 'pulse_finder',       'Pulse Finder',           'active', now() - interval '44 days'),
  ('d9d9d9d9-2901-4000-8000-00000000d201', 'd9d9d9d9-2902-4000-8000-00000000d202', 'echo_weaver',        'Echo Weaver',            'active', now() - interval '42 days'),
  ('d9d9d9d9-3001-4000-8000-00000000d201', 'd9d9d9d9-3002-4000-8000-00000000d202', 'matrix_dreamer',     'Matrix Dreamer',         'active', now() - interval '40 days'),
  ('d9d9d9d9-3101-4000-8000-00000000d201', 'd9d9d9d9-3102-4000-8000-00000000d202', 'lantern_soul',       'Lantern Soul',           'active', now() - interval '38 days'),
  ('d9d9d9d9-3201-4000-8000-00000000d201', 'd9d9d9d9-3202-4000-8000-00000000d202', 'horizon_seeker',     'Horizon Seeker',         'active', now() - interval '36 days'),
  ('d9d9d9d9-3301-4000-8000-00000000d201', 'd9d9d9d9-3302-4000-8000-00000000d202', 'star_sailor',        'Star Sailor',            'active', now() - interval '34 days'),
  ('d9d9d9d9-3401-4000-8000-00000000d201', 'd9d9d9d9-3402-4000-8000-00000000d202', 'gentle_nomad',       'Gentle Nomad',           'active', now() - interval '32 days'),
  ('d9d9d9d9-3501-4000-8000-00000000d201', 'd9d9d9d9-3502-4000-8000-00000000d202', 'luminous_path',      'Luminous Path',          'active', now() - interval '30 days'),
  ('d9d9d9d9-3601-4000-8000-00000000d201', 'd9d9d9d9-3602-4000-8000-00000000d202', 'spirit_guide',       'Spirit Guide',           'active', now() - interval '28 days'),
  ('d9d9d9d9-3701-4000-8000-00000000d201', 'd9d9d9d9-3702-4000-8000-00000000d202', 'rhythm_keeper',      'Rhythm Keeper',          'active', now() - interval '26 days'),
  ('d9d9d9d9-3801-4000-8000-00000000d201', 'd9d9d9d9-3802-4000-8000-00000000d202', 'silent_watcher',     'Silent Watcher',         'active', now() - interval '24 days'),
  ('d9d9d9d9-3901-4000-8000-00000000d201', 'd9d9d9d9-3902-4000-8000-00000000d202', 'journey_sage',       'Journey Sage',           'active', now() - interval '22 days'),
  ('d9d9d9d9-4001-4000-8000-00000000d201', 'd9d9d9d9-4002-4000-8000-00000000d202', 'wild_dancer',        'Wild Dancer',            'active', now() - interval '20 days'),
  ('d9d9d9d9-4101-4000-8000-00000000d201', 'd9d9d9d9-4102-4000-8000-00000000d202', 'crystal_mind',       'Crystal Mind',           'active', now() - interval '18 days'),
  ('d9d9d9d9-4201-4000-8000-00000000d201', 'd9d9d9d9-4202-4000-8000-00000000d202', 'bright_hope',        'Bright Hope',            'active', now() - interval '16 days'),
  ('d9d9d9d9-4301-4000-8000-00000000d201', 'd9d9d9d9-4302-4000-8000-00000000d202', 'secret_keeper',      'Secret Keeper',          'active', now() - interval '14 days'),
  ('d9d9d9d9-4401-4000-8000-00000000d201', 'd9d9d9d9-4402-4000-8000-00000000d202', 'desert_prince',      'Desert Prince',          'active', now() - interval '12 days'),
  ('d9d9d9d9-4501-4000-8000-00000000d201', 'd9d9d9d9-4502-4000-8000-00000000d202', 'twilight_lover',     'Twilight Lover',         'active', now() - interval '10 days'),
  ('d9d9d9d9-4601-4000-8000-00000000d201', 'd9d9d9d9-4602-4000-8000-00000000d202', 'phantom_muse',       'Phantom Muse',           'active', now() - interval '8 days'),
  ('d9d9d9d9-4701-4000-8000-00000000d201', 'd9d9d9d9-4702-4000-8000-00000000d202', 'silent_poet',        'Silent Poet',            'active', now() - interval '6 days'),
  ('d9d9d9d9-4801-4000-8000-00000000d201', 'd9d9d9d9-4802-4000-8000-00000000d202', 'solar_seeker',       'Solar Seeker',           'active', now() - interval '4 days'),
  ('d9d9d9d9-4901-4000-8000-00000000d201', 'd9d9d9d9-4902-4000-8000-00000000d202', 'celestial_friend',   'Celestial Friend',       'active', now() - interval '2 days'),
  ('d9d9d9d9-5001-4000-8000-00000000d201', 'd9d9d9d9-5002-4000-8000-00000000d202', 'free_spirit',        'Free Spirit',            'active', now() - interval '1 days'),

  -- DEGREE 3: 35 users connected to degree-2 but isolated from owner
  -- This cohort exercises degree-3 invisibility, topology-only disclosure
  ('d9d9d9d9-3101-4000-8000-00000000d301', 'd9d9d9d9-3102-4000-8000-00000000d302', 'canyon_caller',      'Canyon Caller',          'active', now() - interval '55 days'),
  ('d9d9d9d9-3201-4000-8000-00000000d301', 'd9d9d9d9-3202-4000-8000-00000000d302', 'stone_keeper',       'Stone Keeper',           'active', now() - interval '53 days'),
  ('d9d9d9d9-3301-4000-8000-00000000d301', 'd9d9d9d9-3302-4000-8000-00000000d302', 'wind_listener',      'Wind Listener',          'active', now() - interval '51 days'),
  ('d9d9d9d9-3401-4000-8000-00000000d301', 'd9d9d9d9-3402-4000-8000-00000000d302', 'shadow_dancer',      'Shadow Dancer',          'active', now() - interval '49 days'),
  ('d9d9d9d9-3501-4000-8000-00000000d301', 'd9d9d9d9-3502-4000-8000-00000000d302', 'starlight_soul',     'Starlight Soul',         'active', now() - interval '47 days'),
  ('d9d9d9d9-3601-4000-8000-00000000d301', 'd9d9d9d9-3602-4000-8000-00000000d302', 'brave_heart',        'Brave Heart',            'active', now() - interval '45 days'),
  ('d9d9d9d9-3701-4000-8000-00000000d301', 'd9d9d9d9-3702-4000-8000-00000000d302', 'lightning_child',    'Lightning Child',        'active', now() - interval '43 days'),
  ('d9d9d9d9-3801-4000-8000-00000000d301', 'd9d9d9d9-3802-4000-8000-00000000d302', 'mystic_flame',       'Mystic Flame',           'active', now() - interval '41 days'),
  ('d9d9d9d9-3901-4000-8000-00000000d301', 'd9d9d9d9-3902-4000-8000-00000000d302', 'silver_tongue',      'Silver Tongue',          'active', now() - interval '39 days'),
  ('d9d9d9d9-4001-4000-8000-00000000d301', 'd9d9d9d9-4002-4000-8000-00000000d302', 'gentle_flame',       'Gentle Flame',           'active', now() - interval '37 days'),
  ('d9d9d9d9-4101-4000-8000-00000000d301', 'd9d9d9d9-4102-4000-8000-00000000d302', 'wandering_soul',     'Wandering Soul',         'active', now() - interval '35 days'),
  ('d9d9d9d9-4201-4000-8000-00000000d301', 'd9d9d9d9-4202-4000-8000-00000000d302', 'peace_maker',        'Peace Maker',            'active', now() - interval '33 days'),
  ('d9d9d9d9-4301-4000-8000-00000000d301', 'd9d9d9d9-4302-4000-8000-00000000d302', 'bright_beacon',      'Bright Beacon',          'active', now() - interval '31 days'),
  ('d9d9d9d9-4401-4000-8000-00000000d301', 'd9d9d9d9-4402-4000-8000-00000000d302', 'quiet_storm',        'Quiet Storm',            'active', now() - interval '29 days'),
  ('d9d9d9d9-4501-4000-8000-00000000d301', 'd9d9d9d9-4502-4000-8000-00000000d302', 'lost_wanderer',      'Lost Wanderer',          'active', now() - interval '27 days'),
  ('d9d9d9d9-4601-4000-8000-00000000d301', 'd9d9d9d9-4602-4000-8000-00000000d302', 'true_north',         'True North',             'active', now() - interval '25 days'),
  ('d9d9d9d9-4701-4000-8000-00000000d301', 'd9d9d9d9-4702-4000-8000-00000000d302', 'moonlight_guide',    'Moonlight Guide',        'active', now() - interval '23 days'),
  ('d9d9d9d9-4801-4000-8000-00000000d301', 'd9d9d9d9-4802-4000-8000-00000000d302', 'deep_dream',         'Deep Dream',             'active', now() - interval '21 days'),
  ('d9d9d9d9-4901-4000-8000-00000000d301', 'd9d9d9d9-4902-4000-8000-00000000d302', 'cosmic_voice',       'Cosmic Voice',           'active', now() - interval '19 days'),
  ('d9d9d9d9-5001-4000-8000-00000000d301', 'd9d9d9d9-5002-4000-8000-00000000d302', 'dance_eternal',      'Dance Eternal',          'active', now() - interval '17 days'),
  ('d9d9d9d9-5101-4000-8000-00000000d301', 'd9d9d9d9-5102-4000-8000-00000000d302', 'wise_elder',         'Wise Elder',             'active', now() - interval '15 days'),
  ('d9d9d9d9-5201-4000-8000-00000000d301', 'd9d9d9d9-5202-4000-8000-00000000d302', 'sacred_path',        'Sacred Path',            'active', now() - interval '13 days'),
  ('d9d9d9d9-5301-4000-8000-00000000d301', 'd9d9d9d9-5302-4000-8000-00000000d302', 'silver_dream',       'Silver Dream',           'active', now() - interval '11 days'),
  ('d9d9d9d9-5401-4000-8000-00000000d301', 'd9d9d9d9-5402-4000-8000-00000000d302', 'endless_journey',    'Endless Journey',         'active', now() - interval '9 days'),
  ('d9d9d9d9-5501-4000-8000-00000000d301', 'd9d9d9d9-5502-4000-8000-00000000d302', 'eternal_flame',      'Eternal Flame',          'active', now() - interval '7 days'),
  ('d9d9d9d9-5601-4000-8000-00000000d301', 'd9d9d9d9-5602-4000-8000-00000000d302', 'ocean_breeze',       'Ocean Breeze',           'active', now() - interval '5 days'),
  ('d9d9d9d9-5701-4000-8000-00000000d301', 'd9d9d9d9-5702-4000-8000-00000000d302', 'wild_heart',         'Wild Heart',             'active', now() - interval '3 days'),
  ('d9d9d9d9-5801-4000-8000-00000000d301', 'd9d9d9d9-5802-4000-8000-00000000d302', 'radiant_soul',       'Radiant Soul',           'active', now() - interval '1 days'),

  -- DISCONNECTED: 18 users in separate clusters the owner cannot reach
  -- This cohort exercises visibility boundaries, network isolation
  ('d9d9d9d9-6101-4000-8000-00000000dd01', 'd9d9d9d9-6102-4000-8000-00000000dd02', 'isolated_dreamer',   'Isolated Dreamer',       'active', now() - interval '75 days'),
  ('d9d9d9d9-6201-4000-8000-00000000dd01', 'd9d9d9d9-6202-4000-8000-00000000dd02', 'separate_soul',      'Separate Soul',          'active', now() - interval '72 days'),
  ('d9d9d9d9-6301-4000-8000-00000000dd01', 'd9d9d9d9-6302-4000-8000-00000000dd02', 'hidden_path',        'Hidden Path',            'active', now() - interval '69 days'),
  ('d9d9d9d9-6401-4000-8000-00000000dd01', 'd9d9d9d9-6402-4000-8000-00000000dd02', 'distant_echo',       'Distant Echo',           'active', now() - interval '66 days'),
  ('d9d9d9d9-6501-4000-8000-00000000dd01', 'd9d9d9d9-6502-4000-8000-00000000dd02', 'hidden_voice',       'Hidden Voice',           'active', now() - interval '63 days'),
  ('d9d9d9d9-6601-4000-8000-00000000dd01', 'd9d9d9d9-6602-4000-8000-00000000dd02', 'veiled_mystery',     'Veiled Mystery',         'active', now() - interval '60 days'),
  ('d9d9d9d9-6701-4000-8000-00000000dd01', 'd9d9d9d9-6702-4000-8000-00000000dd02', 'unknown_traveler',   'Unknown Traveler',       'active', now() - interval '57 days'),
  ('d9d9d9d9-6801-4000-8000-00000000dd01', 'd9d9d9d9-6802-4000-8000-00000000dd02', 'shadow_friend',      'Shadow Friend',          'active', now() - interval '54 days'),
  ('d9d9d9d9-6901-4000-8000-00000000dd01', 'd9d9d9d9-6902-4000-8000-00000000dd02', 'silent_soul',        'Silent Soul',            'active', now() - interval '51 days'),
  ('d9d9d9d9-7001-4000-8000-00000000dd01', 'd9d9d9d9-7002-4000-8000-00000000dd02', 'other_realm',        'Other Realm',            'active', now() - interval '48 days'),
  ('d9d9d9d9-7101-4000-8000-00000000dd01', 'd9d9d9d9-7102-4000-8000-00000000dd02', 'invisible_friend',   'Invisible Friend',       'active', now() - interval '45 days'),
  ('d9d9d9d9-7201-4000-8000-00000000dd01', 'd9d9d9d9-7202-4000-8000-00000000dd02', 'parallel_traveler',  'Parallel Traveler',      'active', now() - interval '42 days'),
  ('d9d9d9d9-7301-4000-8000-00000000dd01', 'd9d9d9d9-7302-4000-8000-00000000dd02', 'alternate_journey',  'Alternate Journey',      'active', now() - interval '39 days'),
  ('d9d9d9d9-7401-4000-8000-00000000dd01', 'd9d9d9d9-7402-4000-8000-00000000dd02', 'beyond_sight',       'Beyond Sight',           'active', now() - interval '36 days'),
  ('d9d9d9d9-7501-4000-8000-00000000dd01', 'd9d9d9d9-7502-4000-8000-00000000dd02', 'distant_dancer',     'Distant Dancer',         'active', now() - interval '33 days'),
  ('d9d9d9d9-7601-4000-8000-00000000dd01', 'd9d9d9d9-7602-4000-8000-00000000dd02', 'untouched_soul',     'Untouched Soul',         'active', now() - interval '30 days'),
  ('d9d9d9d9-7701-4000-8000-00000000dd01', 'd9d9d9d9-7702-4000-8000-00000000dd02', 'unreachable_light',  'Unreachable Light',      'active', now() - interval '27 days'),
  ('d9d9d9d9-7801-4000-8000-00000000dd01', 'd9d9d9d9-7802-4000-8000-00000000dd02', 'isolated_realm',     'Isolated Realm',         'active', now() - interval '24 days')
on conflict (auth_user_id) do nothing;

-- ---------------------------------------------------------------------------
-- 2. app.connections — the graph edges forming the network structure
-- ---------------------------------------------------------------------------
-- Owner: d9d8c4d9-419c-43e6-9d75-d9f8ede06e05

-- Degree 1: Owner directly connected to 12 users
-- These are full, accepted, bi-directional connections
insert into app.connections
  (user_a_id, user_b_id, status, a_discloses_to_b_level, b_discloses_to_a_level, created_at)
values
  -- Connect owner (lower id) to each degree-1 user
  ('d9d8c4d9-419c-43e6-9d75-d9f8ede06e05', 'd9d9d9d9-0101-4000-8000-00000000d101', 'accepted', 'full', 'full', now() - interval '94 days'),
  ('d9d8c4d9-419c-43e6-9d75-d9f8ede06e05', 'd9d9d9d9-0201-4000-8000-00000000d101', 'accepted', 'full', 'full', now() - interval '90 days'),
  ('d9d8c4d9-419c-43e6-9d75-d9f8ede06e05', 'd9d9d9d9-0301-4000-8000-00000000d101', 'accepted', 'full', 'full', now() - interval '87 days'),
  ('d9d8c4d9-419c-43e6-9d75-d9f8ede06e05', 'd9d9d9d9-0401-4000-8000-00000000d101', 'accepted', 'full', 'full', now() - interval '84 days'),
  ('d9d8c4d9-419c-43e6-9d75-d9f8ede06e05', 'd9d9d9d9-0501-4000-8000-00000000d101', 'accepted', 'full', 'full', now() - interval '81 days'),
  ('d9d8c4d9-419c-43e6-9d75-d9f8ede06e05', 'd9d9d9d9-0601-4000-8000-00000000d101', 'accepted', 'full', 'full', now() - interval '78 days'),
  ('d9d8c4d9-419c-43e6-9d75-d9f8ede06e05', 'd9d9d9d9-0701-4000-8000-00000000d101', 'accepted', 'full', 'full', now() - interval '75 days'),
  ('d9d8c4d9-419c-43e6-9d75-d9f8ede06e05', 'd9d9d9d9-0801-4000-8000-00000000d101', 'accepted', 'full', 'full', now() - interval '72 days'),
  ('d9d8c4d9-419c-43e6-9d75-d9f8ede06e05', 'd9d9d9d9-0901-4000-8000-00000000d101', 'accepted', 'full', 'full', now() - interval '69 days'),
  ('d9d8c4d9-419c-43e6-9d75-d9f8ede06e05', 'd9d9d9d9-1001-4000-8000-00000000d101', 'accepted', 'full', 'full', now() - interval '66 days'),
  ('d9d8c4d9-419c-43e6-9d75-d9f8ede06e05', 'd9d9d9d9-1101-4000-8000-00000000d101', 'accepted', 'full', 'full', now() - interval '63 days'),
  ('d9d8c4d9-419c-43e6-9d75-d9f8ede06e05', 'd9d9d9d9-1201-4000-8000-00000000d101', 'accepted', 'full', 'full', now() - interval '60 days'),

  -- Degree 2 to Degree 1: 35 degree-2 users connect to degree-1 users
  -- Most connect to 2-3 degree-1 users to create realistic fan-out
  ('d9d9d9d9-0101-4000-8000-00000000d101', 'd9d9d9d9-2101-4000-8000-00000000d201', 'accepted', 'full', 'full', now() - interval '57 days'),
  ('d9d9d9d9-0201-4000-8000-00000000d101', 'd9d9d9d9-2101-4000-8000-00000000d201', 'accepted', 'full', 'limited', now() - interval '56 days'),
  ('d9d9d9d9-0101-4000-8000-00000000d101', 'd9d9d9d9-2201-4000-8000-00000000d201', 'accepted', 'full', 'full', now() - interval '55 days'),
  ('d9d9d9d9-0301-4000-8000-00000000d101', 'd9d9d9d9-2201-4000-8000-00000000d201', 'accepted', 'full', 'limited', now() - interval '54 days'),
  ('d9d9d9d9-0201-4000-8000-00000000d101', 'd9d9d9d9-2301-4000-8000-00000000d201', 'accepted', 'full', 'full', now() - interval '53 days'),
  ('d9d9d9d9-0401-4000-8000-00000000d101', 'd9d9d9d9-2301-4000-8000-00000000d201', 'accepted', 'limited', 'full', now() - interval '52 days'),
  ('d9d9d9d9-0301-4000-8000-00000000d101', 'd9d9d9d9-2401-4000-8000-00000000d201', 'accepted', 'full', 'limited', now() - interval '51 days'),
  ('d9d9d9d9-0501-4000-8000-00000000d101', 'd9d9d9d9-2401-4000-8000-00000000d201', 'accepted', 'full', 'full', now() - interval '50 days'),
  ('d9d9d9d9-0401-4000-8000-00000000d101', 'd9d9d9d9-2501-4000-8000-00000000d201', 'accepted', 'full', 'full', now() - interval '49 days'),
  ('d9d9d9d9-0601-4000-8000-00000000d101', 'd9d9d9d9-2501-4000-8000-00000000d201', 'accepted', 'full', 'limited', now() - interval '48 days'),
  ('d9d9d9d9-0501-4000-8000-00000000d101', 'd9d9d9d9-2601-4000-8000-00000000d201', 'accepted', 'full', 'full', now() - interval '47 days'),
  ('d9d9d9d9-0701-4000-8000-00000000d101', 'd9d9d9d9-2601-4000-8000-00000000d201', 'accepted', 'full', 'full', now() - interval '46 days'),
  ('d9d9d9d9-0601-4000-8000-00000000d101', 'd9d9d9d9-2701-4000-8000-00000000d201', 'accepted', 'full', 'limited', now() - interval '45 days'),
  ('d9d9d9d9-0801-4000-8000-00000000d101', 'd9d9d9d9-2701-4000-8000-00000000d201', 'accepted', 'full', 'full', now() - interval '44 days'),
  ('d9d9d9d9-0701-4000-8000-00000000d101', 'd9d9d9d9-2801-4000-8000-00000000d201', 'accepted', 'full', 'full', now() - interval '43 days'),
  ('d9d9d9d9-0901-4000-8000-00000000d101', 'd9d9d9d9-2801-4000-8000-00000000d201', 'accepted', 'limited', 'full', now() - interval '42 days'),
  ('d9d9d9d9-0801-4000-8000-00000000d101', 'd9d9d9d9-2901-4000-8000-00000000d201', 'accepted', 'full', 'full', now() - interval '41 days'),
  ('d9d9d9d9-1001-4000-8000-00000000d101', 'd9d9d9d9-2901-4000-8000-00000000d201', 'accepted', 'full', 'full', now() - interval '40 days'),
  ('d9d9d9d9-0901-4000-8000-00000000d101', 'd9d9d9d9-3001-4000-8000-00000000d201', 'accepted', 'full', 'full', now() - interval '39 days'),
  ('d9d9d9d9-1101-4000-8000-00000000d101', 'd9d9d9d9-3001-4000-8000-00000000d201', 'accepted', 'full', 'limited', now() - interval '38 days'),
  ('d9d9d9d9-1001-4000-8000-00000000d101', 'd9d9d9d9-3101-4000-8000-00000000d201', 'accepted', 'full', 'full', now() - interval '37 days'),
  ('d9d9d9d9-1201-4000-8000-00000000d101', 'd9d9d9d9-3101-4000-8000-00000000d201', 'accepted', 'full', 'full', now() - interval '36 days'),
  ('d9d9d9d9-1101-4000-8000-00000000d101', 'd9d9d9d9-3201-4000-8000-00000000d201', 'accepted', 'full', 'full', now() - interval '35 days'),
  ('d9d9d9d9-0601-4000-8000-00000000d101', 'd9d9d9d9-3201-4000-8000-00000000d201', 'accepted', 'full', 'limited', now() - interval '34 days'),
  ('d9d9d9d9-1201-4000-8000-00000000d101', 'd9d9d9d9-3301-4000-8000-00000000d201', 'accepted', 'full', 'full', now() - interval '33 days'),
  ('d9d9d9d9-0401-4000-8000-00000000d101', 'd9d9d9d9-3301-4000-8000-00000000d201', 'accepted', 'limited', 'full', now() - interval '32 days'),
  ('d9d9d9d9-0501-4000-8000-00000000d101', 'd9d9d9d9-3401-4000-8000-00000000d201', 'accepted', 'full', 'full', now() - interval '31 days'),
  ('d9d9d9d9-0801-4000-8000-00000000d101', 'd9d9d9d9-3401-4000-8000-00000000d201', 'accepted', 'full', 'full', now() - interval '30 days'),
  ('d9d9d9d9-0701-4000-8000-00000000d101', 'd9d9d9d9-3501-4000-8000-00000000d201', 'accepted', 'full', 'limited', now() - interval '29 days'),
  ('d9d9d9d9-0901-4000-8000-00000000d101', 'd9d9d9d9-3501-4000-8000-00000000d201', 'accepted', 'full', 'full', now() - interval '28 days'),
  ('d9d9d9d9-1001-4000-8000-00000000d101', 'd9d9d9d9-3601-4000-8000-00000000d201', 'accepted', 'full', 'full', now() - interval '27 days'),
  ('d9d9d9d9-0301-4000-8000-00000000d101', 'd9d9d9d9-3601-4000-8000-00000000d201', 'accepted', 'full', 'limited', now() - interval '26 days'),
  ('d9d9d9d9-1101-4000-8000-00000000d101', 'd9d9d9d9-3701-4000-8000-00000000d201', 'accepted', 'full', 'full', now() - interval '25 days'),
  ('d9d9d9d9-0201-4000-8000-00000000d101', 'd9d9d9d9-3701-4000-8000-00000000d201', 'accepted', 'full', 'full', now() - interval '24 days'),
  ('d9d9d9d9-1201-4000-8000-00000000d101', 'd9d9d9d9-3801-4000-8000-00000000d201', 'accepted', 'full', 'limited', now() - interval '23 days'),
  ('d9d9d9d9-0601-4000-8000-00000000d101', 'd9d9d9d9-3801-4000-8000-00000000d201', 'accepted', 'full', 'full', now() - interval '22 days'),
  ('d9d9d9d9-0501-4000-8000-00000000d101', 'd9d9d9d9-3901-4000-8000-00000000d201', 'accepted', 'full', 'full', now() - interval '21 days'),
  ('d9d9d9d9-0701-4000-8000-00000000d101', 'd9d9d9d9-3901-4000-8000-00000000d201', 'accepted', 'full', 'full', now() - interval '20 days'),
  ('d9d9d9d9-0801-4000-8000-00000000d101', 'd9d9d9d9-4001-4000-8000-00000000d201', 'accepted', 'full', 'limited', now() - interval '19 days'),
  ('d9d9d9d9-0901-4000-8000-00000000d101', 'd9d9d9d9-4001-4000-8000-00000000d201', 'accepted', 'full', 'full', now() - interval '18 days'),
  ('d9d9d9d9-1001-4000-8000-00000000d101', 'd9d9d9d9-4101-4000-8000-00000000d201', 'accepted', 'full', 'full', now() - interval '17 days'),
  ('d9d9d9d9-1101-4000-8000-00000000d101', 'd9d9d9d9-4101-4000-8000-00000000d201', 'accepted', 'full', 'limited', now() - interval '16 days'),
  ('d9d9d9d9-1201-4000-8000-00000000d101', 'd9d9d9d9-4201-4000-8000-00000000d201', 'accepted', 'full', 'full', now() - interval '15 days'),
  ('d9d9d9d9-0301-4000-8000-00000000d101', 'd9d9d9d9-4201-4000-8000-00000000d201', 'accepted', 'full', 'full', now() - interval '14 days'),
  ('d9d9d9d9-0401-4000-8000-00000000d101', 'd9d9d9d9-4301-4000-8000-00000000d201', 'accepted', 'limited', 'full', now() - interval '13 days'),
  ('d9d9d9d9-0501-4000-8000-00000000d101', 'd9d9d9d9-4301-4000-8000-00000000d201', 'accepted', 'full', 'full', now() - interval '12 days'),
  ('d9d9d9d9-0601-4000-8000-00000000d101', 'd9d9d9d9-4401-4000-8000-00000000d201', 'accepted', 'full', 'full', now() - interval '11 days'),
  ('d9d9d9d9-0701-4000-8000-00000000d101', 'd9d9d9d9-4401-4000-8000-00000000d201', 'accepted', 'full', 'limited', now() - interval '10 days'),
  ('d9d9d9d9-0801-4000-8000-00000000d101', 'd9d9d9d9-4501-4000-8000-00000000d201', 'accepted', 'full', 'full', now() - interval '9 days'),
  ('d9d9d9d9-0901-4000-8000-00000000d101', 'd9d9d9d9-4501-4000-8000-00000000d201', 'accepted', 'full', 'full', now() - interval '8 days'),
  ('d9d9d9d9-1001-4000-8000-00000000d101', 'd9d9d9d9-4601-4000-8000-00000000d201', 'accepted', 'full', 'limited', now() - interval '7 days'),
  ('d9d9d9d9-1101-4000-8000-00000000d101', 'd9d9d9d9-4601-4000-8000-00000000d201', 'accepted', 'full', 'full', now() - interval '6 days'),
  ('d9d9d9d9-1201-4000-8000-00000000d101', 'd9d9d9d9-4701-4000-8000-00000000d201', 'accepted', 'full', 'full', now() - interval '5 days'),
  ('d9d9d9d9-0201-4000-8000-00000000d101', 'd9d9d9d9-4701-4000-8000-00000000d201', 'accepted', 'full', 'full', now() - interval '4 days'),
  ('d9d9d9d9-0301-4000-8000-00000000d101', 'd9d9d9d9-4801-4000-8000-00000000d201', 'accepted', 'full', 'limited', now() - interval '3 days'),
  ('d9d9d9d9-0401-4000-8000-00000000d101', 'd9d9d9d9-4801-4000-8000-00000000d201', 'accepted', 'full', 'full', now() - interval '2 days'),
  ('d9d9d9d9-0501-4000-8000-00000000d101', 'd9d9d9d9-4901-4000-8000-00000000d201', 'accepted', 'full', 'full', now() - interval '1 days'),
  ('d9d9d9d9-0601-4000-8000-00000000d101', 'd9d9d9d9-4901-4000-8000-00000000d201', 'accepted', 'full', 'limited', now() - interval '6 hours'),
  ('d9d9d9d9-0701-4000-8000-00000000d101', 'd9d9d9d9-5001-4000-8000-00000000d201', 'accepted', 'full', 'full', now() - interval '3 hours'),
  ('d9d9d9d9-0801-4000-8000-00000000d101', 'd9d9d9d9-5001-4000-8000-00000000d201', 'accepted', 'full', 'full', now() - interval '1 hours'),

  -- Degree 3 to Degree 2: 35 degree-3 users connect to degree-2 users
  -- This creates the degree-3 layer with limited disclosure visibility
  ('d9d9d9d9-2101-4000-8000-00000000d201', 'd9d9d9d9-3101-4000-8000-00000000d301', 'accepted', 'full', 'limited', now() - interval '54 days'),
  ('d9d9d9d9-2201-4000-8000-00000000d201', 'd9d9d9d9-3101-4000-8000-00000000d301', 'accepted', 'limited', 'full', now() - interval '53 days'),
  ('d9d9d9d9-2101-4000-8000-00000000d201', 'd9d9d9d9-3201-4000-8000-00000000d301', 'accepted', 'full', 'full', now() - interval '52 days'),
  ('d9d9d9d9-2301-4000-8000-00000000d201', 'd9d9d9d9-3201-4000-8000-00000000d301', 'accepted', 'full', 'limited', now() - interval '51 days'),
  ('d9d9d9d9-2201-4000-8000-00000000d201', 'd9d9d9d9-3301-4000-8000-00000000d301', 'accepted', 'full', 'full', now() - interval '50 days'),
  ('d9d9d9d9-2401-4000-8000-00000000d201', 'd9d9d9d9-3301-4000-8000-00000000d301', 'accepted', 'full', 'full', now() - interval '49 days'),
  ('d9d9d9d9-2301-4000-8000-00000000d201', 'd9d9d9d9-3401-4000-8000-00000000d301', 'accepted', 'limited', 'full', now() - interval '48 days'),
  ('d9d9d9d9-2501-4000-8000-00000000d201', 'd9d9d9d9-3401-4000-8000-00000000d301', 'accepted', 'full', 'full', now() - interval '47 days'),
  ('d9d9d9d9-2401-4000-8000-00000000d201', 'd9d9d9d9-3501-4000-8000-00000000d301', 'accepted', 'full', 'limited', now() - interval '46 days'),
  ('d9d9d9d9-2601-4000-8000-00000000d201', 'd9d9d9d9-3501-4000-8000-00000000d301', 'accepted', 'full', 'full', now() - interval '45 days'),
  ('d9d9d9d9-2501-4000-8000-00000000d201', 'd9d9d9d9-3601-4000-8000-00000000d301', 'accepted', 'full', 'full', now() - interval '44 days'),
  ('d9d9d9d9-2701-4000-8000-00000000d201', 'd9d9d9d9-3601-4000-8000-00000000d301', 'accepted', 'full', 'limited', now() - interval '43 days'),
  ('d9d9d9d9-2601-4000-8000-00000000d201', 'd9d9d9d9-3701-4000-8000-00000000d301', 'accepted', 'full', 'full', now() - interval '42 days'),
  ('d9d9d9d9-2801-4000-8000-00000000d201', 'd9d9d9d9-3701-4000-8000-00000000d301', 'accepted', 'full', 'full', now() - interval '41 days'),
  ('d9d9d9d9-2701-4000-8000-00000000d201', 'd9d9d9d9-3801-4000-8000-00000000d301', 'accepted', 'limited', 'full', now() - interval '40 days'),
  ('d9d9d9d9-2901-4000-8000-00000000d201', 'd9d9d9d9-3801-4000-8000-00000000d301', 'accepted', 'full', 'full', now() - interval '39 days'),
  ('d9d9d9d9-2801-4000-8000-00000000d201', 'd9d9d9d9-3901-4000-8000-00000000d301', 'accepted', 'full', 'full', now() - interval '38 days'),
  ('d9d9d9d9-3001-4000-8000-00000000d201', 'd9d9d9d9-3901-4000-8000-00000000d301', 'accepted', 'full', 'limited', now() - interval '37 days'),
  ('d9d9d9d9-2901-4000-8000-00000000d201', 'd9d9d9d9-4001-4000-8000-00000000d301', 'accepted', 'full', 'full', now() - interval '36 days'),
  ('d9d9d9d9-3101-4000-8000-00000000d201', 'd9d9d9d9-4001-4000-8000-00000000d301', 'accepted', 'full', 'full', now() - interval '35 days'),
  ('d9d9d9d9-3001-4000-8000-00000000d201', 'd9d9d9d9-4101-4000-8000-00000000d301', 'accepted', 'full', 'limited', now() - interval '34 days'),
  ('d9d9d9d9-3201-4000-8000-00000000d201', 'd9d9d9d9-4101-4000-8000-00000000d301', 'accepted', 'full', 'full', now() - interval '33 days'),
  ('d9d9d9d9-3101-4000-8000-00000000d201', 'd9d9d9d9-4201-4000-8000-00000000d301', 'accepted', 'full', 'full', now() - interval '32 days'),
  ('d9d9d9d9-3301-4000-8000-00000000d201', 'd9d9d9d9-4201-4000-8000-00000000d301', 'accepted', 'full', 'limited', now() - interval '31 days'),
  ('d9d9d9d9-3201-4000-8000-00000000d201', 'd9d9d9d9-4301-4000-8000-00000000d301', 'accepted', 'limited', 'full', now() - interval '30 days'),
  ('d9d9d9d9-3401-4000-8000-00000000d201', 'd9d9d9d9-4301-4000-8000-00000000d301', 'accepted', 'full', 'full', now() - interval '29 days'),
  ('d9d9d9d9-3301-4000-8000-00000000d201', 'd9d9d9d9-4401-4000-8000-00000000d301', 'accepted', 'full', 'full', now() - interval '28 days'),
  ('d9d9d9d9-3501-4000-8000-00000000d201', 'd9d9d9d9-4401-4000-8000-00000000d301', 'accepted', 'full', 'limited', now() - interval '27 days'),
  ('d9d9d9d9-3401-4000-8000-00000000d201', 'd9d9d9d9-4501-4000-8000-00000000d301', 'accepted', 'full', 'full', now() - interval '26 days'),
  ('d9d9d9d9-3601-4000-8000-00000000d201', 'd9d9d9d9-4501-4000-8000-00000000d301', 'accepted', 'full', 'full', now() - interval '25 days'),
  ('d9d9d9d9-3501-4000-8000-00000000d201', 'd9d9d9d9-4601-4000-8000-00000000d301', 'accepted', 'full', 'limited', now() - interval '24 days'),
  ('d9d9d9d9-3701-4000-8000-00000000d201', 'd9d9d9d9-4601-4000-8000-00000000d301', 'accepted', 'full', 'full', now() - interval '23 days'),
  ('d9d9d9d9-3601-4000-8000-00000000d201', 'd9d9d9d9-4701-4000-8000-00000000d301', 'accepted', 'full', 'full', now() - interval '22 days'),
  ('d9d9d9d9-3801-4000-8000-00000000d201', 'd9d9d9d9-4701-4000-8000-00000000d301', 'accepted', 'limited', 'full', now() - interval '21 days'),
  ('d9d9d9d9-3701-4000-8000-00000000d201', 'd9d9d9d9-4801-4000-8000-00000000d301', 'accepted', 'full', 'full', now() - interval '20 days'),
  ('d9d9d9d9-3901-4000-8000-00000000d201', 'd9d9d9d9-4801-4000-8000-00000000d301', 'accepted', 'full', 'limited', now() - interval '19 days'),
  ('d9d9d9d9-3801-4000-8000-00000000d201', 'd9d9d9d9-4901-4000-8000-00000000d301', 'accepted', 'full', 'full', now() - interval '18 days'),
  ('d9d9d9d9-4001-4000-8000-00000000d201', 'd9d9d9d9-4901-4000-8000-00000000d301', 'accepted', 'full', 'full', now() - interval '17 days'),
  ('d9d9d9d9-3901-4000-8000-00000000d201', 'd9d9d9d9-5001-4000-8000-00000000d301', 'accepted', 'full', 'limited', now() - interval '16 days'),
  ('d9d9d9d9-4101-4000-8000-00000000d201', 'd9d9d9d9-5001-4000-8000-00000000d301', 'accepted', 'full', 'full', now() - interval '15 days'),
  ('d9d9d9d9-4001-4000-8000-00000000d201', 'd9d9d9d9-5101-4000-8000-00000000d301', 'accepted', 'full', 'full', now() - interval '14 days'),
  ('d9d9d9d9-4201-4000-8000-00000000d201', 'd9d9d9d9-5101-4000-8000-00000000d301', 'accepted', 'full', 'limited', now() - interval '13 days'),
  ('d9d9d9d9-4101-4000-8000-00000000d201', 'd9d9d9d9-5201-4000-8000-00000000d301', 'accepted', 'limited', 'full', now() - interval '12 days'),
  ('d9d9d9d9-4301-4000-8000-00000000d201', 'd9d9d9d9-5201-4000-8000-00000000d301', 'accepted', 'full', 'full', now() - interval '11 days'),
  ('d9d9d9d9-4201-4000-8000-00000000d201', 'd9d9d9d9-5301-4000-8000-00000000d301', 'accepted', 'full', 'full', now() - interval '10 days'),
  ('d9d9d9d9-4401-4000-8000-00000000d201', 'd9d9d9d9-5301-4000-8000-00000000d301', 'accepted', 'full', 'limited', now() - interval '9 days'),
  ('d9d9d9d9-4301-4000-8000-00000000d201', 'd9d9d9d9-5401-4000-8000-00000000d301', 'accepted', 'full', 'full', now() - interval '8 days'),
  ('d9d9d9d9-4501-4000-8000-00000000d201', 'd9d9d9d9-5401-4000-8000-00000000d301', 'accepted', 'full', 'full', now() - interval '7 days'),
  ('d9d9d9d9-4401-4000-8000-00000000d201', 'd9d9d9d9-5501-4000-8000-00000000d301', 'accepted', 'full', 'limited', now() - interval '6 days'),
  ('d9d9d9d9-4601-4000-8000-00000000d201', 'd9d9d9d9-5501-4000-8000-00000000d301', 'accepted', 'full', 'full', now() - interval '5 days'),
  ('d9d9d9d9-4501-4000-8000-00000000d201', 'd9d9d9d9-5601-4000-8000-00000000d301', 'accepted', 'full', 'full', now() - interval '4 days'),
  ('d9d9d9d9-4701-4000-8000-00000000d201', 'd9d9d9d9-5601-4000-8000-00000000d301', 'accepted', 'full', 'limited', now() - interval '3 days'),
  ('d9d9d9d9-4601-4000-8000-00000000d201', 'd9d9d9d9-5701-4000-8000-00000000d301', 'accepted', 'full', 'full', now() - interval '2 days'),
  ('d9d9d9d9-4801-4000-8000-00000000d201', 'd9d9d9d9-5701-4000-8000-00000000d301', 'accepted', 'full', 'full', now() - interval '1 days'),
  ('d9d9d9d9-4701-4000-8000-00000000d201', 'd9d9d9d9-5801-4000-8000-00000000d301', 'accepted', 'limited', 'full', now() - interval '12 hours'),
  ('d9d9d9d9-4901-4000-8000-00000000d201', 'd9d9d9d9-5801-4000-8000-00000000d301', 'accepted', 'full', 'full', now() - interval '6 hours'),

  -- Disconnected clusters: 4 small groups of 4-5 people each, isolated from owner network
  -- These users have NO path to the owner in the graph
  ('d9d9d9d9-6101-4000-8000-00000000dd01', 'd9d9d9d9-6201-4000-8000-00000000dd01', 'accepted', 'full', 'full', now() - interval '70 days'),
  ('d9d9d9d9-6101-4000-8000-00000000dd01', 'd9d9d9d9-6301-4000-8000-00000000dd01', 'accepted', 'full', 'full', now() - interval '68 days'),
  ('d9d9d9d9-6201-4000-8000-00000000dd01', 'd9d9d9d9-6401-4000-8000-00000000dd01', 'accepted', 'full', 'full', now() - interval '65 days'),
  ('d9d9d9d9-6301-4000-8000-00000000dd01', 'd9d9d9d9-6501-4000-8000-00000000dd01', 'accepted', 'full', 'full', now() - interval '62 days'),
  ('d9d9d9d9-6401-4000-8000-00000000dd01', 'd9d9d9d9-6601-4000-8000-00000000dd01', 'accepted', 'full', 'full', now() - interval '59 days'),
  ('d9d9d9d9-6601-4000-8000-00000000dd01', 'd9d9d9d9-6701-4000-8000-00000000dd01', 'accepted', 'full', 'full', now() - interval '56 days'),
  ('d9d9d9d9-6701-4000-8000-00000000dd01', 'd9d9d9d9-6801-4000-8000-00000000dd01', 'accepted', 'full', 'full', now() - interval '53 days'),
  ('d9d9d9d9-6801-4000-8000-00000000dd01', 'd9d9d9d9-6901-4000-8000-00000000dd01', 'accepted', 'full', 'full', now() - interval '50 days'),
  ('d9d9d9d9-6901-4000-8000-00000000dd01', 'd9d9d9d9-7001-4000-8000-00000000dd01', 'accepted', 'full', 'full', now() - interval '47 days'),
  ('d9d9d9d9-7001-4000-8000-00000000dd01', 'd9d9d9d9-7101-4000-8000-00000000dd01', 'accepted', 'full', 'full', now() - interval '44 days'),
  ('d9d9d9d9-7101-4000-8000-00000000dd01', 'd9d9d9d9-7201-4000-8000-00000000dd01', 'accepted', 'full', 'full', now() - interval '41 days'),
  ('d9d9d9d9-7201-4000-8000-00000000dd01', 'd9d9d9d9-7301-4000-8000-00000000dd01', 'accepted', 'full', 'full', now() - interval '38 days'),
  ('d9d9d9d9-7301-4000-8000-00000000dd01', 'd9d9d9d9-7401-4000-8000-00000000dd01', 'accepted', 'full', 'full', now() - interval '35 days'),
  ('d9d9d9d9-7401-4000-8000-00000000dd01', 'd9d9d9d9-7501-4000-8000-00000000dd01', 'accepted', 'full', 'full', now() - interval '32 days'),
  ('d9d9d9d9-7501-4000-8000-00000000dd01', 'd9d9d9d9-7601-4000-8000-00000000dd01', 'accepted', 'full', 'full', now() - interval '29 days'),
  ('d9d9d9d9-7601-4000-8000-00000000dd01', 'd9d9d9d9-7701-4000-8000-00000000dd01', 'accepted', 'full', 'full', now() - interval '26 days'),
  ('d9d9d9d9-7701-4000-8000-00000000dd01', 'd9d9d9d9-7801-4000-8000-00000000dd01', 'accepted', 'full', 'full', now() - interval '23 days')
on conflict on constraint connections_pair_key do nothing;

-- ---------------------------------------------------------------------------
-- 3. app.bulletins — requests scattered across the network at varying distances
-- ---------------------------------------------------------------------------

insert into app.bulletins (id, author_id, type, title, body, created_at)
values
  -- Degree 1 bulletins (directly visible to owner)
  (
    'd9d9d9d9-b001-4000-8000-000000b00001',
    'd9d9d9d9-0101-4000-8000-00000000d101',
    'request',
    'Help striking shade structure this morning',
    'Camp shade roof is coming down today. Need 2-3 people for an hour, can provide coffee and good company.',
    now() - interval '3 days'
  ),
  (
    'd9d9d9d9-b002-4000-8000-000000b00002',
    'd9d9d9d9-0501-4000-8000-00000000d101',
    'request',
    'Spare medical supplies — burn kit',
    'Someone in our camp got a small propane burn on their arm. Looking for sterile gauze, antibiotic ointment, and pain relief if anyone has extras.',
    now() - interval '2 days'
  ),
  (
    'd9d9d9d9-b003-4000-8000-000000b00003',
    'd9d9d9d9-0901-4000-8000-00000000d101',
    'request',
    'Generator fuel siphon or transfer setup',
    'Our backup generator is low on fuel and our fuel container leaked. Can anyone lend a siphon setup or hand pump for about 2 hours?',
    now() - interval '1 days 12 hours'
  ),
  (
    'd9d9d9d9-b004-4000-8000-000000b00004',
    'd9d9d9d9-1101-4000-8000-00000000d101',
    'request',
    'Duct tape, rope, and zip ties',
    'Tent pole got bent and we need to jury-rig it. Looking for any duct tape, 50 ft of rope, and a handful of industrial zip ties.',
    now() - interval '18 hours'
  ),

  -- Degree 2 bulletins (visible through first-degree connections)
  (
    'd9d9d9d9-b005-4000-8000-000000b00005',
    'd9d9d9d9-2301-4000-8000-00000000d201',
    'request',
    'Extra solar batteries for phone charging',
    'Solar panels died mid-week and our power banks are all depleted. Anyone have a spare USB power bank or small solar charger?',
    now() - interval '2 days 6 hours'
  ),
  (
    'd9d9d9d9-b006-4000-8000-000000b00006',
    'd9d9d9d9-2701-4000-8000-00000000d201',
    'request',
    'Ice or cooler space for food storage',
    'Our cooler broke and we have perishables. Does anyone have spare ice or room in a cooler? We can trade food or cash.',
    now() - interval '1 days'
  ),
  (
    'd9d9d9d9-b007-4000-8000-000000b00007',
    'd9d9d9d9-3501-4000-8000-00000000d201',
    'request',
    'Bike repair help — chain broke',
    'Rear derailleur snapped on my bike and I can''t fix it myself. I have spare parts if someone has tools and knows how to adjust it.',
    now() - interval '12 hours'
  ),

  -- Degree 3 bulletins (visible through degree-2 connections only)
  (
    'd9d9d9d9-b008-4000-8000-000000b00008',
    'd9d9d9d9-3501-4000-8000-00000000d301',
    'request',
    'Looking for extra food — low on supplies',
    'Miscalculated our food and we''re running light. Any spare rice, beans, pasta, or canned goods? We''ll figure out a trade.',
    now() - interval '1 days 18 hours'
  ),
  (
    'd9d9d9d9-b009-4000-8000-000000b00009',
    'd9d9d9d9-4101-4000-8000-00000000d301',
    'request',
    'Shade cloth or tarp for emergency repair',
    'Windstorm damaged our shade setup and we need something to cover our kitchen area. Any extra shade cloth or heavy tarps?',
    now() - interval '1 days 3 hours'
  ),
  (
    'd9d9d9d9-b010-4000-8000-000000b00010',
    'd9d9d9d9-4601-4000-8000-00000000d301',
    'request',
    'First aid supplies — minor injuries',
    'Camp doctor is running low on bandages and pain medication. Need: adhesive bandages, gauze pads, and ibuprofen/acetaminophen.',
    now() - interval '6 hours'
  ),

  -- Disconnected network bulletins (NOT visible to owner)
  (
    'd9d9d9d9-b011-4000-8000-000000b00011',
    'd9d9d9d9-6301-4000-8000-00000000dd01',
    'request',
    'Looking to trade music gear',
    'Have an extra speaker and would love to find a good mixing board. Reach out if interested in trading or selling.',
    now() - interval '4 days'
  ),
  (
    'd9d9d9d9-b012-4000-8000-000000b00012',
    'd9d9d9d9-7001-4000-8000-00000000dd01',
    'request',
    'Art supplies needed for a project',
    'Running a small art installation and need: spray paint (various colors), black gaffers tape, and some fabric. Any donations appreciated.',
    now() - interval '2 days'
  )
on conflict (id) do nothing;

-- reset role;

commit;
