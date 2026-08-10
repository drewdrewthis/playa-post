-- Index the get-or-create invite lookup (PR #144): `findLatestPendingByInviter` runs on
-- every You-screen arrival and reads the newest pending invite for one inviter.
-- `app.invitations` (20260805234326_create_connections_and_outbox.sql) carries only its
-- primary key and the token unique index — neither covers this read.
--
-- ALTER-only, matching 20260808094500_add_bulletin_report_reason.sql: `app.invitations`
-- already carries the ADR-0002 §4 posture through `app.apply_rls_backstop` plus its own
-- grant and sweep. An index adds no new relation-level privilege surface, so this file
-- calls no backstop and no grant.

set role app_migrator;

--------------------------------------------------------------------------------
-- 1. invitations_inviter_pending_idx
--------------------------------------------------------------------------------

-- The get-or-create invite path (PR #144) reads the newest pending invite per inviter on
-- every You-screen arrival; without this, each arrival seq-scans app.invitations and the
-- cost grows with every invite ever minted.
create index invitations_inviter_pending_idx
  on app.invitations (inviter_id, created_at desc, id desc)
  where status = 'pending';

reset role;
