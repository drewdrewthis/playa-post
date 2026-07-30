# ADR-0002 — Authorization and visibility enforcement strategy

- **Status:** proposed
- **Date:** 2026-07-30
- **Drivers:** addendum §15 (explicitly requires this ADR), §9, §21; PDF §5 "Visibility, Safety, and Moderation", §8 "Security architecture"

## Context

Visibility is the product. Trust is private and directional, hidden people appear only as topology,
blocking is a hard mutual-invisibility invariant, and reports are never visible to the reported party.
The addendum is blunt about the trap: *"Do not assume a shared privileged database connection
automatically carries the authenticated Supabase user context."*

The available enforcement layers, and what each actually buys:

- **Supabase RLS** is designed for the case where the *client* holds the JWT and talks to PostgREST as
  role `authenticated`, with `auth.uid()` resolving per request. Our clients never talk to PostgREST —
  they talk to tRPC. Our API holds one pooled connection as one role. Under transaction-mode pooling,
  per-session `SET`/`set_config` of a user identity is fragile and easy to leak across checkouts.
  Making RLS primary would mean re-introducing per-request session state we cannot reliably guarantee.
- **Application-layer authorization** is where the rules actually live (trust is directional, visibility
  depends on graph reachability, blocks, dismissals, and author audience) — this is domain logic, and
  §15 says centralize it in explicit policies or database functions.
- **Least-privileged roles + revoked grants** are cheap, static, and testable, and they defend against
  the highest-probability real breach: something reaching our tables by a path we did not intend.

## Decision

**Server-side authorization is the single authoritative layer, expressed as domain policies and
checked-in SQL visibility functions that take `viewer_id` as an explicit parameter. RLS and role
privileges are configured as a deny-by-default backstop, not as the mechanism.**

Concretely, for v1:

1. **All product tables live in schema `app`**, never `public`. `app` is *not* added to Supabase's
   exposed schemas, so PostgREST (the `anon`/`authenticated` data API) cannot reach product data at all.
   This is the strongest single control we get for free.
2. **One application role, `app_rw`**, is the only role the API connects as. It is not `postgres`, not
   `service_role`. It has `NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE`, `USAGE` on `app`, and
   explicit `SELECT/INSERT/UPDATE/DELETE` grants per table (no blanket `ALL ON ALL TABLES`, no ownership).
   Migrations run as a separate `app_migrator` role in CI/CD, never as `app_rw`.
3. **`REVOKE ALL` from `anon`, `authenticated`, and `PUBLIC`** on schema `app` and every object in it,
   including default privileges for future objects.
4. **RLS is `ENABLE`d on every table in `app` with zero permissive policies.** With `app_rw` not owning
   the tables and not holding `BYPASSRLS`, this is a hard stop for any path that is not an explicitly
   granted one — it costs one line per migration and turns "someone exposed the schema" from a breach
   into an outage.

   > Consequence to accept knowingly: `app_rw` must therefore be granted the tables *and* the tables
   > must carry a single `USING (true)` policy for `app_rw`, or the API cannot read. We take the
   > explicit form: one named policy per table, `TO app_rw USING (true)`, so the grant is greppable and
   > the *absence* of a viewer predicate is a deliberate, documented statement — authorization is above,
   > not here. A silent `BYPASSRLS` would hide that; this does not.
5. **Every viewer-scoped read passes `viewer_id` explicitly.** No query derives the viewer from ambient
   session state. Viewer-scoped SQL lives in checked-in functions
   (`app.visible_people(viewer_id …)`, `app.visible_bulletins(viewer_id …)`) or in a module's
   `persistence/sql/*.sql`, and every one of them is a `SECURITY INVOKER` function — we never want a
   visibility function that runs with the definer's privileges.
6. **Visibility composes from one place.** The authorized-bulletin set and the authorized-person set are
   each defined once, as a CTE/function that every board query, saved view, Notify Me evaluation, search,
   and API read builds *on top of*. User filters narrow; they can never widen (ADR-0007). Duplicating a
   subtly different visibility predicate in a second router is the failure mode §15 names, and the
   bypass suite below is designed to catch it.
7. **Ordering:** authorization is applied before search, saved filters, and Notify Me evaluation
   (PDF §5). Blocking prunes at traversal time, before any other rule.

## Bypass-test plan

