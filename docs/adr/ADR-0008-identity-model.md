# ADR-0008 — Identity model: auth user ↔ internal ID

- **Status:** proposed
- **Date:** 2026-07-30
- **Drivers:** addendum §17 ("do not duplicate Supabase Auth email data"), §15; PDF §3, §4 "Entry and identity", §6, §7

## Context

The PDF specifies *"Minimal identity: immutable internal ID, unique handle, display name, optional
avatar and contact fields"*, magic-link authentication via Supabase, no traditional profile pages, no
public people search, and GDPR erasure. The addendum forbids duplicating auth email into product tables
without a concrete use case.

Two identifiers therefore exist, and conflating them is the mistake to avoid: Supabase's
`auth.users.id`, and the product's own user ID.

## Decision

**A separate immutable internal user ID, with exactly one link row to the Supabase auth user. Every
product foreign key references the internal ID. No email column anywhere in `app`.**

```sql
app.users (
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
)
app.user_contact_fields (user_id, kind, value, visibility)  -- optional, per-field visibility
app.handle_tombstones (handle citext primary key, retired_at timestamptz)
```

Rules:

1. **`id` is immutable and never reused.** All FKs (connections, trust, bulletins, reports,
   notifications, outbox `actor_id`) point at it.
2. **`auth_user_id` is the only bridge.** Deliberately *not* a cross-schema FK: Supabase manages
   `auth.users`, and coupling our referential integrity to a vendor-managed table makes both erasure and
   a future auth migration harder. Integrity is maintained by the sign-in path plus a nightly
   reconciliation check.
3. **No email in `app`.** Email lives only in `auth.users`. If a future feature needs it, it is fetched
   at that moment through the auth admin API and not stored — and that feature needs its own ADR entry
   here.
4. **Handle is chosen at onboarding and immutable in v1.** Changing a handle in a network built on
   real-world recognition is an impersonation vector (a retired handle re-issued to someone else lets
   them inherit shared links and recognition). Operator-assisted change exists as a support path; the
   old handle goes to `handle_tombstones` and is never re-issued. User-facing handle change is a v2
   question with a real design cost — deferring is the simplest safe choice (§24).
5. **Reserved/normalized handles:** `citext` unique, `[a-z0-9_]{3,24}`, a reserved-word blocklist
   (`admin`, `support`, `steward`, `operator`, …), and a confusable-normalization check to reduce
   look-alike impersonation.
6. **Display name is not unique** and is not an identifier. Person cards show only what the viewer is
   authorized to see (PDF §4); the disclosure decision belongs to ADR-0004's read model, not to this table.
