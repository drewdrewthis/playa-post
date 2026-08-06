-- Lane L4's tables — `app.bulletin_reports`, `app.bulletin_dismissals` (moderation,
-- M2.12) and `app.mutation_results` (the offline-sync envelope's idempotency store,
-- M2.13, ADR-0005:39-47).
--
-- Three tables in one migration is the lane-brief C1a carve-out: a lane opens with one
-- migration carrying all of its tables, then ships behaviour per work item. Every
-- table below gets the ADR-0002 §4 backstop through `app.apply_rls_backstop` and an
-- explicit per-table grant. Neither is optional and neither is hand-written: B3 reads
-- the catalog, so a table that skipped either fails the security suite whether or not
-- the SQL looks right.
--
-- No table here introduces app schema's first non-canary sequence: every primary key
-- is a `uuid`, either server-generated (`gen_random_uuid()`) or, for
-- `mutation_results.mutation_id`, client-generated per ADR-0005 — so
-- `tests/security/baseline-catalog.security.test.ts`'s `expectedVacuousKinds`
-- obligation is untouched by this migration.

-- Everything is created, owned, and granted by `app_migrator`, so the catalog comes
-- out identical whether the runner is a superuser (Testcontainers) or Supabase's
-- non-superuser `postgres`.
set role app_migrator;

--------------------------------------------------------------------------------
-- 1. app.bulletin_reports  (plan M2.12, moderation-report-dismiss.feature)
--------------------------------------------------------------------------------

-- One row per reporter/bulletin pair. M2 scope only: no reason taxonomy, no strike
-- count, no operator console (M5) — a report is nothing but a private fact that one
-- viewer no longer wants to see one bulletin, plus the visibility exclusion that fact
-- drives. The reporter's identity lives only in `reporter_id`; nothing here, and
-- nothing this migration grants read access to besides `app_rw`, ever puts that
-- identity in front of the bulletin's author (M2-AC10, B9).
create table app.bulletin_reports (
  id          uuid primary key default pg_catalog.gen_random_uuid(),
  bulletin_id uuid not null references app.bulletins (id),
  reporter_id uuid not null references app.users (id),
  created_at  timestamptz not null,
  -- ADR-0005's v1 conflict matrix: "a second distinct report of the same bulletin by
  -- the same reporter -> applied no-op (one open report per reporter/bulletin)".
  -- Idempotency on *content*, not just on the sync envelope's mutationId: the
  -- constraint is what makes a second, differently-mutationId'd report of the same
  -- pair a no-op rather than a second row, via `insert ... on conflict do nothing`.
  unique (bulletin_id, reporter_id)
);

comment on table app.bulletin_reports is
  'One row per reporter/bulletin pair. Hides the bulletin from reporter_id only '
  '(M2-AC10/AC11) and is never joined against by any read the bulletin''s author can '
  'reach — that is the whole privacy property (B9).';

-- The moderation module''s own exclusion read is "which bulletins has this viewer
-- reported", keyed on reporter_id.
create index bulletin_reports_reporter_id_idx on app.bulletin_reports (reporter_id);
create index bulletin_reports_bulletin_id_idx on app.bulletin_reports (bulletin_id);

select app.apply_rls_backstop('app.bulletin_reports');
grant select, insert, update, delete on table app.bulletin_reports to app_rw;

--------------------------------------------------------------------------------
-- 2. app.bulletin_dismissals  (plan M2.12, moderation-report-dismiss.feature)
--------------------------------------------------------------------------------

-- Viewer-local and nothing else (M2-AC11): dismissing removes a bulletin from the
-- dismissing viewer's board and has no effect on any other viewer, the bulletin, or
-- its author. Idempotent and converging, same as bulletin_reports.
create table app.bulletin_dismissals (
  id          uuid primary key default pg_catalog.gen_random_uuid(),
  bulletin_id uuid not null references app.bulletins (id),
  viewer_id   uuid not null references app.users (id),
  created_at  timestamptz not null,
  unique (bulletin_id, viewer_id)
);

