# Devil's-advocate stress test — ADR-0002 (Authorization and visibility enforcement)

- **Date:** 2026-07-30
- **Target:** `docs/adr/ADR-0002-authorization-and-visibility-enforcement.md` (status: proposed)
- **Read against:** addendum §9, §10, §15, §16, §17, §21, §22, §24, §25 (normative);
  `docs/Burner_Trust_Network_Final_Handoff.pdf` §3–§6, §8; ADR-0001, ADR-0004, ADR-0005, ADR-0006,
  ADR-0007, ADR-0008; `docs/engineering/implementation-plan.md` M1/M2/M4/M5.
- **State of the world:** no migrations, no `tests/security/`, no `apps/` — this is a pre-implementation
  review. Everything below is a claim about the *document*, not about code.
- **Verdict: sound-with-changes.**

---

## 1. Understanding check

Core thesis: *authorization is application-layer domain logic; the database is a blast door, not a
decision-maker.* Four decisions carry it:

1. Schema `app`, never exposed to PostgREST → the client data API structurally cannot reach product data.
2. One least-privileged role `app_rw` (`NOSUPERUSER NOBYPASSRLS`, non-owner, per-table grants).
3. `REVOKE ALL` from `anon` / `authenticated` / `PUBLIC`.
4. RLS `ENABLE`d everywhere with exactly one permissive `app_rw_full_access` policy per table
   (`TO app_rw USING (true)`), plus `viewer_id`-parameterised `SECURITY INVOKER` visibility functions
   composed from one place, plus a B1–B12 bypass suite.

The load-bearing bet: **there is no second line of defence for viewer-scoped visibility.** `USING (true)`
means the database will never catch a missing or wrong `WHERE`. The ADR says this out loud, which is to
its credit — but it means the B-suite *is* the control, and the B-suite must therefore be judged as
critical infrastructure rather than as tests.

## 2. What genuinely holds up

- **Rejecting RLS-as-mechanism is correct, and for the correct reason.** Under Supavisor transaction
  mode a session GUC set at request start is not guaranteed to be the one in scope at statement time;
  a stale `request.jwt.claims` is a silent cross-user read. Choosing that as *the* mechanism would have
  been the worst available failure shape. The alternatives table names this accurately.
- **Not exposing schema `app` to PostgREST is the highest-leverage line in the document.** It removes the
  entire `anon`/`authenticated` attack surface by construction rather than by policy, and B2 tests it.
- **Composing every viewer-scoped read on one authorized-set CTE (§6, and ADR-0004 §7, ADR-0007
  "Compilation")** is the right answer to §15's "do not duplicate subtly different visibility logic",
  and ADR-0007's narrow-only compilation is a genuinely structural guarantee rather than a convention.
- **`SECURITY INVOKER` everywhere + B4's allowlist** is the right default and rules out the
  concentrate-all-power-in-a-definer failure.

Everything below is what the document does not yet survive.

---

## 3. Challenges

### 🔴 D1 — The B-suite tests only reads. Every write path is unguarded and untested.

B5–B11 are read scenarios ("returns 0 rows", "contains no…"). There is not one test in B1–B12 that
attempts an unauthorised **mutation**. With `USING (true)` the database will execute all of these
happily; the only thing standing between them and success is a hand-written check in an application
service.

Unguarded write surfaces visible in the sibling ADRs, all reachable through `sync.submitMutations`
(ADR-0005) as well as through tRPC:

| Mutation | Bypass if the authz check is missing or wrong |
|---|---|
| `bulletin.update` / `bulletin.archive` | edit or delete another person's bulletin by ID |
| `trust.set` | write a trust value onto a connection you are not a party to — and, because `expectedVersion` is returned on conflict, **read** the other party's trust version, and via `conflict.currentState` potentially the value itself (ADR-0005 returns `currentState` in the conflict envelope) |
| `connection.accept` | accept an invitation addressed to someone else |
| `connection.remove` | sever a connection between two other people |
| `block.create` | create a block on behalf of another user |
| `intro.request` | request an introduction naming a connector the requester cannot see — an existence oracle for the connector, and a directed message into a graph region the requester has no path to |
| `bulletin.report` / `bulletin.dismiss` | report/dismiss a bulletin you cannot see → the response confirms it exists |
| `view.save` / `notifyMe.update` | write to another owner's saved view (`owner_id` is a column, not a scope) |

