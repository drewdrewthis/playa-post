-- Security baseline — ADR-0002 §1, §2, §3, §4.
--
-- This migration installs the privilege model every later migration inherits:
-- schema `app`, the two roles, the revoke set, and the RLS backstop shape. It
-- ships BEFORE any product table on purpose. Enabling RLS and fixing ownership
-- later means auditing every table at once, under time pressure, after the data
-- is already there.
--
-- What this file is NOT: it is not viewer-scoped authorization. ADR-0002 is
-- explicit that the database will never catch a missing `WHERE viewer_id`. The
-- policy created here is unconditional by design; the real control is the
-- application layer plus `tests/security/` (B1-B18). Read ADR-0002 before
-- changing anything here.
--
-- Re-runnability: `supabase db reset` drops and recreates the DATABASE, but roles
-- are CLUSTER-scoped and survive it. Every role statement below is therefore
-- guarded — an unguarded `create role` makes the second `db reset` fail.

--------------------------------------------------------------------------------
-- 1. Roles (ADR-0002 §2)
--------------------------------------------------------------------------------

-- No password is set anywhere in this file, and none ever may be: a password that
-- works is a secret in source control (addendum §17). Credentials are provisioned
-- out of band — `app_rw` into the API's secret store, `app_migrator` into the
-- deploy platform's, usable only by the migration job (ADR-0002 Q5).
do $$
begin
  -- Owns every object in `app`. NOBYPASSRLS is load-bearing rather than tidy: a
  -- leaked migrator credential is contained by FORCE ROW LEVEL SECURITY only for
  -- as long as this role cannot bypass RLS outright (ADR-0002 Q5).
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'app_migrator') then
    create role app_migrator login nosuperuser nocreatedb nocreaterole nobypassrls noinherit;
  end if;

  -- The only role the API connects as. Owns nothing, inherits nothing, is a member
  -- of nothing — so there is no SET ROLE path out of it.
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'app_rw') then
    create role app_rw login nosuperuser nocreatedb nocreaterole nobypassrls noinherit;
  end if;
end
$$;

comment on role app_migrator is
  'Owns every object in schema app. Migration job only, never the running API (ADR-0002 §2).';
comment on role app_rw is
  'The only role the API connects as. Least-privileged, owns nothing (ADR-0002 §2).';

-- `anon` and `authenticated` are Supabase's PostgREST roles. They exist on every
-- Supabase database and this block is a no-op there. It is not a no-op on a bare
-- `postgres:17` — the Testcontainers harness (packages/testing), and any plain
-- Postgres — where without them every REVOKE below would abort on a missing role
-- and the whole revoke set would go untested. Creating them here means the
-- security suite exercises the same statements that run in production.
do $$
declare
  postgrest_role text;
begin
  foreach postgrest_role in array array['anon', 'authenticated'] loop
    if not exists (select 1 from pg_catalog.pg_roles where rolname = postgrest_role) then
      execute format('create role %I nologin noinherit', postgrest_role);
    end if;
  end loop;
end
$$;

-- Everything from section 2 onwards runs as `app_migrator`, so the runner needs the
-- right to SET ROLE to it.
--
-- ⚠ Membership is NOT that right, and the difference is invisible until it fails.
-- PostgreSQL 16 split a role grant into three independent options — ADMIN, INHERIT,
-- SET — and `createrole_self_grant` defaults to granting none of the last two. A
-- CREATEROLE runner that creates `app_migrator` therefore gets ADMIN OPTION and a
-- `pg_auth_members` row, which makes `pg_has_role(…, 'MEMBER')` report **true**,
-- while `SET ROLE app_migrator` is still refused. Guarding on `pg_has_role` skips
-- the grant it needed to make and the migration dies four statements later on
-- `alter schema app owner to app_migrator` with "must be able to SET ROLE".
-- Observed on Supabase CLI 2.110.0, where `postgres` is CREATEROLE and NOT a
-- superuser: .github/evidence/db-scripts.txt.
--
-- So: read `set_option` directly, and grant exactly the missing option. SET only —
-- adding `ADMIN OPTION` here raises `0LP01 ADMIN option cannot be granted back to
-- your own grantor`, because the runner already holds admin from having created the
-- role and would be re-granting it through itself. The runner does not need admin
-- again; it needs the right to SET ROLE, which this adds as a second
-- `pg_auth_members` row.
--
-- A superuser needs no membership row at all and is left alone. If the runner is
-- neither a superuser nor an admin of `app_migrator`, the GRANT fails loudly here
-- rather than silently creating objects under the wrong owner — the drift B3 exists
-- to catch.
do $$
begin
  if (select r.rolsuper from pg_catalog.pg_roles r where r.rolname = current_user) then
    return;
  end if;

  if not exists (
    select 1
      from pg_catalog.pg_auth_members m
     where m.roleid = 'app_migrator'::regrole
       and m.member = current_user::regrole
       and m.set_option
  ) then
    execute format('grant app_migrator to %I with set option', current_user);
  end if;
