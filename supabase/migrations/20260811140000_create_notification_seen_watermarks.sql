-- `app.notification_seen_watermarks` — per-recipient "I had my notifications panel open
-- at this moment" (issue #178).
--
-- ⚠ **The mark-as-read affordance `create_notification_dismissals` said would need "a new
-- mutation and a new column, together".** It arrives as a new mutation and a new *table*,
-- for the reason that migration gave for keeping dismissals off `app.consumer_receipts`:
-- the two facts have different cardinality. A dismissal is one row per (recipient,
-- notification) and a watermark is one row per recipient, so a `seen_at` column beside
-- `dismissed_at` could only ever be written for notifications that had also been
-- dismissed — which is precisely the state this feature exists to distinguish.
--
-- ⚠ **A watermark, not a per-notification flag, and that is the whole design.** Marking
-- rows would mean the client sending the identifiers it happens to be holding, so a
-- notification that arrived between its read and its write would be silently marked seen
-- by a panel that never showed it. One timestamp per person says "everything up to here",
-- names nothing, and cannot race a read. It is also O(1) to write however long somebody's
-- history is: opening the panel is the most-repeated gesture in this product.
--
-- ⚠ **Seen is not dismissed.** `notifications.list` serves both, and `app.notifications`
-- is deliberately still two tables: opening the panel drops the bell's badge, the `✕`
-- moves a row out of the panel's active section, and nothing may collapse them. See
-- `apps/server/src/modules/notifications/domain/notification-seen-watermark.repository.ts`.

-- Everything is created, owned, and granted by `app_migrator`, so the catalog comes
-- out identical whether the runner is a superuser (Testcontainers) or Supabase's
-- non-superuser `postgres`.
set role app_migrator;

--------------------------------------------------------------------------------
-- 1. app.notification_seen_watermarks  (notifications badge, issue #178)
--------------------------------------------------------------------------------

create table app.notification_seen_watermarks (
  -- The primary key IS the "one per person" rule: `on conflict (recipient_id) do update`
  -- is what makes a second open replace the moment rather than append one, so no reader
  -- ever has to decide which of two rows is the watermark.
  recipient_id uuid primary key references app.users (id),
  -- When they last had the panel open. `notifications.list` serves `seen` as
  -- `occurred_at <= last_seen_at`, inclusive: a notification stamped at that exact
  -- instant was on the list the reader was shown.
  --
  -- ⚠ **Monotonic by contract, enforced in the upsert's `where` clause** rather than by a
  -- CHECK (a CHECK cannot see the row's previous value). Two devices open the panel and
  -- the later moment must win — a clock that went backwards, or an out-of-order retry,
  -- must never un-see notifications a person has already been shown.
  last_seen_at timestamptz not null
);

comment on table app.notification_seen_watermarks is
  'One row per recipient: the moment they last opened their notifications panel (issue '
  '#178). Viewer-local and nothing else — it changes what notifications.list marks seen '
  'for that one person, which is what the bell badge counts, and has no effect on any '
  'other recipient, on delivery, or on the outbox. Deliberately NOT a column on '
  'app.notification_dismissals: seen and dismissed are different acts with different '
  'cardinality, and collapsing them would make the badge unclearable without also '
  'clearing the panel.';

comment on column app.notification_seen_watermarks.last_seen_at is
  'Advances on every notifications.markSeen and never retreats — the upsert refuses a '
  'timestamp older than the stored one. Compared inclusively against a notification''s '
  'occurred_at.';

-- The read is "this one recipient's watermark", and the primary key already serves it.
-- No second index.

select app.apply_rls_backstop('app.notification_seen_watermarks');
grant select, insert, update, delete on table app.notification_seen_watermarks to app_rw;

--------------------------------------------------------------------------------
-- 2. Sweep (ADR-0002 §3)
--------------------------------------------------------------------------------

-- The baseline's default-privilege revokes already cover objects `app_migrator`
-- creates from here on; this covers the table this migration just created, the same way
-- create_notification_dismissals covers its one.
revoke all on table app.notification_seen_watermarks from anon, authenticated, public;

reset role;
