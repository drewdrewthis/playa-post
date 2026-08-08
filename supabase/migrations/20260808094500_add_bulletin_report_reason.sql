-- Give a report a reason (design/Playa Post.dc.html:337-356 — the "Report abuse" sheet).
--
-- `20260806140000_create_moderation_and_sync.sql` deliberately shipped
-- `app.bulletin_reports` with no reason: M2's report was "nothing but a private fact
-- that one viewer no longer wants to see one bulletin". The comp says otherwise — it
-- asks *what kind* (five chips) and *what happened* (a required free-text box), and it
-- addresses the result to the stewards. This migration makes the table able to carry
-- what the reporter actually said.
--
-- ⚠ **ALTER, never DROP-and-recreate.** `app.bulletin_reports` already carries the
-- ADR-0002 §4 posture applied by `app.apply_rls_backstop` (ENABLE + FORCE row level
-- security, the single `app_rw_full_access` policy) plus its own grant and its
-- `revoke all ... from anon, authenticated, public` sweep. Adding columns preserves all
-- of it: table-level privileges in PostgreSQL cover columns added later, and a policy
-- is attached to the relation rather than to its column list. Recreating the table
-- would silently reset every one of those, and B3 reads the catalog — so this file
-- adds no `apply_rls_backstop` call and no grant, because both are already true of this
-- relation and calling the backstop again would fail on the existing policy name.

set role app_migrator;

--------------------------------------------------------------------------------
-- 1. The columns, nullable — existing rows have no answer yet
--------------------------------------------------------------------------------

alter table app.bulletin_reports add column reason text;
alter table app.bulletin_reports add column detail text;

--------------------------------------------------------------------------------
-- 2. Backfill, stating the truth about rows filed before reasons existed
--------------------------------------------------------------------------------

-- Every pre-existing row was filed under a UI that never asked. `'unspecified'` records
-- exactly that and is **not** a member of the reporter-offerable vocabulary
-- (`moderation/domain/report-reason.ts`): the application can read it, no request can
-- write it, and a steward reading the M5 queue can tell "reported before we asked" from
-- any of the five things a reporter can now choose. An empty `detail` is the same
-- statement in the free-text column — no words were recorded, as against the non-empty
-- string every new report is required to carry.
update app.bulletin_reports set reason = 'unspecified' where reason is null;
update app.bulletin_reports set detail = '' where detail is null;

--------------------------------------------------------------------------------
-- 3. NOT NULL, and deliberately no DEFAULT
--------------------------------------------------------------------------------

-- Same reasoning `app.mutation_results.mutation_id` records: a default would silently
-- accept an insert that omitted the reason instead of failing it. The value is always
-- stated by the writer — by the reporter for every new row, and by the backfill above
-- for the old ones — so the constraint has something to enforce rather than something
-- to paper over.
alter table app.bulletin_reports alter column reason set not null;
alter table app.bulletin_reports alter column detail set not null;

--------------------------------------------------------------------------------
-- 4. Comments
--------------------------------------------------------------------------------

-- `text` with no check constraint, matching `app.bulletins.type`,
-- `app.connections.status`, and every other closed vocabulary in this schema: an
-- unrecognised value must fail CLOSED in the application (`report-reason.ts` +
-- the `moderation.report` input schema) rather than loudly in a constraint the reader
-- has to go find. The vocabulary is restated in the comment so a `\d+` reader sees it.
comment on column app.bulletin_reports.reason is
  'What kind of abuse the reporter chose: harassment | scam-or-fraud | impersonation | '
  'spam | safety-risk, or the legacy ''unspecified'' for rows filed before the sheet '
  'asked. Enforced in the application, not by a check constraint — see '
  'modules/moderation/domain/report-reason.ts.';

-- ⚠ The privacy property is unchanged and this column does not weaken it. `detail` is
-- written *by the reporter* and may name them, so it lives in the one table no
-- author-facing read joins (M2-AC10, B9) — exactly like `reporter_id` beside it. It is
-- for the stewards' queue (M5) and for nothing else; no read reachable by the reported
-- author may ever select it.
comment on column app.bulletin_reports.detail is
  'The reporter''s own account of what happened, trimmed and non-empty for every report '
  'filed through the sheet; '''' for rows filed before it asked. Steward-facing only — '
  'never selected by any read the reported author can reach (M2-AC10, B9).';

reset role;
