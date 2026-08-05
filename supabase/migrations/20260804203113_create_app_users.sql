-- The first product table — ADR-0008 (identity model) on top of the ADR-0002
-- security baseline.
--
-- Three jobs, in this order and for this reason:
--
--   1. `app.users`, verbatim from ADR-0008:22-34. Four of its columns are
--      `not null` (`auth_user_id`, `handle`, `display_name`, `created_at`) and an
--      earlier draft of the lane brief silently dropped all four by paraphrasing
--      the DDL — so this block is a transcription, not a restatement.
--   2. The ADR-0002 §4 backstop plus the explicit per-table grants. Every product
--      table owes both; B3 reads the catalog and fails any table in `app` that
--      skipped either.
--   3. Retirement of `app.security_baseline_canary`. The canary existed only so
--      B1/B3/B4 could not quantify over an empty set before a product table
--      existed (see the baseline migration §5, which says to drop it here).
--
-- ⚠ There is no `email` column, and there must never be one anywhere in schema
-- `app` (ADR-0008 rule 3). Email lives in `auth.users` and is fetched through the
-- auth admin API at the moment a feature needs it. `auth_user_id` is the only
-- bridge, and deliberately **not** a cross-schema foreign key (rule 2): coupling
-- our referential integrity to a vendor-managed table makes both GDPR erasure and
-- a future auth migration harder.

--------------------------------------------------------------------------------
-- 0. citext
--------------------------------------------------------------------------------

-- Runs BEFORE `set role app_migrator`, and lands in the default schema rather
-- than a dedicated one, for two reasons that pull the same way:
--
--   * `app_migrator` holds no CREATE privilege on any schema outside `app`, so it
--     cannot install an extension at all — this has to be the migration runner.
--   * The `citext` `=` operator has to be resolvable from `app_rw`'s search_path
--     when it runs `where handle = $1`, and `public` is the one schema on every
--     role's default search_path on both a bare `postgres:17` (the Testcontainers
--     harness) and a Supabase project. An `extensions` schema would be the
--     Supabase convention and would silently break the harness.
--
-- `citext` is a trusted extension (PostgreSQL 13+), so the non-superuser
-- `postgres` role Supabase runs migrations as can install it.
create extension if not exists citext;

-- ⚠ The failure this guard exists for is silent, and it is a security control.
--
-- `IF NOT EXISTS` is a no-op when the extension is already installed — including
-- when it is installed somewhere `app_rw` cannot see, which some Supabase projects
-- do by convention (`schema extensions`). PostgreSQL does not error in that case:
-- with no visible `citext = citext` operator it falls back to the implicit
-- `citext -> text` cast and compares with `text = text`, which is
-- **case-sensitive**. `where handle = $1` would then quietly stop enforcing the one
-- handle rule the database owns (ADR-0008:53), and the case-collision scenario
-- would pass its integration test while failing in production.
--
-- Failing the migration is the only version of this worth having.
do $$
declare
  citext_schema text := (
    select n.nspname
      from pg_catalog.pg_extension e
      join pg_catalog.pg_namespace n on n.oid = e.extnamespace
     where e.extname = 'citext'
  );
begin
  if citext_schema is distinct from 'public' then
    raise exception
      'citext is installed in schema %, not public. app_rw''s search_path would not '
      'see its = operator and handle comparison would silently become case-sensitive '
      '(ADR-0008:53). Relocate it (ALTER EXTENSION citext SET SCHEMA public) or give '
      'app_rw USAGE on that schema and put it on the role search_path.',
      coalesce(citext_schema, '<not installed>');
  end if;
end
$$;

-- Everything below is created, owned, and granted by `app_migrator`, exactly as
-- the security baseline does it — so the catalog comes out identical whether the
-- runner is a superuser (Testcontainers) or Supabase's non-superuser `postgres`.
set role app_migrator;

--------------------------------------------------------------------------------
-- 1. app.users (ADR-0008:22-34)
--------------------------------------------------------------------------------

create table app.users (
  id             uuid primary key default gen_random_uuid(),  -- internal, immutable, never reused
  auth_user_id   uuid unique not null,      -- the ONLY reference to auth.users; no FK across schemas
  handle         citext unique not null,    -- stable public identifier
  display_name   text not null,
  avatar_path    text,                      -- private storage bucket key; never a public URL
  status         text not null default 'active',   -- active | deactivated | suspended | erased
  created_at     timestamptz not null,
  deactivated_at timestamptz,
  erased_at      timestamptz,
  version        int not null default 1
);

comment on table app.users is
  'One row per product user (ADR-0008). `id` is the internal identifier every '
  'product FK points at; `auth_user_id` is the only bridge to Supabase Auth and '
  'is deliberately not a cross-schema foreign key. No email column, ever.';

comment on column app.users.handle is
  'citext, so uniqueness is case-insensitive without a functional index. The '
  'remaining handle rules (charset, length, reserved words, confusables, '
  'immutability) live in modules/identity/domain/handle.policy.ts — this column '
  'enforces the one rule a database can enforce (ADR-0008:50-57).';

comment on column app.users.created_at is
  'No default, on purpose (ADR-0008:29): the writer states when onboarding '
  'completed rather than inheriting whatever the row happened to be inserted at.';

--------------------------------------------------------------------------------
-- 2. RLS backstop and grants (ADR-0002 §2, §4)
--------------------------------------------------------------------------------

-- The four statements ADR-0002 §4 specifies, composed rather than copied. B3
-- reads the catalog, so a table that skipped this fails whether or not the SQL
-- looks right.
select app.apply_rls_backstop('app.users');

-- Per-table and explicit (ADR-0002 §2 forbids a blanket ALL ON ALL TABLES). No
-- sequence grant accompanies it because `id` is a `uuid` default, not an identity
-- column — this table owns no sequence.
grant select, insert, update, delete on table app.users to app_rw;

--------------------------------------------------------------------------------
-- 3. Retire the security-baseline canary
--------------------------------------------------------------------------------

-- The baseline migration §5 says to drop both the moment a real product table
-- lands, and this is that migration. B1/B3/B4 now quantify over `app.users`.
--
-- ⚠ Dropping the sequence leaves schema `app` with no sequence at all until a
-- table with an identity column arrives (lane L2's tables), so B3's
-- "no privilege on any sequence" branch goes back to quantifying over an empty
-- set in the meantime. That is the lane brief's instruction and the canary's
-- stated lifecycle; the branch becomes load-bearing again with L2's migration.
drop table app.security_baseline_canary;
drop sequence app.security_baseline_canary_seq;

--------------------------------------------------------------------------------
-- 4. Sweep (ADR-0002 §3)
--------------------------------------------------------------------------------

-- The baseline's default-privilege revokes already cover objects `app_migrator`
-- creates from here on; this covers the table this migration just created, the
-- same way the baseline's own §6 covers its objects.
revoke all on table app.users from anon, authenticated, public;

reset role;