ADR-0005's precedence rules (erasure > block > revoked authorization) are about *lifecycle*, not about
*actorship*. Nothing in ADR-0002 or ADR-0005 states the invariant "every mutation handler must verify
the actor's relationship to every ID in the payload."

**Required:** add **B13 — write-path IDOR matrix**: for every mutation type in ADR-0005's conflict
matrix, an actor with no relationship to the subject gets a structured failure and **zero state change
plus zero outbox rows**. Make "one B13 row per mutation type" a §25 DoD item alongside the ADR-0005
conflict-matrix row.

### 🔴 D2 — `viewer_id` provenance is the design's single point of failure, and nothing enforces it.

Decision §5 says "every viewer-scoped read passes `viewer_id` explicitly." The catastrophic bug in that
shape is not a missing `WHERE` — it is a `viewerId` that arrives from **request input** instead of from
the authenticated `Actor`. One Zod schema with `viewerId: z.string().uuid()` on a query procedure is
total, silent, trivially exploitable impersonation of every user in the system. RLS-as-mechanism would
have made that specific bug impossible; this design deliberately gives that up and then does not
replace it.

This is cheap to close and the ADR should require it:

**Required:**
- A branded `ViewerId` type constructible **only** from the `Actor` resolved at the tRPC context
  boundary (ADR-0008 rule 8). Visibility functions and query classes accept `ViewerId`, not `string`.
- **B14 — provenance fitness:** no tRPC input schema anywhere contains a `viewerId` / `userId` /
  `actorId` / `ownerId` field on a query or mutation procedure; assert by walking the router type tree
  or by AST scan, not by grep.

### 🔴 D3 — The RLS backstop can die silently, and B1–B12 all still pass.

Decision §4 specifies "one named policy per table, `TO app_rw USING (true)`". B3 asserts only
`relrowsecurity = true` and `app_rw.rolbypassrls = false`. Every one of the following regressions leaves
B1–B12 green while removing the backstop entirely:

1. **`TO` omitted.** `CREATE POLICY p ON app.bulletins USING (true);` defaults to `TO PUBLIC`. RLS is
   still enabled, `app_rw` still works, B3 passes, B1 passes (because *grants* are still revoked) — and
   the RLS layer now permits every role in the cluster. The one control the ADR added is gone and no
   test notices.
2. **Ownership drift.** A table created by `postgres` (dashboard action, hotfix, a Supabase-managed
   extension object) is owned by a role that **bypasses RLS by default**. `relrowsecurity` is still true.
   The ADR never states `ALTER TABLE … FORCE ROW LEVEL SECURITY`, and B3 never asserts `relowner`.
3. **`FOR SELECT`-only policy.** The ADR writes `TO app_rw USING (true)` without a `FOR` clause. A
   reviewer copying the pattern as `FOR SELECT` breaks all writes — and the predictable field fix under
   deploy pressure is `GRANT`/`BYPASSRLS`, i.e. drift toward permissive. (Note: `FOR ALL … USING (true)`
   with no `WITH CHECK` does cover INSERT/UPDATE, because Postgres reuses `USING` as `WITH CHECK` for
   `ALL` policies. The ADR should say `FOR ALL` explicitly rather than leave it to be discovered.)
4. **Policy omitted on a new table.** RLS on, no policy → reads return **zero rows silently**, not an
   error. A privacy-config bug presents as "the board is empty", ships as a product bug, and is debugged
   for a day. This is the chosen shape's nastiest operational property and the ADR does not name it.

