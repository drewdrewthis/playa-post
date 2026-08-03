# ADR-0002 — Authorization and visibility enforcement strategy

- **Status:** proposed
- **Date:** 2026-07-30 (revised 2026-07-30 after devil's-advocate stress test —
  `docs/engineering/reviews/2026-07-30-adr-0002-stress-test.md`, verdict *sound-with-changes*;
  §3's `ALTER DEFAULT PRIVILEGES` statement corrected 2026-08-02 when M1b.2 implemented it and
  measured it doing nothing — decision unchanged, see the note in §3)
- **Drivers:** addendum §15 (explicitly requires this ADR), §9, §16, §21; PDF §5 "Visibility, Safety, and Moderation", §6, §8 "Security architecture"

## Context

Visibility is the product. Trust is private and directional, hidden people appear only as topology,
blocking is a hard mutual-invisibility invariant, and reports are never visible to the reported party.
The addendum is blunt about the trap: *"Do not assume a shared privileged database connection
automatically carries the authenticated Supabase user context."*

The available enforcement layers, and what each actually buys:

- **Supabase RLS** is designed for the case where the *client* holds the JWT and talks to PostgREST as
  role `authenticated`, with `auth.uid()` resolving per request. Our clients never talk to PostgREST —
  they talk to tRPC. Our API holds one pooled connection as one role. Under transaction-mode pooling,
  a session GUC set at request start is not guaranteed to be the one in scope at statement time, and a
  stale `request.jwt.claims` is a silent cross-user read. Making RLS primary would mean re-introducing
  per-request session state we cannot reliably guarantee.
- **Application-layer authorization** is where the rules actually live (trust is directional, visibility
  depends on graph reachability, blocks, dismissals, and author audience) — this is domain logic, and
  §15 says centralize it in explicit policies or database functions.
- **Least-privileged roles + revoked grants** are cheap, static, and testable, and they defend against
  the highest-probability real breach: something reaching our tables by a path we did not intend.

**The load-bearing bet, stated plainly:** with the policy shape below, there is no second line of defence
for *viewer-scoped* visibility. The database will never catch a missing or wrong `WHERE`. That makes the
B-suite below the actual control, not a test suite — it is judged and maintained as critical
infrastructure, and the repo DoD is extended accordingly.

## Decision

**Server-side authorization is the single authoritative layer, expressed as domain policies and
checked-in SQL visibility functions that take `viewer_id` as an explicit parameter. RLS and role
privileges are configured as a deny-by-default backstop, not as the mechanism.**

Concretely, for v1:

### 1. Schema isolation

**All product tables live in schema `app`**, never `public`. `app` is *not* added to Supabase's
exposed schemas, so PostgREST (the `anon`/`authenticated` data API) cannot reach product data at all.
This is the strongest single control we get for free.

### 2. One application role

**`app_rw` is the only role the API connects as.** It is not `postgres`, not `service_role`. It is
`NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT`, holds `USAGE` on `app`, and has explicit
`SELECT/INSERT/UPDATE/DELETE` grants per table (no blanket `ALL ON ALL TABLES`). It **owns nothing**.
It is a member of no other role, so it cannot `SET ROLE` to escalate.

**Migrations run as `app_migrator`**, which owns every object in `app`, in CI/CD only, never as `app_rw`.
`app_migrator` credentials live in the deploy platform's secret store, are not available to the running
API, and their use is restricted to the migration job — see Q5 for break-glass.

### 3. Revocation — including the parts that are easy to miss

