-- `app.notification_optouts` — per-person "do not notify me about this kind"
-- (issue #209, ADR-0020).
--
-- ⚠ **A row means OFF; the default is the absence of a row.** Every notification kind
-- is on for everybody until they flip it, and storing only the opt-outs is what makes
-- that true for users who existed before this migration and users who sign up after it
-- alike — no preference row to backfill, ever. `notifications.settings.get` derives
-- `enabled` from absence.
--
-- ⚠ **Consulted on the write side, not the read side.** `EvaluateNotifyMeHandler`
-- excludes opted-out people from the candidate set before any match is recorded, and
-- `DeliverNotePinnedHandler` skips the receipt that IS a note notification. An opt-out
-- therefore stops notifications from being *created*, which is what "off" means — it
-- does not hide rows already delivered.

-- Everything is created, owned, and granted by `app_migrator`, so the catalog comes
-- out identical whether the runner is a superuser (Testcontainers) or Supabase's
-- non-superuser `postgres`.
set role app_migrator;

--------------------------------------------------------------------------------
-- 1. app.notification_optouts  (per-kind notification off-switch, issue #209)
--------------------------------------------------------------------------------

create table app.notification_optouts (
  -- Who switched the kind off. Cascades with the account: an opt-out is meaningless
  -- without its owner, and account deletion must leave nothing behind.
  owner_id uuid not null references app.users (id) on delete cascade,
  -- Which kind is off. The CHECK restates the two members of the GroupedNotification
  -- union in packages/contracts — a third kind arrives as a migration widening this
  -- list in the same PR that adds it, never as free text.
  kind text not null check (kind in ('bulletins', 'note')),
  created_at timestamptz not null default now(),
  -- The primary key IS the idempotency rule: switching a kind off twice is one row,
  -- and switching it back on is a delete by this exact key.
  primary key (owner_id, kind)
);

comment on table app.notification_optouts is
  'One row per (person, notification kind) they have switched OFF (issue #209, '
  'ADR-0020). The default is on, represented by absence — no row is ever written for '
  '"enabled". Read by EvaluateNotifyMeHandler (excludes the person from the '
  'BulletinCreated candidate set) and DeliverNotePinnedHandler (skips the receipt), so '
  'an opt-out prevents creation of the notification rather than hiding it.';

comment on column app.notification_optouts.kind is
  'A GroupedNotification kind: bulletins or note. The CHECK is the schema''s copy of '
  'the contract union; widen both together.';

-- The reads are "this one owner's opt-outs" and "is (owner, kind) opted out", and the
-- primary key serves both. No second index.

select app.apply_rls_backstop('app.notification_optouts');
grant select, insert, update, delete on table app.notification_optouts to app_rw;

--------------------------------------------------------------------------------
-- 2. Sweep (ADR-0002 §3)
--------------------------------------------------------------------------------

revoke all on table app.notification_optouts from anon, authenticated, public;

reset role;