A dedicated `tests/security/` suite, run in CI against a real Postgres (Testcontainers) with production
migrations applied. Failing it fails the build. It must cover:

| id | Test | Passes when |
|----|------|-------------|
| B1 | Connect as `anon` and as `authenticated`; `SELECT` from every table in `app` | every attempt raises `permission denied` (42501) |
| B2 | Hit the Supabase REST endpoint for each `app` table with a valid user JWT | 404/`PGRST106` (schema not exposed) for all |
| B3 | Catalog assertion: every table in `app` has `relrowsecurity = true`, and `app_rw` has `rolbypassrls = false`, `rolsuper = false` | true for all — a newly added table without RLS fails this test, which is the point |
| B4 | Catalog assertion: no `SECURITY DEFINER` function exists in `app` unless listed in an allowlist file with a justification comment | true |
| B5 | Visibility matrix: for each viewer-scoped query, a viewer with no connection to the data gets **0 rows** — across bulletins, people, connections, trust, reports, notifications, dismissals | 0 rows in every cell |
| B6 | Directional trust: A's trust in B is never present in any payload returned to B or to any third party, at any nesting depth (assert on serialized response JSON, not on the query) | no match for the trust value or its field name |
| B7 | Blocking: after A blocks B, B's queries return no A rows, A's return no B rows, no graph path routes through the blocked edge, no directed request or notification is deliverable, and previously cached data is invalidated on next sync | all hold |
| B8 | Hidden ("ghost") people: the payload for a topology-only person contains no name, handle, avatar, role, or real internal ID (ADR-0004 surrogate) | assert on response JSON keys and values |
| B9 | Report privacy: the reported author's every read path — bulletin, notifications, audit, API — contains no reporter identity | no match |
| B10 | Filter cannot widen: a saved view / Notify Me query crafted to reference a non-authorized author, tag, or bulletin returns 0 rows rather than an error-free leak | 0 rows |
| B11 | Erased user: after erasure, no query path returns their personal data; stale offline mutations referencing them fail closed | 0 rows / structured error |
| B12 | Grep-level fitness: no SQL string outside `persistence/` and `supabase/` (addendum §9) | no matches |

B5–B11 are scenario tests over real data (addendum §21: "prefer observable behavior and state"),
not mock assertions.

## Alternatives considered

| Alternative | Why not |
|---|---|
| **RLS as the primary mechanism, with per-request `set_config('request.jwt.claims')`** | Requires reliably scoping session state to a request across a transaction-mode pooler. A leaked or stale setting is a silent cross-tenant read — the worst failure shape available. Also splits visibility logic between SQL policies and application policies, which §15 forbids. |
| **Clients talk to Supabase PostgREST directly with RLS** | Contradicts "First-class API with the same authorization rules as the PWA" (PDF §3) and the tRPC→application→domain path (§2). Graph reachability and trust rules are not expressible as maintainable RLS predicates. |
| **Security-invoker views per entity** | Views inherit the same identity problem as RLS; they would just move the predicate. Useful later as a *convenience* over the visibility functions, not as the enforcement point. |
| **`SECURITY DEFINER` functions holding all visibility rules** | Concentrates power in objects that bypass caller privileges — one bug is total. Also puts product policy in SQL where it is hardest to unit-test. B4 exists to keep these out. |
| **Application-only, no roles/RLS hardening** | Leaves no second line at all; a single missing `WHERE viewer_id` becomes a breach. The backstop costs ~4 lines per migration. |

## Consequences

- **Positive:** one authoritative place for visibility rules, testable in ordinary unit/integration tests;
  no dependence on ambient DB session identity; PostgREST exposure is structurally impossible.
- **Negative:** the database will not save us from an application bug — B5/B6/B10 are load-bearing, and
  the suite must grow with every new viewer-scoped query. This is stated as a standing DoD item (§25).
- **Negative:** RLS-with-a-permissive-policy looks alarming to a reviewer who expects RLS to be the
  mechanism. Mitigated by requiring the policy to be named `app_rw_full_access` and the comment on each
  table to state that authorization lives in the application layer.
- **Escalation-worthy if revisited:** moving to RLS-as-mechanism later would change the trust model's
  enforcement point and is a material architectural change (§24) — new ADR required, not an edit here.

## Verification

`accepted` when `tests/security/` exists with B1–B12 implemented and green in CI on `main`, and
`supabase/migrations/` contains the role, grant, revoke, and RLS statements described above.