7. **Contact fields are per-field visibility-gated** (the prototype's "anyone / trust 50+ / trust 75+"),
   evaluated server-side, and never included in a response the viewer is not authorized for.
8. **Auth context → actor resolution** happens once, at the tRPC context boundary: verify the Supabase
   JWT, map `auth_user_id → app.users.id`, reject if `status` is `erased` or `suspended`. Application
   services receive an `Actor { userId, handle }` — never a JWT, never a Supabase client (§2, §6).

### Lifecycle

| State | Meaning | Effect |
|---|---|---|
| `active` | normal | — |
| `deactivated` | user-initiated, **reversible** | invisible in graph/board/search/notifications; connections preserved; sign-in restores |
| `suspended` | operator action (PDF §5) | sign-in allowed or blocked per operator action; no posting; content hidden |
| `erased` | GDPR erasure, **irreversible** | see below |

**Erasure** (single transaction + outbox event `UserErased`):
`display_name`, `avatar` object, and contact fields deleted; `handle` retired to tombstone and replaced
with an opaque placeholder; bulletins, reports authored, dismissals, views, Notify Me query, push
subscriptions, and pending mutations hard-deleted; connections and directional trust rows deleted
(including trust *others* set on them); Supabase auth user deleted. The `app.users` row is retained as a
tombstone holding **only** `id`, `status='erased'`, `erased_at` — this keeps referential integrity for
audit records without retaining personal data. Audit entries retain the internal ID only, which is
pseudonymous and is documented as such in the privacy notice.

Anything referencing an erased user must fail closed (ADR-0005 precedence rule 1; ADR-0002 test B11).

## Alternatives considered

| Alternative | Why not |
|---|---|
| **Use `auth.users.id` as the product ID** | Simplest on day one, and the most common mistake. It welds every FK in the product to a vendor table, makes provider migration a full-database rewrite, and makes erasure ordering hazardous (deleting the auth user would orphan or cascade product rows). One indirection column removes all of it. |
| **Copy email into `app.users`** | Explicitly discouraged by §17; adds a high-value PII field to every backup and log surface for no v1 use case. |
| **Mutable handles** | Impersonation risk (see rule 4) and stale shared links, for a v1 benefit we cannot evidence. |
| **Handle as the primary key** | Any future handle change becomes a cascading rewrite; identifiers should not carry meaning. |
| **Full row delete on erasure** | Breaks audit referential integrity and destroys the ability to demonstrate that erasure happened — which regulators ask for. A minimal tombstone is the standard resolution. |
| **Soft-delete only** | Not GDPR erasure. |

## Consequences

- **Positive:** the auth provider is swappable; erasure has a clear boundary; no PII duplication;
  every FK is stable forever.
- **Negative:** one extra lookup per request (auth ID → internal ID). Cached per request scope; it is a
  single indexed read.
- **Negative:** reconciliation is needed for the non-FK bridge (nightly cron: auth users with no `app`
  row, and vice versa) — alert only, no auto-repair.
- **One-way door:** the erasure scrub is irreversible by design and the shape of the tombstone is hard
  to change later. It is the single highest-consequence decision in this ADR; the erasure test
  (§21, B11) is written *before* the erasure code.

## Verification

`accepted` when sign-in resolves an `Actor` through `auth_user_id`, a fitness test asserts no column
named `email` exists in schema `app`, and the erasure integration test (B11) is green.

## Amendment — 2026-08-05 — the confusable-normalization algorithm, named

**What changed.** Rule 5 asked for "a confusable-normalization check" without saying what counts as a
confusable. It now names one: a **digit-substitution skeleton**, `0→o 1→l 3→e 5→s 7→t`, applied after
lowercasing. Two handles collide when their skeletons are equal, so `m00nlight` cannot be registered
while `moonlight` exists.

**Why this and not more.** It is the minimum that closes the route the rule exists for — a look-alike
of an existing handle, registered to impersonate its holder — using only characters the charset
already permits (`[a-z0-9_]`). A full Unicode confusables table (UTS #39) is the eventual answer and
is *not needed yet*: the charset admits no non-ASCII character, so there is nothing for it to fold.
Homoglyph pairs within ASCII (`rn`/`m`, `l`/`I`) are the next extension, and are deliberately deferred
until the rule has a real false-positive budget to spend — `rn`→`m` refuses `barnaby` for `bamaby`.

**Where it lives.** `CONFUSABLE_SUBSTITUTIONS` in
`apps/server/src/modules/identity/domain/handle.ts`, as one table. Extending the check means adding an
entry there and nowhere else: the repository compiles the same table into the Postgres `translate()`
call it compares with, so the SQL cannot keep folding an older set. A substitution that `translate()`
cannot express (anything not one character to one character) throws rather than silently diverging.

**What a user is told.** Nothing that distinguishes it. A confusable collision and a `citext` case
collision return the same generic "not available" sentence, because escalation E5 forbids an
availability oracle — the codes (`HANDLE_CONFUSABLE`, `HANDLE_CASE_COLLISION`) differ for the server's
logs and for M2-AC25's evidence, not for the caller.

**Second amendment — the length rule has two codes.** `{3,24}` is one rule with two bounds; M2-AC25
quotes only the over-length scenario. The implementation raises `HANDLE_TOO_LONG` and
`HANDLE_TOO_SHORT` rather than folding the lower bound into `HANDLE_INVALID_CHARSET`, because `code`
is the field a client branches on and naming the wrong rule there is worse than a seventh code.
