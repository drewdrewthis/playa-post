-- The via's own note, written when they pass an introduction on (issue #175).
--
-- A pass-on is not a forward. The via is vouching, so the target reads two notes: the
-- requester's reason for asking, and the via's reason for agreeing — each under its own
-- author's card. Decision D11 in `docs/product/decisions.md` records the owner directive
-- ("you have to add your own message") and the enforcement split this file's CHECK makes.
--
-- ⚠ **ALTER, never DROP-and-recreate**, for the reason
-- `20260808094500_add_bulletin_report_reason.sql` states in full: `app.intro_requests`
-- already carries the ADR-0002 §4 posture applied by `app.apply_rls_backstop`, its own
-- `app_rw` grant, and its `revoke all … from anon, authenticated, public` sweep. Table
-- privileges in PostgreSQL cover columns added later and a policy attaches to the
-- relation rather than to its column list, so all of it survives an ALTER — which is why
-- this file adds no backstop call and no grant, and why calling the backstop again would
-- fail on the existing policy name.

set role app_migrator;

--------------------------------------------------------------------------------
-- 1. The column, nullable — three legitimate reasons to hold no note
--------------------------------------------------------------------------------

-- No backfill and no NOT NULL, unlike `add_bulletin_report_reason`'s two columns. There
-- is no truthful value to write into a request that is still open, into one that was
-- declined, or into one passed on before the via was asked for anything: a placeholder
-- would be this migration inventing words and attributing them to a person.
alter table app.intro_requests add column via_note text;

--------------------------------------------------------------------------------
-- 2. The CHECK — an implication, deliberately not an equality
--------------------------------------------------------------------------------

-- ⚠ **`via_note is null or status = 'passed_on'`, and NOT the biconditional form
-- `intro_requests_decided_at` uses beside it.** "Only a passed-on request may carry a via
-- note" is true forever; "every passed-on request carries one" is not, because rows
-- passed on before this column existed have none and migrations are forward-only. A
-- plain biconditional would refuse to apply against those rows; the `not valid` variant
-- would apply by skipping them, but would leave the schema permanently asserting a
-- requirement the stored data does not meet, validated nowhere. This table states only
-- what holds for every row for all time.
--
-- The other half of the rule lives where it can state the present tense instead:
-- `modules/intros/domain/intro-note.policy.ts` requires a note on every *new* pass-on.
-- Two places, two different claims — the database says what is possible for all time, the
-- domain says what is required now.
alter table app.intro_requests
  add constraint intro_requests_via_note
  check (via_note is null or status = 'passed_on');

--------------------------------------------------------------------------------
-- 3. Comment
--------------------------------------------------------------------------------

comment on column app.intro_requests.via_note is
  'What the via said when they passed the introduction on (issue #175). Null while the '
  'request is open, null on a decline — a decline carries no note, so there is nothing '
  'the requester could read a rationale out of — and null on a pass-on made before this '
  'column existed. Held to exactly the treatment app.intro_requests.note is held to: '
  'deliberately NOT indexed and NOT part of any tsvector, and never written to a log '
  'line or an outbox payload (ADR-0006).';

reset role;