```sql
REVOKE ALL ON SCHEMA app                     FROM anon, authenticated, PUBLIC;
REVOKE ALL ON ALL TABLES    IN SCHEMA app    FROM anon, authenticated, PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA app    FROM anon, authenticated, PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA app    FROM anon, authenticated, PUBLIC;
REVOKE ALL ON ALL ROUTINES  IN SCHEMA app    FROM anon, authenticated, PUBLIC;

-- One object type per statement, and deliberately NOT `IN SCHEMA app` — see below.
ALTER DEFAULT PRIVILEGES FOR ROLE app_migrator REVOKE ALL ON TABLES    FROM anon, authenticated, PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE app_migrator REVOKE ALL ON SEQUENCES FROM anon, authenticated, PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE app_migrator REVOKE ALL ON FUNCTIONS FROM anon, authenticated, PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE app_migrator REVOKE ALL ON ROUTINES  FROM anon, authenticated, PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE app_migrator REVOKE ALL ON TYPES     FROM anon, authenticated, PUBLIC;
```

> **Corrected 2026-08-02 (M1b.2).** This block previously read
> `ALTER DEFAULT PRIVILEGES … IN SCHEMA app REVOKE ALL ON TABLES, SEQUENCES, FUNCTIONS, ROUTINES,
> TYPES …` as a single statement. That text was wrong twice, and the second way was silent:
> PostgreSQL's grammar takes one object type per statement, and **the `IN SCHEMA` form cannot revoke
> a hard-wired default at all.** `get_user_default_acl()` treats a per-schema `pg_default_acl` row as
> *additive* — it starts from the hard-wired default and merges the row in — so a schema-scoped entry
> can only ever grant more. A global row (`defaclnamespace = 0`) replaces the hard-wired default
> outright, which is the only way to express "PUBLIC gets nothing". Measured on `postgres:17`: with
> the `IN SCHEMA` form PostgreSQL stores no catalog row, reports `ALTER DEFAULT PRIVILEGES`, and a
> function created afterwards is still `PUBLIC`-executable. Evidence:
> `.github/evidence/alter-default-privileges-scope.txt`; the regression that catches it is case (h)
> in `.github/evidence/security-suite-falsification.txt`. The decision is unchanged — only the
> statement that implements it.

Four things this spells out deliberately:

- **Functions.** PostgreSQL grants `EXECUTE` on new functions to `PUBLIC` **by default**. Without the
  function revoke *and* the default-privilege revoke, every new `app.visible_*` function is
  world-executable the moment it is created. This is the one place where "revoke from `PUBLIC`" is
  doing real work, and the one the short phrasing glosses.
- **Sequences.** `bigserial`/identity columns need `GRANT USAGE, SELECT ON SEQUENCE … TO app_rw`.
  Omitting it fails inserts at deploy time, and the field fix under pressure is `GRANT ALL`.
- **`ALTER DEFAULT PRIVILEGES` is per-creating-role.** It must be declared `FOR ROLE app_migrator`.
  If anything else ever creates an object in `app`, the defaults do not apply — the same hole as
  ownership drift, and caught by the same assertion (B3). `FOR ROLE` is what keeps the global form
  narrow: it binds only to objects that role creates, and `app_migrator` creates objects only in `app`.
- **The default-privilege revokes are asserted behaviourally, not by reading `pg_default_acl`.** B3
  creates a function, a type, a table and a sequence as `app_migrator` inside a rolled-back
  transaction and asserts `anon`, `authenticated` and `PUBLIC` hold nothing on them. A catalog-row
  assertion would have passed against the broken statement above, because the broken statement's
  distinguishing symptom is the *absence* of a row.

### 4. RLS backstop — the exact policy shape

Per table, verbatim. Deviations from this text are regressions, and B3 asserts the shape, not the
intent:

```sql
ALTER TABLE app.<t> ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.<t> FORCE  ROW LEVEL SECURITY;
CREATE POLICY app_rw_full_access ON app.<t>
  AS PERMISSIVE FOR ALL TO app_rw
  USING (true) WITH CHECK (true);
COMMENT ON POLICY app_rw_full_access ON app.<t> IS
  'Intentionally unconditional. Viewer-scoped authorization lives in the application layer (ADR-0002).';
```

Every clause is load-bearing:

- **`FORCE`** — without it the table owner (`app_migrator`, and any object that drifts to `postgres`
  ownership via a dashboard action or an extension) bypasses RLS silently while `relrowsecurity` still
  reads `true`.