end
$$;

--------------------------------------------------------------------------------
-- 2. Schema (ADR-0002 §1)
--------------------------------------------------------------------------------

-- `app` is deliberately absent from `schemas` in supabase/config.toml, so
-- PostgREST cannot reach anything in here at all. That is the single strongest
-- control in the model and it costs nothing.
create schema if not exists app;

-- Stated separately from `create schema` rather than as AUTHORIZATION: with
-- IF NOT EXISTS, a pre-existing schema silently keeps its old owner. This line
-- corrects that drift instead of inheriting it.
alter schema app owner to app_migrator;

comment on schema app is
  'All product data. Not exposed to PostgREST. Owned by app_migrator (ADR-0002 §1).';

-- From here down every object is created, owned, and granted by app_migrator, so
-- the migration produces the same catalog whether the runner is a superuser (the
-- Testcontainers harness) or Supabase's non-superuser `postgres`. Running the
-- revokes as whoever happened to invoke the migration is how ownership drift gets
-- in: a REVOKE only removes grants made by the revoking role.
set role app_migrator;

--------------------------------------------------------------------------------
-- 3. Revocation (ADR-0002 §3)
--------------------------------------------------------------------------------

revoke all on schema app from anon, authenticated, public;

-- ⚠ These are deliberately GLOBAL (no `IN SCHEMA app`), and that is not a
-- shortcut — the schema-scoped form cannot do this job at all.
--
-- `get_user_default_acl()` treats a per-schema `pg_default_acl` row as ADDITIVE:
-- it starts from the hard-wired default and merges the row in, so a schema-scoped
-- entry can only ever grant MORE. A global row (`defaclnamespace = 0`) REPLACES
-- the hard-wired default outright, which is the only way to express "PUBLIC gets
-- nothing". Measured on postgres:17: with the `IN SCHEMA app` form, PostgreSQL
-- stores no catalog row and a function created afterwards still comes out
-- `PUBLIC`-executable — the statement parses, reports `ALTER DEFAULT PRIVILEGES`,
-- and does nothing. Evidence: .github/evidence/alter-default-privileges-scope.txt.
--
-- Scoping stays tight via `FOR ROLE app_migrator`: it applies only to objects that
-- role creates, and app_migrator creates objects only in `app`. If anything else
-- ever creates an object in `app` the defaults do not apply to it — the same hole
-- as ownership drift, caught the same way, by B3.
--
-- The FUNCTIONS line is the one doing real work. PostgreSQL grants EXECUTE on
-- every new function to PUBLIC by default, so without it each future
-- `app.visible_*` function is world-executable from the moment it is created.
-- TYPES behaves the same way with USAGE. TABLES and SEQUENCES have no PUBLIC
-- default to remove and therefore leave no catalog row — they are written anyway
-- so the set reads as ADR-0002 §3 does, and so a future default-GRANTING statement
-- has an obvious place to be noticed.
--
-- One object type per statement: PostgreSQL's grammar takes a single object type,
-- so the ADR's comma-joined `ON TABLES, SEQUENCES, FUNCTIONS, ROUTINES, TYPES` is
-- five statements, not one.
alter default privileges for role app_migrator
  revoke all on tables from anon, authenticated, public;
alter default privileges for role app_migrator
  revoke all on sequences from anon, authenticated, public;
alter default privileges for role app_migrator
  revoke all on functions from anon, authenticated, public;
-- ROUTINES is PostgreSQL's alias for FUNCTIONS here (same `pg_default_acl` row, so
-- this statement changes nothing). Written because ADR-0002 §3 names both and this
-- file is read as that section's implementation.
alter default privileges for role app_migrator
  revoke all on routines from anon, authenticated, public;
alter default privileges for role app_migrator
  revoke all on types from anon, authenticated, public;

