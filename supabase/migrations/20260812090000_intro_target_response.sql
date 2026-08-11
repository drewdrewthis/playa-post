-- The target's answer to an introduction that was passed on to them (issue #166).
--
-- #89 stopped at "the target sees it" and said so in the shipped `intro_requests_status`
-- CHECK. Accepting is what forms the connection, which makes an accepted introduction the
-- **second** way an `app.connections` row can come into existence — decision D12 in
-- `docs/product/decisions.md` records why that happens through the `IntroAccepted` outbox
-- event rather than through a minted invite token or a cross-module call.
--
-- ⚠ **ALTER, never DROP-and-recreate**, for the reason `20260811150000_add_intro_via_note.sql`
-- states in full: `app.intro_requests` already carries the ADR-0002 §4 posture applied by
-- `app.apply_rls_backstop`, its own `app_rw` grant, and its `revoke all … from anon,
-- authenticated, public` sweep. Table privileges cover columns added later and a policy
-- attaches to the relation rather than to its column list, so all of it survives an ALTER
-- — which is why this file adds no backstop call and no grant.
--
-- ⚠ **No new index, deliberately.** Every read this adds is already served:
-- `intro_requests_target_passed_idx` is partial on `status = 'passed_on'`, so an answered
-- row leaves it — which is exactly right, because a target's inbox holds only what is
-- still waiting on them — and the requester's own record is served by the non-partial
-- `intro_requests_requester_idx`. Nothing queries by answer, and an index nobody reads is
-- write amplification with a reassuring name.

set role app_migrator;

--------------------------------------------------------------------------------
-- 1. responded_at — the target's timestamp, beside and never instead of the via's
--------------------------------------------------------------------------------

-- Its own column rather than a second meaning for `decided_at`. The two belong to two
-- different people: `decided_at` says when the via made the introduction, and overwriting
-- it on an acceptance would erase the only record of when the introduction itself
-- happened. The interval between them is also the only measure of how long somebody sat
-- on an introduction, and `IntroAccepted.occurredAt` is read from this column — an
-- acceptance stamped with the via's time would claim the target answered before they were
-- shown anything.
alter table app.intro_requests add column responded_at timestamptz;

--------------------------------------------------------------------------------
-- 2. status — two more terminal values, reachable only from 'passed_on'
--------------------------------------------------------------------------------

-- ⚠ `target_declined`, and NOT a second meaning for `declined`. That one says the via
-- would not pass it on and the target was never told; this one says the target read it and
-- said no. Collapsing them would leave the requester's record unable to tell "nobody
-- showed them" from "they saw it and declined", and would silently widen every read that
-- filters on `declined` to include rows a target has seen.
--
-- The transition rule — that these two are reachable only from `passed_on`, and only by
-- the target — is a `where` clause on one gated UPDATE
-- (`postgres-intro-request.repository.ts`), not a constraint here. A CHECK sees one row
-- and not its previous state, so the only honest thing this table can say is which values
-- exist. Encoding a transition as a trigger would be a second authorization mechanism, in
-- the layer with the least visibility.
alter table app.intro_requests drop constraint intro_requests_status;

alter table app.intro_requests
  add constraint intro_requests_status
  check (status in ('requested', 'passed_on', 'declined', 'accepted', 'target_declined'));

--------------------------------------------------------------------------------
-- 3. responded_at agrees with status — an equality, unlike via_note's implication
--------------------------------------------------------------------------------

-- An equality is honest here where `intro_requests_via_note` had to be an implication:
-- there are no pre-existing answered rows to keep valid, because before this migration
-- there was no way to answer. So the two columns can be held to the same standard
-- `intro_requests_decided_at` holds its pair to — a row that says it was answered with no
-- time on it, or a time with no answer, is a state no reader could interpret.
--
-- `status` is NOT NULL, so the right-hand side is never NULL and the equality is total.
alter table app.intro_requests
  add constraint intro_requests_responded_at
  check ((responded_at is null) = (status not in ('accepted', 'target_declined')));

--------------------------------------------------------------------------------
-- 4. via_note — the vouch outlives the pass-on it was written on
--------------------------------------------------------------------------------

-- ⚠ **This CHECK becomes false the moment a target answers, and widening it is not
-- optional.** `via_note is null or status = 'passed_on'` was written when `passed_on` was
-- terminal; an accepted introduction carries the same vouch under a different status, and
-- the old form would have refused the very UPDATE that accepts it — a feature that fails
-- on a constraint nobody edited.
--
-- Still an implication rather than an equality, for the same reason it always was: rows
-- passed on before #175 carry no note, and migrations are forward-only. What it now says
-- is "only a request the via passed on may carry a via note" — which stays true through
-- everything that can happen to it afterwards, since the two new values are reachable only
-- from `passed_on`.
alter table app.intro_requests drop constraint intro_requests_via_note;

alter table app.intro_requests
  add constraint intro_requests_via_note
  check (via_note is null or status in ('passed_on', 'accepted', 'target_declined'));

--------------------------------------------------------------------------------
-- 5. Comments
--------------------------------------------------------------------------------

comment on column app.intro_requests.status is
  'requested -> passed_on | declined, and passed_on -> accepted | target_declined '
  '(issue #166). The via decides whether the introduction happens; the target decides '
  'what to do with the one they were given. Accepting emits IntroAccepted, which '
  'modules/connections consumes to write the connection (decision D12) — this table '
  'never names app.connections.';

comment on column app.intro_requests.responded_at is
  'When the target accepted or declined (issue #166). Null until they do, and never a '
  'copy of decided_at, which belongs to the via. NOT carried on the requester''s own '
  'read: a target who could be seen refusing cannot safely refuse, so intros.listOutbox '
  'reports the via''s decision only and a declined introduction is indistinguishable '
  'there from one nobody has answered yet.';

reset role;
