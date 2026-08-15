-- Widen `app.notification_optouts.kind` to admit 'connections' (issue #218).
--
-- The CHECK is the schema's copy of the `GroupedNotification` kind union (ADR-0020 D3:
-- three copies in lockstep — `NOTIFICATION_KINDS` in the server domain, this CHECK, and
-- `NOTIFICATION_KINDS` in packages/contracts). This migration is the schema's half of
-- the PR that adds the `connections` kind and its `ConnectionRequested` consumer.

set role app_migrator;

alter table app.notification_optouts
  drop constraint notification_optouts_kind_check;

alter table app.notification_optouts
  add constraint notification_optouts_kind_check
  check (kind in ('bulletins', 'note', 'connections'));

comment on column app.notification_optouts.kind is
  'A GroupedNotification kind: bulletins, note, or connections. The CHECK is the schema''s copy of the contract union; widen both together.';

reset role;
