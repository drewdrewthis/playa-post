-- The personal connection link and the requests it produces (issue #206).
--
-- ⚠ **A link is an address, not a key.** `app.invitations` stores a bearer credential —
-- whoever holds the token becomes a connection, once. These two tables store the opposite
-- model: a permanent slug that resolves to "here is who this is" and a request the owner
-- must answer. Nothing in this migration touches `app.invitations`, and nothing here
-- makes an old token behave differently; the two models coexist, which is what lets links
-- already in somebody's chat history keep working (ADR-0018).
--
-- The ADR-0002 §4 backstop and the explicit per-table grant are not optional and not
-- hand-written: B3 reads the catalog, so a table that skipped either fails the security
-- suite whether or not the SQL looks right.

-- Everything is created, owned, and granted by `app_migrator`, so the catalog comes
-- out identical whether the runner is a superuser (Testcontainers) or Supabase's
-- non-superuser `postgres`.
set role app_migrator;

--------------------------------------------------------------------------------
-- 1. app.personal_links  (issue #206, ADR-0018 D1/D3)
--------------------------------------------------------------------------------

-- ⚠ **One row per owner, and rotation overwrites the slug in place.** `owner_id` is the
-- primary key rather than a surrogate id with a uniqueness constraint beside it, because
-- "you have one personal link" is the product statement and a table that can hold two
-- rows for one person needs a rule somewhere deciding which is current.
--
-- ⚠ **The retired slug is not kept, and that is the anti-oracle property** (ADR-0002 §10,
-- ADR-0018 D3). Rotation writes the new value over the old one, so after a rotation there
-- is no row anywhere carrying the old slug — a lookup for it returns nothing by
-- construction, and therefore answers exactly what a slug that never existed answers. A
-- versioned table with `revoked_at` would make that same property depend on every future
-- reader remembering the filter, which is the shape ADR-0002 §10 keeps failing on.
--
-- `rotated_at` records that a rotation happened and when. It deliberately does **not**
-- record what the old slug was: a retired address kept in a column is a retired address
-- still sitting in the database, and the owner rotated precisely to be rid of it.
create table app.personal_links (
  owner_id   uuid primary key references app.users (id),
  -- Unique because the slug IS the lookup key. 16 CSPRNG bytes make a collision
  -- arithmetically impossible; the constraint makes it structurally impossible.
  --
  -- Shorter than `app.invitations.token`'s 32 bytes on purpose (ADR-0018 D2): a token is
  -- a bearer credential and its entropy is anti-forgery, while a slug buys nothing but a
  -- name and a button, so its entropy only has to defeat enumeration.
  slug       text unique not null,
  -- No default, for the reason ADR-0008:29 gives app.users and app.bulletins: the writer
  -- states when the thing happened rather than inheriting whatever moment the row
  -- happened to be inserted at.
  created_at timestamptz not null,
  -- Null until the owner rotates, and the moment of the most recent rotation after that.
  rotated_at timestamptz
);

comment on table app.personal_links is
  'One permanent, rotatable personal link per user (issue #206). The slug is 16 CSPRNG '
  'bytes, base64url, and is not derived from the owner. Rotation OVERWRITES the slug: the '
  'retired value is not stored anywhere, so the old URL answers exactly what an invented '
  'one answers (ADR-0002 §10). Opening a link connects nobody — it produces an '
  'app.connection_requests row the owner must accept.';

comment on column app.personal_links.rotated_at is
  'When the owner last rotated. Deliberately does NOT record the previous slug: a retired '
  'address kept in a column is a retired address still in the database.';

select app.apply_rls_backstop('app.personal_links');
grant select, insert, update, delete on table app.personal_links to app_rw;

--------------------------------------------------------------------------------
-- 2. app.connection_requests  (issue #206, ADR-0018 D4/D5)
--------------------------------------------------------------------------------

-- ⚠ **Its own table, never a second meaning for `app.invitations`.** An invitation is
-- spent by its holder; a request is answered by its recipient. They have different
-- actors, different terminal states, and opposite consent directions — forcing them into
-- one table means a nullable `accepted_by_id` that means "who spent it" on some rows and
-- nothing on others, which is the placeholder shape addendum §4 refuses.
--
-- ⚠ **No `personal_link_id` column, and the absence is deliberate.** Rotation must not
-- touch requests already received (issue #206), and a foreign key to a row whose slug is
-- overwritten in place would either carry a stale meaning or invite a cascade. What a
-- request records is that two people are involved; which address the requester came
-- through is not a fact anybody reads back.
create table app.connection_requests (
  id           uuid primary key default pg_catalog.gen_random_uuid(),
  -- Whose link was opened. The only person who may ever decide this row.
  owner_id     uuid not null references app.users (id),
  -- Who asked. Taken from the resolved actor, never from request input (ADR-0002 §5a).
  requester_id uuid not null references app.users (id),
  status       text not null,
  created_at   timestamptz not null,
  -- Null while pending, non-null forever after — see connection_requests_decided_at.
  decided_at   timestamptz,
  -- Matching `connections_distinct_parties` and `intro_requests_distinct_parties`. The
  -- sanctioned path can never produce a violation — the gated insert carries
  -- `owner_id <> requester_id` in its own WHERE — which is what makes this a backstop
  -- rather than the rule.
  constraint connection_requests_distinct_parties check (owner_id <> requester_id),
  -- A `text` column with a CHECK rather than an enum, matching `app.connections.status`
  -- and `app.intro_requests.status`: adding a state is then a migration rather than a
  -- type rewrite.
  --
  -- ⚠ There is no `expired` state, and there must not be one. Expiry is evaluated at read
  -- and decide time against `created_at` (ADR-0018 D5), so it needs no writer — a stored
  -- state would need a cron to maintain it and would be wrong for exactly as long as that
  -- cron was behind.
  constraint connection_requests_status
    check (status in ('pending', 'accepted', 'declined')),
  -- The two columns cannot disagree. The equality form says it in one direction rather
  -- than two implications a later editor could half-delete.
  constraint connection_requests_decided_at
    check ((status = 'pending') = (decided_at is null))
);

comment on table app.connection_requests is
  'One row per "send connection request" through a personal link (issue #206). The owner '
  'is the gate: accepting writes the app.connections edge in the same transaction, '
  'declining writes nothing else. A decline is invisible to the requester and '
  'indistinguishable from a request nobody has answered — the same rule ADR-0017 rests '
  'on, one relationship along.';

comment on column app.connection_requests.status is
  'pending -> accepted | declined. Both decisions are terminal. Expiry is NOT a status: a '
  'pending row older than the TTL is treated as gone by every read and by the gated '
  'update, with no cron to fall behind.';

-- **The one-open-request-per-pair rule**, and the reason a double-tap cannot produce two
-- rows. Partial, so a *decided* request leaves the pair free to ask again — a declined
-- request must not be a permanent block, because a decline the requester cannot see must
-- not be a decision they can never revisit.
--
-- ⚠ **It cannot tell a lapsed pending row from a live one, and it must not try.** An index
-- predicate has to be immutable, so it cannot read a clock; `where status = 'pending' and
-- created_at > now() - interval '14 days'` is not a legal index. The gated insert therefore
-- carries an `on conflict … do update … where <lapsed>` arm that refreshes an expired row
-- instead of refusing it — without which the fourteen-day expiry would silently be a
-- permanent block on the pair, which is the opposite of what an expiry is for. See
-- `postgres-connection-request.repository.ts`.
create unique index connection_requests_open_per_pair_idx
  on app.connection_requests (owner_id, requester_id)
  where status = 'pending';

-- The owner's inbox — "who is waiting on me" — and the pending-cap count, which is the
-- same question with a `count(*)` on it. Partial on `pending` and ordered by
-- `created_at desc` because both readers want the newest first and both discard anything
-- older than the TTL, so the index prefix is exactly the scan.
create index connection_requests_owner_pending_idx
  on app.connection_requests (owner_id, created_at desc)
  where status = 'pending';

-- The per-link rate window, which unlike the two above spans every status: a burst that
-- was declined as fast as it arrived still consumed the link's recent budget, or
-- declining would be how an attacker resets it.
create index connection_requests_owner_recent_idx
  on app.connection_requests (owner_id, created_at desc);

-- ⚠ There is deliberately **no requester-side index**, because there is deliberately no
-- requester-side read (ADR-0018 D6). A requester learns of an acceptance the way an
-- introduced pair does — the edge appears on their graph — and learns nothing at all of a
-- decline. An index here would be the first half of building the read that breaks that.

select app.apply_rls_backstop('app.connection_requests');
grant select, insert, update, delete on table app.connection_requests to app_rw;

--------------------------------------------------------------------------------
-- 3. Sweep (ADR-0002 §3)
--------------------------------------------------------------------------------

revoke all on table app.personal_links, app.connection_requests
  from anon, authenticated, public;

reset role;