- **`TO app_rw`** — omitting `TO` defaults to `TO PUBLIC`, which leaves RLS enabled and every naive
  check green while the RLS layer permits every role in the cluster.
- **`FOR ALL`** — stated explicitly rather than left to be discovered. (`FOR ALL … USING (true)` does
  cover writes, since Postgres reuses `USING` as `WITH CHECK` for `ALL` policies; `WITH CHECK (true)`
  is written anyway so the shape is greppable and asserting it is unambiguous.) A reviewer copying the
  pattern as `FOR SELECT` breaks all writes, and the predictable emergency fix is a permissive grant.
- **The named policy and the comment** — so a reviewer encountering `USING (true)` reads a deliberate,
  documented statement rather than assuming a mistake.
- **Ownership** of every object in `app` is `app_migrator`, asserted by B3.

### 5. Viewer-scoped reads

**Every viewer-scoped read passes `viewer_id` explicitly.** No query derives the viewer from ambient
session state. Viewer-scoped SQL lives in checked-in functions (`app.visible_people(viewer_id …)`,
`app.visible_bulletins(viewer_id …)`) or in a module's `persistence/sql/*.sql`, and every one is
`SECURITY INVOKER`.

Pooler-safety rules that follow from having no reliable session state:

- **Every object reference is schema-qualified** (`app.bulletins`, never `bulletins`). If a
  `public.bulletins` ever exists, an unqualified name becomes a silent cross-table read.
- **Every function in `app` carries `SET search_path = ''`**, so a caller cannot change its meaning.
- **`graph_surrogate_key` (ADR-0004) reaches SQL as a bound query parameter or via a role-level
  `ALTER ROLE app_rw SET`** — never a per-request session `SET`. A per-request GUC under a
  transaction-mode pooler is exactly the fragility this ADR rejects in its own alternatives table.

### 5a. `viewer_id` provenance

The catastrophic bug in this design is not a missing `WHERE`. It is a `viewerId` that arrives from
**request input** instead of from the authenticated actor. One Zod schema with
`viewerId: z.string().uuid()` on a procedure is total, silent, trivially exploitable impersonation of
every user in the system. RLS-as-mechanism would have made that specific bug impossible; this design
gives that up, so it must replace it:

- **`ViewerId` is a branded type constructible only from the `Actor`** resolved at the tRPC context
  boundary (ADR-0008 rule 8). There is exactly one constructor and it takes an `Actor`.
- Visibility functions, query classes, and repository methods accept `ViewerId`, never `string`.
- **No procedure input schema anywhere may carry a viewer, owner, actor, or user identifier field.**
  Ownership is derived, never asserted by the caller. Enforced by B14.

### 6. One composition point

The authorized-bulletin set and the authorized-person set are each defined **once**, as a CTE/function
that every board query, saved view, Notify Me evaluation, search, API read, and intro-eligibility check
builds *on top of*. User filters narrow; they can never widen (ADR-0007). Duplicating a subtly different
visibility predicate in a second router is the failure mode §15 names — B12 is the structural check.

### 6a. One person-projection rule

There are **two** authorized sets, and their interaction is the leak that composition alone does not
prevent: bulletin visibility depends on the author's audience plus reachability, while *person*
disclosure depends on the target's own settings (ADR-0004 — "name visible to: anyone / trust 50+ /
trust 75+"). A bulletin can therefore be legitimately visible while its author is not.

**Rule: every person representation in every payload is projected through `app.visible_people`'s
`disclosure` level. No exceptions.** A bulletin author below `full` disclosure renders as a Private
author — name, handle, and avatar absent — even though the bulletin itself is authorized. The same
applies to notification actors, intro connectors, search results, and audit views. A payload that builds
an author card by joining `app.users` directly is the bug; B5's sub-cases assert against it.

### 7. Ordering

Authorization is applied **before** search, saved filters, and Notify Me evaluation (PDF §5).
Blocking prunes at traversal time, before any other rule (ADR-0004).