-- The only schema-level privilege app_rw gets. Table privileges are granted one
-- table at a time (§2: no blanket ALL ON ALL TABLES), and a table with a
-- `bigserial`/identity column additionally needs
-- `grant usage, select on sequence app.<seq> to app_rw` or its inserts fail at
-- deploy time — the omission whose field fix under pressure is `GRANT ALL`.
grant usage on schema app to app_rw;

--------------------------------------------------------------------------------
-- 4. RLS backstop, written once (ADR-0002 §4)
--------------------------------------------------------------------------------

-- ADR-0002 §4 specifies four statements, verbatim, per table. This function is
-- where that text lives, so a product-table migration composes the shape instead
-- of copying it: `select app.apply_rls_backstop('app.<t>');`
--
-- The ADR asserts the SHAPE, and B3 reads the catalog rather than this file — so
-- a table that never calls this function still fails, and a table that calls it
-- cannot drift. Copy-pasting the four statements per table would instead leave
-- every clause available to be dropped by a reviewer who did not know which ones
-- were load-bearing (all of them: without FORCE the owner bypasses RLS silently;
-- without TO the policy defaults to TO PUBLIC and permits every role in the
-- cluster; FOR SELECT instead of FOR ALL breaks every write).
--
-- SECURITY INVOKER, and SET search_path = '' per ADR-0002 §5 — the empty
-- search_path is also what makes `target_table::text` render schema-qualified.
create or replace function app.apply_rls_backstop(target_table regclass)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  qualified_name text := target_table::text;
  schema_name text;
begin
  select n.nspname
    into schema_name
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
   where c.oid = target_table;

  if schema_name is distinct from 'app' then
    raise exception
      'apply_rls_backstop: % is not in schema app; product tables live in app (ADR-0002 §1)',
      qualified_name;
  end if;

  execute format('alter table %s enable row level security', qualified_name);
  execute format('alter table %s force row level security', qualified_name);
  execute format(
    'create policy app_rw_full_access on %s '
    'as permissive for all to app_rw using (true) with check (true)',
    qualified_name
  );
  execute format(
    'comment on policy app_rw_full_access on %s is %L',
    qualified_name,
    'Intentionally unconditional. Viewer-scoped authorization lives in the '
    'application layer (ADR-0002).'
  );
end;
$$;

comment on function app.apply_rls_backstop(regclass) is
  'Applies the ADR-0002 §4 policy shape to one table: ENABLE + FORCE row level '
  'security and the single app_rw_full_access policy. Every product-table '
  'migration must call this; B3 fails any table in app that did not.';

--------------------------------------------------------------------------------
-- 5. Canary table (implementation plan M1.5)
--------------------------------------------------------------------------------

-- Not product data, and not a fixture: B1, B3 and B4 all quantify over "every
-- table in schema app", and a `for all` over an empty set passes. Until M2's
-- first product table lands, this table is the only thing standing between the
-- security suite and eighteen green rows asserting nothing. It is also the proof
-- that `apply_rls_backstop` works, in the same migration that defines it.
--
-- Remove it in the migration that adds M2's first product table — at that point
-- the suite has real tables to quantify over and this one is noise.
create table app.security_baseline_canary (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  created_at timestamptz not null default pg_catalog.now()
);

comment on table app.security_baseline_canary is
  'Holds no data. Exists so B1/B3/B4 cannot pass vacuously before M2 has product '
  'tables. Drop it in the migration that adds the first product table.';

select app.apply_rls_backstop('app.security_baseline_canary');

-- Per-table and explicit, per ADR-0002 §2. app_rw needs real DML here so the
-- suite can prove the backstop PERMITS the application role rather than only that
-- it is switched on: RLS enabled with a policy that does not match returns zero
-- rows silently, and a silent zero is the failure mode this baseline is most
-- likely to ship with.
grant select, insert, update, delete on table app.security_baseline_canary to app_rw;

--------------------------------------------------------------------------------
-- 6. Sweep (ADR-0002 §3)
--------------------------------------------------------------------------------

-- The default-privilege revokes above cover objects created from here on. These
-- cover the objects this migration just created, and anything that predates it.
revoke all on all tables in schema app from anon, authenticated, public;
revoke all on all sequences in schema app from anon, authenticated, public;
revoke all on all functions in schema app from anon, authenticated, public;
revoke all on all routines in schema app from anon, authenticated, public;

reset role;