**Required — B3 must become a full policy-shape assertion**, for every table in `app`:
`relrowsecurity = true` **and** `relforcerowsecurity = true` **and** `relowner = app_migrator` **and**
exactly one row in `pg_policies` with `policyname = 'app_rw_full_access'`, `permissive = 'PERMISSIVE'`,
`roles = {app_rw}`, `cmd = 'ALL'`, `qual = 'true'`, `with_check IS NULL OR 'true'`. Also assert
`app_rw` has no row in `pg_auth_members` (cannot `SET ROLE` to anything) and that no
`service_role`/`postgres` credential is present in the deployed runtime's environment.

### 🔴 D4 — The entire B-suite runs against Testcontainers. It validates the migrations, not production.

B1–B12 run "in CI against a real Postgres (Testcontainers) with production migrations applied". That
proves the migration files are correct. It proves nothing about:

- **Which role the deployed API actually connects as.** ADR-0001 S3 tests "pooled connectivity" through
  Supavisor but never asserts `current_user`. Supavisor's tenant-username convention
  (`<role>.<project-ref>`) and Supabase's support for *custom* roles through the pooler is exactly the
  kind of thing that fails at M4 and gets "temporarily" resolved by connecting as `postgres` — which is
  a superuser-ish owner, silently defeating decisions 2 and 4 and every catalog assertion in B3, because
  B3 never runs against that database.
- **Drift between `supabase/migrations/` and the live project.** Supabase projects change out-of-band
  (dashboard, extensions, support actions). The plan's M1-AC3 checks *Kysely type* drift, not
  *privilege* drift.

**Required:**
- Add an ADR-0001 spike criterion (or an S3 sub-criterion): from the **deployed** Worker/Node process
  through Supavisor, assert `current_user = 'app_rw'`, `rolbypassrls = false`, `rolsuper = false`,
  `session_user = current_user`.
- Make the B1/B3/B4 catalog assertions runnable as a **post-deploy smoke against the real database**,
  gating the M4.5 rollout — not only as a Testcontainers test.

### 🟡 D5 — There is no authorization model for operator/privileged reads, and the first one will break the ADR.

PDF §5: *"Operator review may inspect the reported bulletin and relevant metadata… The operator may
remove content, restrict bulletin creation, suspend an account, or disable an account."* Plan M5-AC9 and
Escalation D3 commit to an operator console. ADR-0002 does not contain the word "operator".

An operator read is, by definition, a read that **must** bypass viewer visibility. With `app_rw` as the
only role and `USING (true)` as the only policy, the operator console has nothing to bind to, and the
two paths a developer will actually take are (a) a `SECURITY DEFINER` function — which B4 forbids without
an allowlist entry, so the allowlist becomes the operator API by accident — or (b) `service_role` /
`postgres`, which detonates the whole model. PDF §8's own rule ("do not assume a shared privileged
database credential magically carries the user's context") applies to operators too.

**Required:** ADR-0002 must state the operator model, even if v1's answer is minimal. Suggested shape:
a distinct `app_operator_ro` role with `SELECT` only on the moderation-relevant tables, a separate
entrypoint, mandatory audit-entry-per-read (not only per-action), and an explicit statement that
operator reads are the *one* sanctioned bypass of viewer visibility and are logged as such. Add
**B15 — operator scope**: the operator path cannot read trust values, cannot read reporter identity in
any surface shown to a reported user, cannot write product state outside the enumerated operator
actions, and every operator read emits an audit entry.

### 🟡 D6 — Storage objects are a second authorization surface the ADR does not cover.

PDF §6: *"User-upload storage buckets remain private and authorization-protected."* ADR-0008 stores
`avatar_path` as "a private storage bucket key; never a public URL". `storage.objects` lives in the
`storage` schema, is governed by Supabase's own RLS, and is **entirely outside** decisions 1–4: schema
`app` is not exposed to PostgREST, but the Storage API is a separate service with a separate policy set.

Unanswered, and each is a real leak:
- Who mints signed URLs, and is minting gated by the *same* disclosure rule that decides
  `full` vs `topology_only` (ADR-0004 §3)? A board response that eagerly signs every author avatar hands
  out a bearer capability for people the viewer may only see as topology.
