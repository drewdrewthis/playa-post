-- `app.notification_dismissals` — per-recipient "I have dealt with this notification".
--
-- ⚠ **A sibling table, deliberately not a column on `app.consumer_receipts`.** A receipt
-- is ADR-0006's idempotency ledger — "the primary key IS the dedup mechanism" — owned by
-- the outbox machinery and written by whichever consumer processed an event. Hanging a
-- user-facing flag on it would put product state inside infrastructure whose lifecycle,
-- owner and cardinality are all different: a second consumer of the same event gets a
-- second receipt row and nothing says which one carries the dismissal. It is also the
-- rule `modules/notifications`' own repository already states — that module "does not
-- migrate columns onto a table it does not own".
--
-- ⚠ **One timestamp, not two.** There is no `read_at` beside `dismissed_at`, because
-- nothing writes one: `unread` is served as the negation of a dismissal, and a column no
-- mutation sets is a column every later reader has to guess the meaning of. A genuine
-- mark-as-read affordance is a new mutation and a new column, together.

-- Everything is created, owned, and granted by `app_migrator`, so the catalog comes
-- out identical whether the runner is a superuser (Testcontainers) or Supabase's
-- non-superuser `postgres`.
set role app_migrator;

--------------------------------------------------------------------------------
-- 1. app.notification_dismissals  (notifications panel, issue #50)
--------------------------------------------------------------------------------

-- `notification_id` is the `app.outbox_events.event_id` of the match that OPENED a
-- grouping window — the same value `notifications.list` serves as `notificationId`.
-- That identifier is stable for an already-flushed window: windows tumble from their
-- first match in ascending `occurred_at` order, so a later match starts a new window and
-- can never move an earlier window's opening match (see domain/notification-window.ts).
--
-- ⚠ **No foreign key to app.outbox_events**, for the reason app.consumer_receipts gives:
-- published rows are pruned after fourteen days (ADR-0006's daily cron), and a FK would
-- either block that prune or cascade the dismissals away — resurrecting notifications
-- somebody had already cleared. A dismissal whose window has aged out is a harmless
-- orphan; it matches nothing and costs a row.
create table app.notification_dismissals (
  recipient_id    uuid not null references app.users (id),
  notification_id uuid not null,
  dismissed_at    timestamptz not null,
  -- The primary key IS the idempotency: dismissing twice is `on conflict do nothing`
  -- and answers the first `dismissed_at`, so a replayed request cannot make a second
  -- act look like it happened.
  constraint notification_dismissals_pkey primary key (recipient_id, notification_id)
);

comment on table app.notification_dismissals is
  'One row per (recipient, notification) the recipient has dismissed. Viewer-local and '
  'nothing else: it changes what notifications.list marks unread for that one person, '
  'and has no effect on any other recipient, on delivery, or on the outbox. '
  'notification_id is an app.outbox_events.event_id and is deliberately not a foreign '
  'key — outbox rows are pruned after fourteen days and these must survive the prune.';

-- The read is "which of this recipient's notifications are dismissed", and the primary
-- key's leading column already serves it. No second index.

select app.apply_rls_backstop('app.notification_dismissals');
grant select, insert, update, delete on table app.notification_dismissals to app_rw;

--------------------------------------------------------------------------------
-- 2. Sweep (ADR-0002 §3)
--------------------------------------------------------------------------------

-- The baseline's default-privilege revokes already cover objects `app_migrator`
-- creates from here on; this covers the table this migration just created, the same way
-- create_moderation_and_sync covers its three.
revoke all on table app.notification_dismissals from anon, authenticated, public;

reset role;