comment on table app.bulletin_dismissals is
  'One row per viewer/bulletin pair. Hides the bulletin from viewer_id only '
  '(M2-AC11) — no strike count, no author-visible effect, no aggregation (M5).';

create index bulletin_dismissals_viewer_id_idx on app.bulletin_dismissals (viewer_id);
create index bulletin_dismissals_bulletin_id_idx on app.bulletin_dismissals (bulletin_id);

select app.apply_rls_backstop('app.bulletin_dismissals');
grant select, insert, update, delete on table app.bulletin_dismissals to app_rw;

--------------------------------------------------------------------------------
-- 3. app.mutation_results  (plan M2.13, offline-replay.feature, ADR-0005:39-47)
--------------------------------------------------------------------------------

-- The whole idempotency mechanism for `sync.submitMutations` — there is no second
-- bookkeeping path. `mutation_id` is the primary key rather than a separate surrogate
-- because the client-generated envelope ID *is* the identity of "have I seen this
-- mutation before"; a synthetic `id` beside it would be a second identity for the same
-- fact.
--
-- ⚠ `mutation_id` carries no `default`: it is a UUID v7 minted by the client
-- (ADR-0005's "client-generated (UUID v7 for k-sortability)"), and a server default
-- would silently accept a request that omitted it instead of failing the insert.
create table app.mutation_results (
  mutation_id   uuid primary key,
  actor_id      uuid not null references app.users (id),
  mutation_type text not null,
  -- sha256 of the canonical payload. Compared, not decoded — a lookup is never a
  -- second parse of the payload it protects.
  request_hash  text not null,
  -- One of ADR-0005's five outcomes: applied | replayed | conflict | rejected |
  -- expired. Deliberately `text`, matching app.bulletins.type and every other
  -- closed-vocabulary column in this schema: an unrecognised value must fail CLOSED in
  -- the application rather than loudly in a constraint the reader has to go find.
  outcome       text not null,
  result        jsonb,
  created_at    timestamptz not null default now()
);

comment on table app.mutation_results is
  'The offline-sync idempotency store (ADR-0005:39-47). One row per mutation ever '
  'applied, written in the same transaction as its effect and its outbox event. '
  'Replay with the same mutation_id and a matching request_hash returns this row''s '
  'result as outcome=replayed; a different request_hash is rejected with '
  'IDEMPOTENCY_KEY_REUSE, never silently re-applied.';

comment on column app.mutation_results.actor_id is
  'Namespaces every mutation_id lookup (ADR-0005): one actor can neither probe nor '
  'collide with another actor''s mutation IDs, even though the primary key alone is '
  'global.';

comment on column app.mutation_results.created_at is
  'Has a default, unlike app.bulletins.created_at and app.invitations.created_at: '
  'ADR-0005''s schema block specifies `default now()` for this column explicitly, and '
  'it is a bookkeeping timestamp for the 30-day retention window (ADR-0005), not a '
  'product fact a writer states.';

-- Every lookup is namespaced by actor_id (ADR-0005): "mutation_id is client-generated
-- but namespaced by actor_id in every lookup". The primary key alone answers "does
-- this mutation_id exist"; this index is what makes "does this mutation_id exist *for
-- this actor*" cheap, which is the query the service actually runs.
create index mutation_results_actor_id_mutation_id_idx
  on app.mutation_results (actor_id, mutation_id);

select app.apply_rls_backstop('app.mutation_results');
grant select, insert, update, delete on table app.mutation_results to app_rw;

--------------------------------------------------------------------------------
-- 4. Sweep (ADR-0002 §3)
--------------------------------------------------------------------------------

-- The baseline's default-privilege revokes already cover objects `app_migrator`
-- creates from here on; this covers the three tables this migration just created, the
-- same way create_bulletins covers its one and create_connections_and_outbox covers
-- its five.
revoke all on table app.bulletin_reports from anon, authenticated, public;
revoke all on table app.bulletin_dismissals from anon, authenticated, public;
revoke all on table app.mutation_results from anon, authenticated, public;

reset role;