- A signed URL is a capability that **outlives the authorization check** and is shareable. What is the
  TTL? PDF §5 requires a block to end "contact exposure" and requires cached data invalidation — a
  signed URL issued at 13:59 and valid for 1 hour survives a 14:00 block. ADR-0008's erasure deletes the
  avatar object, which helps for erasure but not for blocking.

**Required:** ADR-0002 must claim jurisdiction over `storage.objects` (state the bucket policy: deny-all
to `anon`/`authenticated`, access only via server-minted short-TTL signed URLs), state a maximum TTL,
state that minting goes through the same disclosure predicate, and add **B16 — storage**: direct bucket
access as `anon`/`authenticated` is denied; a signed URL is only ever minted for an object the viewer is
authorised to see; TTL ≤ the stated bound.

### 🟡 D7 — B8 tests the field list. The disclosure it fails to test is structural.

ADR-0004's ghost design is careful about *attributes* (surrogate ID, no name/handle/avatar/role/mutual
count) and B8 asserts exactly that. But the payload's actual content for a Private node is **adjacency**,
and adjacency is identifying. A ghost connected to precisely {Moss, Juniper, Rae} — three people the
viewer can see — is uniquely determined by structure alone to anyone with ordinary social knowledge of
that camp. This is standard social-graph re-identification, not a theoretical concern, and it is exactly
what PDF §4's *"Hidden information must never be sent to the client merely to be concealed by the UI"*
is aimed at. The surrogate ID makes the ghost non-*correlatable across viewers*; it does nothing about
re-identification *within* one viewer's own view.

Two adjacent, smaller structural channels:
- **`path_via` (first-hop connector name).** Note this field is an ADR-0004 invention — the handoff PDF
  contains no "path_via"/connector concept. It discloses a *third party's* connection, gated on
  "when the viewer may see it", a predicate that is nowhere defined. Define it or drop the field.
- **`mutual_count`.** Polled over time, it leaks the existence and timing of connections the viewer
  cannot see, including connections involving people the viewer has blocked.
- **Block observability.** PDF §5: *"The blocked user is not explicitly notified."* After A blocks B,
  people who were reachable to B only via A vanish from B's graph. B7 asserts "no A rows"; it does not
  consider that the *change* is itself the notification. This may be unavoidable, but it should be a
  named accepted residual, not an unexamined one.

**Required:** ADR-0002 (or ADR-0004, cross-referenced here) must make a *decision* about ghost adjacency
— full adjacency, adjacency restricted to edges incident to people the viewer can see fully, or degree
only — and record structural re-identification as an accepted, quantified residual risk. Extend B8 with
a re-identification case: a fixture graph where a ghost's neighbour set uniquely determines it, and an
assertion matching whichever rule the ADR chooses.

### 🟡 D8 — Author disclosure and bulletin visibility are two predicates whose interaction is undefined.

Decision §6 says visibility composes from one place, but there are **two** authorized sets: the
authorized-**bulletin** set and the authorized-**person** set, and ADR-0004 §3 makes person disclosure
depend on the *target's own* settings ("name visible to: anyone / trust 50+ / trust 75+") while bulletin
visibility depends on the *author's audience* plus reachability.

The intersection is a live leak: a bulletin visible to the viewer at degree 3, authored by someone whose
name is only visible at trust ≥ 75. Does the board render the author's name? If the bulletin payload
carries an author object built from the bulletin query rather than from `visible_people`, the answer is
yes and the disclosure rule is bypassed through the board — the §15 "second subtly different predicate"
failure, arriving through composition rather than duplication.

**Required:** ADR-0002 must state the rule explicitly (proposal: *every* person representation in *every*
payload is projected through `app.visible_people`'s `disclosure` level, with no exceptions — a bulletin
author rendered below `full` shows as a Private author) and add a B5 sub-case asserting it on the board,
search results, notifications, and intro flows.