### 8. Operator and privileged reads

An operator read is by definition a read that **must** bypass viewer visibility (PDF §5: *"Operator
review may inspect the reported bulletin and relevant metadata"*). With `app_rw` as the only role, the
operator console has nothing to bind to, and the two paths a developer will otherwise take are a
`SECURITY DEFINER` function — making the B4 allowlist the operator API by accident — or `service_role`,
which detonates the model. PDF §8's rule about privileged credentials applies to operators too.

For v1:

- **A distinct `app_operator_ro` role**, `SELECT`-only, granted on the moderation-relevant tables only
  (reports, bulletins, users, audit) — **not** on trust, dismissals, or saved views.
- **A separate entrypoint** with its own composition root and its own authentication path. Operator
  status is a property of that entrypoint, not a flag on a product user.
- **Operator reads are the single sanctioned bypass of viewer visibility, and every one emits an audit
  entry** — per *read*, not only per action. An operator inspecting a report is itself an auditable event.
- Operator writes are limited to the enumerated PDF §5 actions: remove content, restrict bulletin
  creation, suspend an account, disable an account.
- The reporter's identity is never present in any surface reachable by a reported user, including
  operator-mediated ones.

### 9. Storage objects

`storage.objects` lives in the `storage` schema under Supabase's own policy set — entirely outside
decisions 1–4. PDF §6 requires upload buckets to stay private and authorization-protected.

- **Buckets deny all access to `anon` and `authenticated`.** No public buckets, ever.
- **Access is only via server-minted signed URLs**, and minting passes through the **same disclosure
  predicate** as §6a. A board response that eagerly signs every author avatar hands out a bearer
  capability for people the viewer may only see as topology.
- **Maximum signed-URL TTL: 5 minutes.** A signed URL is a capability that outlives its authorization
  check and is shareable: PDF §5 requires a block to end contact exposure and to invalidate cached data,
  and a 1-hour URL minted at 13:59 survives a 14:00 block. Five minutes bounds that window to something
  we can state honestly — short enough that revocation is effectively prompt, long enough for a page render.
- Erasure deletes the underlying objects (ADR-0008), which closes the erasure case independently.

### 10. Unauthorized is indistinguishable from non-existent

Visibility is the product, so *"does this exist"* is itself protected information.

**Invariant: an unauthorized resource and a non-existent resource produce identical HTTP status,
identical error code, and byte-identical response bodies.** No 403-versus-404 tell, no "exists but
hidden" error variant, no differing validation path.

Consequences that follow, each asserted by B17:

- Single-entity fetches (`bulletins.getById`, person, view) return the same 404 + `NOT_FOUND` shape in
  both cases.
- `from:` in the board grammar is **filter-then-resolve**: an author fragment matching nobody in the
  authorized set yields **zero rows**, never a validation error (ADR-0007). Rejecting it would answer
  "does a person named X exist", which PDF §3/§4 forbid.
- Intro-connector resolution behaves the same way.
- Reporting or dismissing an invisible bulletin fails with the same shape as reporting a non-existent
  one — the response must not confirm existence.
- `IDEMPOTENCY_KEY_REUSE` (ADR-0005) is already safe because mutation IDs are namespaced by `actor_id`;
  B17 keeps it that way.

**Not closed here:** handle availability at onboarding is a genuine people-existence oracle that this
invariant cannot fix without a product decision — escalated as E5 in the implementation plan.

### 11. Delivery-time authorization re-check

PDF §5 requires a block to stop notification delivery. Grouping windows and a 1-minute cron (ADR-0006)
mean a push can be *computed* before a block and *sent* after it: A blocks B at 14:00:00, the flush at
14:00:05 was computed at 13:59:50.

- **Recipient authorization — block, erasure, revoked visibility, deactivation — is re-evaluated in the
  send handler immediately before dispatch, inside the same transaction as the consumer receipt.**
  Compute-time evaluation is an optimization; send-time evaluation is the authorization.
- **Push payloads carry identifiers and a generic string only** — never bulletin content, headline,
  author name, or contact details. A rendered lock-screen notification is data leaving the authorization
  boundary onto an unlocked-device surface. The client fetches content after authenticating.

## Bypass-test plan

A dedicated `tests/security/` suite, run in CI against a real Postgres (Testcontainers) with production
migrations applied — **plus B18, which runs against the live database.** Failing any of it fails the
build. B5–B11, B13, B15–B17 are scenario tests over real data (addendum §21: "prefer observable behavior
and state"), not mock assertions.

| id | Test | Passes when |
|----|------|-------------|
| B1 | Connect as `anon` and as `authenticated`; `SELECT` from every table in `app` | every attempt raises `permission denied` (42501); the test fails if the enumerated table count is 0 |
| B2 | Hit the Supabase REST endpoint for each `app` table with a valid user JWT | 404/`PGRST106` (schema not exposed) for all; catalog-driven, so a newly exposed schema fails |
| B3 | **Full policy-shape and privilege assertion** over every table in `app`: `relrowsecurity = true`, `relforcerowsecurity = true`, `relowner = app_migrator`, and exactly one `pg_policies` row with `policyname='app_rw_full_access'`, `permissive='PERMISSIVE'`, `roles={app_rw}`, `cmd='ALL'`, `qual='true'`, `with_check IS NULL OR 'true'`. Plus: `app_rw` has `rolsuper=false`, `rolbypassrls=false`, and **no row in `pg_auth_members`**; no `service_role` or `postgres` credential is present in the deployed runtime's environment | all true for all tables — a new table missing RLS, `FORCE`, ownership, or the exact policy shape fails, which is the point |
| B4 | Catalog assertion: no `SECURITY DEFINER` function exists in `app` unless listed in the checked-in allowlist with a justification comment; allowlisted definers must also carry `SET search_path` and an explicit test | true |
| B5 | **Visibility matrix**: for each viewer-scoped query, a viewer with no relationship to the data gets **0 rows** — bulletins, people, connections, trust, reports, notifications, dismissals, views. **Sub-case (§6a):** an authorized bulletin whose author is below `full` disclosure renders a Private author on the board, in search results, in notifications, and in intro flows | 0 rows in every cell; no identity fields in any sub-`full` author representation |
| B6 | **Directional trust** is never present in any payload returned to the other party or a third party, at any nesting depth — asserted on serialized JSON across success payloads **and error and conflict envelopes** (ADR-0005 returns `currentVersion`/`currentState` on conflict) | no match for the trust value or its field name anywhere |
| B7 | **Blocking**: after A blocks B, B's queries return no A rows and vice versa; no graph path routes through the blocked edge; no directed request or notification is deliverable; cached data invalidates on next sync. **Plus the flush boundary**: a grouped push computed before the block and flushed after it is not delivered. **Plus the offline case**: a client that never syncs again must not present the blocked party's content past the staleness bound (E6) | all hold |
| B8 | **Hidden ("ghost") people**: the payload contains no name, handle, avatar, role, mutual count, or real internal ID (ADR-0004 surrogate), and surrogates differ across viewers. **Plus a structural re-identification fixture**: a graph in which a ghost's neighbour set would uniquely determine it, asserted against ADR-0004's adjacency rule | assert on response JSON keys and values |
| B9 | **Report privacy**: the reported author's every read path — bulletin, notifications, audit, API, operator-mediated surfaces — contains no reporter identity | no match |
| B10 | **Filter cannot widen**: a saved view / Notify Me query crafted to reference a non-authorized author, tag, or bulletin returns 0 rows rather than an error-free leak | 0 rows |
| B11 | **Erased user**: after erasure no query path returns their personal data; stale offline mutations referencing them fail closed | 0 rows / structured error |
| B12 | **Composition assertion** (replaces the SQL-string grep as the primary rule): every query implementation taking a `ViewerId` references `app.visible_people` / `app.visible_bulletins` or the shared authorized-set builder — a viewer-scoped query that does not compose the authorized set fails the build. Retains the SQL-location rule (addendum §9) as a secondary check with a named detection rule (AST/`sql` tag aware, not a bare `SELECT` grep) and a violating fixture | no uncomposed viewer-scoped query; no SQL outside `persistence/` and `supabase/` |
| B13 | **Write-path IDOR matrix**: for every mutation type in ADR-0005's conflict matrix, an actor with no relationship to the subject gets a structured failure with **zero state change and zero outbox rows** — covering `bulletin.update`/`archive`, `trust.set`, `connection.accept`/`remove`, `block.create`, `intro.request`, `bulletin.report`/`dismiss`, `view.save`, `notifyMe.update` | every row fails closed; `SELECT count(*)` unchanged on both the entity table and `outbox_events` |
| B14 | **`viewerId` provenance fitness**: no tRPC input schema on any procedure contains a `viewerId`/`userId`/`actorId`/`ownerId` field, asserted by walking the router type tree or an AST scan rather than by grep; and `ViewerId` has exactly one constructor, taking an `Actor` | no match; proven by adding such a field and observing the failure |
| B15 | **Operator scope**: the operator path cannot read trust values, cannot read reporter identity in any surface reachable by a reported user, cannot write product state outside the four enumerated actions, and emits an audit entry per read | all hold |
| B16 | **Storage**: direct bucket access as `anon`/`authenticated` is denied; a signed URL is minted only for an object the viewer is authorized to see under the §6a disclosure rule; TTL ≤ 5 minutes | all hold |
| B17 | **Existence-oracle indistinguishability**: unauthorized and non-existent produce identical status, error code, and byte-identical bodies across single-entity fetch, `from:` resolution, intro-connector resolution, and report/dismiss of an invisible bulletin | `diff` of the paired response bodies is empty in every case |
| B18 | **Post-deploy catalog smoke against the LIVE database** through the production connection path: B1, B3, and B4's assertions plus `current_user = session_user = 'app_rw'`. Gates the M4.5 rollout | all true against the deployed environment, not only against Testcontainers |

**Why B18 exists.** B1–B17 run against Testcontainers with the migration files applied. That proves the
*migrations* are correct. It proves nothing about which role the deployed API actually connects as, nor
about drift between `supabase/migrations/` and a live Supabase project that can change out-of-band via
the dashboard, extensions, or support actions. Without B18, a deploy that "temporarily" connects as
`postgres` to get past a Supavisor tenant-username problem leaves every other check green forever while
decisions 2 and 4 sit inert. ADR-0001 spike criterion S3a covers the same ground at spike time.

## Alternatives considered

| Alternative | Why not |
|---|---|
| **RLS as the primary mechanism, with per-request `set_config('request.jwt.claims')`** | Requires reliably scoping session state to a request across a transaction-mode pooler. A leaked or stale setting is a silent cross-tenant read — the worst failure shape available. Also splits visibility logic between SQL policies and application policies, which §15 forbids. |
| **Clients talk to Supabase PostgREST directly with RLS** | Contradicts "First-class API with the same authorization rules as the PWA" (PDF §3) and the tRPC→application→domain path (§2). Graph reachability and trust rules are not expressible as maintainable RLS predicates. |
| **Security-invoker views per entity** | Views inherit the same identity problem as RLS; they would just move the predicate. Useful later as a *convenience* over the visibility functions, not as the enforcement point. |
| **`SECURITY DEFINER` functions holding all visibility rules** | Concentrates power in objects that bypass caller privileges — one bug is total. Also puts product policy in SQL where it is hardest to unit-test. B4 keeps these out, and §8 exists so the operator console does not become the exception that swallows the rule. |
| **Application-only, no roles/RLS hardening** | Leaves no second line at all; a single missing `WHERE viewer_id` becomes a breach. The backstop costs ~4 lines per migration. |
| **A per-user database role** | Genuine defence in depth, and the only design in which the database could catch a missing `WHERE`. Rejected on operational cost: thousands of roles, role lifecycle welded to signup and erasure, and connection pooling that would have to be partitioned per role — which is precisely what a serverless runtime cannot do. Revisit only if the B-suite proves insufficient in practice. |

## Consequences

- **Positive:** one authoritative place for visibility rules, testable in ordinary unit and integration
  tests; no dependence on ambient DB session identity; PostgREST exposure is structurally impossible.
- **Negative — stated honestly:** the database will not save us from an application bug. B5, B6, B10,
  B12, B13, and B14 are load-bearing, and the suite must grow with every new viewer-scoped query and
  every new mutation type. That is a standing DoD item, not optional cleanup.
- **Negative — the nastiest operational property of this shape:** a table with RLS enabled and **no**
  policy returns **zero rows silently**, not an error. A privacy-config mistake therefore presents as a
  product bug ("the board is empty") and gets debugged for a day before anyone suspects privileges.
  B3's exact-shape assertion exists specifically to convert that silent failure into a loud one at
  migration time.
- **Negative:** RLS-with-a-permissive-policy looks alarming to a reviewer who expects RLS to be the
  mechanism. Mitigated by the mandatory policy name and the `COMMENT ON POLICY` text.
- **Negative:** a 5-minute signed-URL TTL means avatar URLs cannot be long-cached by the client and must
  be re-minted. Accepted as the cost of prompt revocation.
- **Escalation-worthy if revisited:** moving to RLS-as-mechanism later would change the trust model's
  enforcement point and is a material architectural change (§24) — new ADR required, not an edit here.

## Open questions (explicitly answered or deferred)

| # | Question | Disposition for v1 |
|---|---|---|
| Q1 | **Data export / GDPR subject access.** Is "A's trust in B" part of *B's* personal data? ADR-0008 deletes others' trust on erasure, implying yes — which would make it exportable to B, which B6 forbids. | Rule for v1: trust is the **holder's** data, not the subject's. It is deleted on the subject's erasure as data minimization, not as a subject right, and it is **never** exported to the subject. The export feature (plan M5 group E4) asserts this. If a regulator disagrees, that is a new ADR, not an edit. |
| Q2 | **`SECURITY DEFINER` allowlist governance.** B4 makes the allowlist the escape hatch. | Additions require a CODEOWNERS review, a `SET search_path`, and an explicit test. The operator model (§8) exists so the allowlist is not the default answer to "I need a cross-viewer read". |
| Q3 | **Telemetry and tracing.** PDF §6 forbids sensitive content in "logs, analytics, queue payloads, or exception traces"; nothing yet forbids a span attribute carrying a `viewerId`+`ghost_id` pair or a bulletin body in an error trace. | Covered by the observability redaction allowlist (plan M1.7) and asserted over a **captured trace**, not only over log lines. Recorded in the repo DoD (`docs/engineering/repo-map.md`). |
| Q4 | **Audit scope.** Neither the addendum nor the PDF enumerates audited events. | v1 audits: blocking, report creation and resolution, erasure execution, every operator read (§8) and operator action, and invitation issuance and revocation. |
| Q5 | **`app_migrator` credential handling.** It owns every table; a leaked migrator credential would bypass RLS absent `FORCE` — which is why `FORCE` is mandatory in §4. | Stored in the deploy platform's secret store, usable only by the migration job, rotated on any suspicion. Break-glass is a two-person operation documented in `docs/procedures/operations.md` (plan M4.9). |

## Verification

`accepted` when:

1. `tests/security/` implements **B1–B18** and is green in CI on `main`, with the runner reporting all
   eighteen row IDs as executed (a skipped or unimplemented row fails the job);
2. `supabase/migrations/` contains the role, grant, revoke, default-privilege, ownership, `FORCE`, and
   verbatim policy statements described in §2–§4;
3. B18 gates the staging rollout and has passed against a live database at least once;
4. ADR-0001 spike criterion S3a is recorded as passing.

Until all four hold, this ADR stays `proposed`.