### 🟡 D9 — Cached client data is hidden data concealed by the client. The design accepts this without bounding it.

ADR-0005: caches are purged of blocked and erased subjects "on sync, before rendering". PDF §5 says
cached and offline data "must be invalidated on synchronization". Both make revocation contingent on the
device syncing. A device that never syncs again renders the blocked person's board and graph forever,
and B7's clause "previously cached data is invalidated on next sync" bakes that in as the standard.

This is the closest the design comes to violating §15's *"never return hidden data and rely on the
frontend to conceal it"* — not for fresh reads, but for the entire offline corpus.

**Required:** state a maximum cache staleness (e.g. cached graph/board older than N hours renders in a
degraded/"stale" state and cached *person* detail is not rendered at all until re-sync), and extend B7
to assert the offline-only case: block applied server-side, client never syncs, client must not present
the blocked party's content after the staleness bound.

### 🟠 D10 — Existence oracles: the design has no rule that unauthorised and non-existent are indistinguishable.

Visibility is the product, so "does this exist" is itself protected information. The design currently
leaks it in several places by construction:

- **403 vs 404.** Nothing states that an unauthorised `bulletin.get(id)` must be indistinguishable from a
  non-existent one. B10 asserts 0 rows for filters but says nothing about single-entity fetches or about
  *error shape*.
- **Handle availability at onboarding.** ADR-0008's `citext unique` handle means the sign-up flow answers
  "is `moss` taken?" — one bit of people search in a product where PDF §3 excludes public people search
  and §4 says "There is no people search". This is a genuine, cheap-to-exploit enumeration channel and no
  document addresses it.
- **`from:` resolution (ADR-0007).** "resolved only against authors already in the viewer's authorized
  set" is correct **if** implemented filter-then-resolve. Resolve-then-filter (the natural
  implementation) is people search with a 0-rows-vs-error tell. ADR-0007's own rule that unknown tokens
  are "rejected with a structured validation error naming the offending token" pushes toward the wrong
  one: an unresolvable `from:` must return 0 rows, never a validation error.
- **`IDEMPOTENCY_KEY_REUSE` (ADR-0005).** Mutation IDs are namespaced by `actor_id`, so this is handled —
  worth keeping, and worth an explicit B-case.

**Required:** add a stated invariant — *unauthorised and non-existent are indistinguishable in status
code, error code, response body, and (within a stated band) latency* — and **B17** asserting it across
single-entity fetch, `from:` resolution, intro-connector resolution, and report/dismiss of an invisible
bulletin. Escalate handle-availability as a product decision (PDF §10 escalation threshold: it changes
the privacy promise).

### 🟠 D11 — Notification delivery re-checks authorization at compute time, not at send time.

PDF §5 requires a block to stop "notification delivery". ADR-0006 has grouping windows and a 1-minute
cron; ADR-0005's precedence rules govern *mutations*. The gap: A blocks B at 14:00:00; the grouped-push
flush at 14:00:05 was computed at 13:59:50. B7's "no directed request or notification is deliverable"
does not say *when* deliverability is evaluated.

Related and unspecified anywhere (PDF is silent, per the handoff sweep): **push payload content**. A
payload rendered on a lock screen is data leaving the authorization boundary onto an unlocked-device
surface. ADR-0006 correctly keeps content out of *queue* payloads; nothing keeps it out of the *push*
payload.

**Required:** state that recipient authorization (block, erasure, revoked visibility, deactivation) is
re-evaluated in the send handler immediately before dispatch, inside the same transaction as the
consumer receipt; state a push-payload content rule (identifiers + a generic string, content fetched by
the client after authentication); extend B7 with the flush-boundary case.

### 🟠 D12 — Grant/privilege details that will produce a deploy-time failure and a permissive "fix".

The migration described in decision 2–4 is under-specified in ways that reliably break the first deploy:

- **Sequences.** Any `bigserial`/identity column needs `GRANT USAGE, SELECT ON SEQUENCE` to `app_rw`, and
  `ALTER DEFAULT PRIVILEGES … FOR ROLE app_migrator … ON SEQUENCES`. Not mentioned. Failure mode: inserts
  fail in staging, someone grants `ALL`.
- **Functions.** Postgres grants `EXECUTE` on functions to `PUBLIC` **by default**. Decision 3's
  `REVOKE ALL … from PUBLIC` must explicitly cover functions *and* set default privileges for future
  functions, or every new `app.visible_*` function is world-executable on creation. This is the one place
  where "REVOKE from PUBLIC" is doing real work and it is the one the phrasing glosses.
- **`ALTER DEFAULT PRIVILEGES` is per-creating-role.** It must be declared `FOR ROLE app_migrator`. If
  anything else ever creates an object in `app`, the defaults do not apply — which is the same hole as
  D3.2 and should be caught by the same assertion.
- **`search_path`.** Under a transaction-mode pooler, session-level `SET search_path` is not reliably
  yours. Every object reference must be schema-qualified (`app.bulletins`), and every `SECURITY INVOKER`
  function in `app` should carry `SET search_path = ''` so a caller cannot change its meaning. If a
  `public.bulletins` ever exists, unqualified names become a silent cross-table read.
- **`app.uid()`-style helper.** ADR-0004's `:graph_surrogate_key` — how does it reach the SQL? If via
  `current_setting('app.graph_surrogate_key')` set as a *session* GUC, that is precisely the pooler
  fragility ADR-0002 rejects in its own alternatives table. Specify: bound query parameter, or a
  role-level `ALTER ROLE app_rw SET`, never a per-request `SET`.

### 🟠 D13 — B12's fitness function does not detect the failure §15 actually names.

"No SQL string outside `persistence/` and `supabase/`" is a grep against SQL-shaped strings — noisy
against Kysely's `sql` tag and template literals, and orthogonal to the real hazard. §15's named failure
is *"do not duplicate subtly different visibility logic across routers"*, and the modern form of that is
**TypeScript**, not SQL: a `.filter(b => b.authorId === ctx.actor.userId)` in a router, or a second
`WHERE viewer_id = …` in a query class that does not compose the CTE.

**Required:** strengthen B12 into a composition assertion — every query implementation that takes a
`ViewerId` must reference `app.visible_people` / `app.visible_bulletins` (or the shared CTE builder);
a query taking a `ViewerId` and not composing the authorized set fails the build. Pair it with D2's B14.

### ⚪ D14 — Open questions the ADR should answer or explicitly defer

1. **Data export / GDPR subject access.** Absent from the PDF and from every ADR. If it is ever built,
   it collides head-on with B6: is "A's trust in B" part of *B's* personal data? ADR-0008 deletes
   others' trust in an erased user, implying it is B's data — which would make it exportable to B, which
   B6 forbids. Name the rule now, even as "export is out of scope for v1 and requires a new ADR".
2. **`SECURITY DEFINER` allowlist governance.** B4 requires an allowlist file with justification.
   Who approves additions? Add: allowlisted definers must also carry `SET search_path` and be covered by
   an explicit test, and the allowlist file requires a CODEOWNERS review.
3. **Telemetry/tracing.** PDF §6 forbids sensitive content in "logs, analytics, queue payloads, or
   exception traces"; OpenTelemetry is a baseline tool. Nothing forbids a span attribute carrying a
   `viewerId`+`ghost_id` pair, or a bulletin body in an error trace. Worth one line in §25's DoD and a
   B-case over a captured trace.
4. **Audit scope.** Addendum §16 and the PDF name `audit` as a first-class module but never enumerate
   audited events. Blocking, report resolution, erasure execution, and operator reads (D5) are the
   privacy-relevant ones.
5. **`app_migrator` credential handling.** It owns every table. Where does it live, who can run it, and
   is there a break-glass path? A leaked migrator credential bypasses RLS entirely absent `FORCE`.

---

## 4. Adversarial scenarios

**S1 — M4, staging, the Friday deploy.** Migrations apply cleanly as `app_migrator`. The API starts and
every read returns empty. Twenty minutes of debugging later, someone discovers the Supavisor connection
string with a custom role needs the `app_rw.<project-ref>` tenant form and it is not working; the
fastest thing that connects is the `postgres` service credential already in the Supabase dashboard. The
deploy goes green. `postgres` owns nothing in `app` but is superuser: `BYPASSRLS` is implicit, decision 4
is inert, decision 2 is inert. B1–B12 stay green forever because they run in Testcontainers against a
correctly-provisioned database. Nothing in the system ever notices. *Closed by D4.*

**S2 — M5, the reported-bulletin flow.** A developer builds the operator console. The console must read
bulletins across all viewers, so `app.visible_bulletins(viewer_id)` cannot serve it. They add
`app.operator_bulletin_detail(bulletin_id)` as `SECURITY DEFINER`, add one line to the B4 allowlist with
the justification "operator console needs cross-viewer read", and the build goes green — B4 is satisfied
by construction, because the allowlist is the escape hatch. Six months later there are four such
functions, one of them takes a `WHERE` fragment, and the operator path is the widest read surface in the
system with no audit trail and no test asserting it cannot see trust values. *Closed by D5.*

**S3 — the ghost that isn't.** Rae opens her graph. Degree 3 contains a Private node with a stable
surrogate ID, adjacent to Moss, Juniper, and Kestrel — three people she can see fully. There is exactly
one person at that camp connected to all three, and Rae knows who. She now knows that person is on the
platform, at degree 3, and (from `mutual_count` deltas polled across a week) that they connected to
Juniper on Tuesday. B8 passes on every assertion it makes: no name, no handle, no avatar, no role, no
real ID in the payload. The disclosure rule that decided this person should be topology-only has been
defeated without a single forbidden field being sent. *Closed by D7.*

**S4 — the two-predicate board leak.** A bulletin is authored by someone whose identity visibility is set
to "trust 75+". Rae is at degree 3 with no trust set, but the bulletin's audience is "degree ≤ 3", so it
is in her authorized-bulletin set. The board query joins `app.users` for the author card because that is
the obvious way to render a board row. Rae sees the author's display name and avatar. Both CTEs are
correct in isolation; the composition is the leak. B5 passes — Rae *is* authorized for that bulletin.
*Closed by D8.*

**S5 — the trust write.** A user calls `sync.submitMutations` with a `trust.set` envelope whose payload
names a `connectionId` between two other people, and a wrong `expectedVersion`. The handler resolves the
connection, compares versions, and returns `conflict` with `currentVersion` and `currentState` per
ADR-0005 — leaking a third party's private directional trust value through the *conflict envelope*,
which B6 does not inspect because B6 asserts on read payloads. *Closed by D1 + a B6 extension covering
error and conflict envelopes, not just success payloads.*

---

## 5. Required ADR edits (the actionable list)

**Decision section:**

1. §4: specify the policy verbatim and completely —
   `CREATE POLICY app_rw_full_access ON app.<t> AS PERMISSIVE FOR ALL TO app_rw USING (true) WITH CHECK (true);`
   plus `ALTER TABLE app.<t> ENABLE ROW LEVEL SECURITY; ALTER TABLE app.<t> FORCE ROW LEVEL SECURITY;`
   and state that all tables in `app` are owned by `app_migrator`.
2. §3: state explicitly that the revoke covers **functions** (Postgres grants `EXECUTE` to `PUBLIC` by
   default), **sequences**, and **types**, and that `ALTER DEFAULT PRIVILEGES` is declared
   `FOR ROLE app_migrator`.
3. New §5a: **`viewer_id` provenance** — branded `ViewerId`, constructible only from the resolved
   `Actor`; no procedure input schema may carry a viewer/owner/actor identifier.
4. New §6a: **one person-projection rule** — every person representation in every payload passes through
   `app.visible_people`'s disclosure level; a sub-`full` author renders as a Private author.
5. New §8: **operator/privileged reads** — a separate least-privileged role and entrypoint, audit entry
   per read, stated as the single sanctioned bypass of viewer visibility.
6. New §9: **storage** — `storage.objects` is in scope; deny-all to `anon`/`authenticated`; server-minted
   signed URLs only, gated by the same disclosure predicate, TTL bound stated.
7. New §10: **indistinguishability** — unauthorised and non-existent produce identical responses.
8. New §11: **delivery-time re-check** — notification/push recipient authorization is re-evaluated in the
   send handler, in the receipt transaction; push payloads carry identifiers only.
9. Amend §5: schema-qualify all object references; `SET search_path = ''` on functions in `app`; state
   that `graph_surrogate_key` reaches SQL as a bound parameter or role-level GUC, never a session `SET`.

**Bypass-test plan:**

10. **B3 →** full policy-shape + ownership + `FORCE` + `pg_auth_members` + no `service_role` credential
    in the runtime env.
11. **B6 →** extend to error and conflict envelopes, not only success payloads.
12. **B7 →** add the grouped-push flush boundary and the never-syncs-again offline case.
13. **B8 →** add a structural re-identification case matching whichever adjacency rule §7 chooses.
14. **B12 →** replace the SQL-string grep with a composition assertion (viewer-scoped query ⇒ composes
    the authorized-set CTE).
15. **New B13** write-path IDOR matrix, one row per ADR-0005 mutation type (zero state change **and**
    zero outbox rows).
16. **New B14** `viewerId` provenance fitness.
17. **New B15** operator scope.
18. **New B16** storage / signed URL.
19. **New B17** existence-oracle indistinguishability.
20. **New B18** the B1/B3/B4 catalog assertions run as a **post-deploy smoke against the live database**
    through the production connection path, gating rollout (plan M4.5).

**Cross-ADR:**

21. ADR-0001: add "the deployed process's `current_user` is `app_rw` with `rolbypassrls = false`" as an
    S3 sub-criterion with a captured observation.
22. ADR-0004: decide and record the ghost-adjacency rule and the `path_via` visibility predicate (or drop
    `path_via` — it is not sourced from the handoff).
23. ADR-0005: state the actorship invariant (every ID in a payload is verified against the actor) as a
    pre-handler precedence rule alongside erasure/block/revocation.
24. ADR-0007: `from:` must be filter-then-resolve and return 0 rows, never a validation error, for an
    unresolvable author.
25. Addendum §25 DoD: a new mutation type adds an ADR-0005 conflict row **and** a B13 row; a new
    viewer-scoped query adds a B5 row.
26. Consequences: add the honest one — *a table with RLS enabled and no policy returns zero rows
    silently, so a privacy-config error presents as a product bug.*

**Escalations (PDF §10 threshold — these change the privacy promise, so the product owner decides):**

- E1: does a Private node disclose full adjacency? (D7)
- E2: is handle availability at onboarding an acceptable people-existence oracle? (D10)
- E3: what is the maximum staleness at which cached graph/board data may still be rendered? (D9)

---

## 6. Verdict

**sound-with-changes.**

The core decision — application-layer authorization as the mechanism, database privileges as a blast
door, no ambient session identity — is right, is right for the stated reasons, and correctly reads the
pooler risk that the obvious alternative would have walked into. It should not be reopened.

What is not yet sound is the *coverage* claim. The ADR presents B1–B12 as the compensating control for
giving up database-enforced visibility, and B1–B12 covers reads by authorised-but-unrelated viewers
while leaving unexamined: every write path, the provenance of `viewer_id`, the shape of the policy that
is the entire backstop, the production connection the tests never touch, operator reads, storage
objects, push payloads, structural disclosure, and the client-side cache. Several of those are cheap to
close now and expensive to close after M2 ships thirteen tables.

The ADR should stay `proposed` until edits 1–9 and 21–26 land, and the `accepted` bar in Verification
should read **B1–B18** rather than B1–B12.
