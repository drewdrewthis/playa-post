# Playa Post — Implementation Plan (empty repo → live)

> **Status:** proposed, 2026-07-30. **Revised 2026-07-30** to integrate three inputs:
> `docs/product/launch-definition-of-done.md` (**owner-stated and normative** — defines what "done"
> means and terminates M6), `docs/engineering/reviews/2026-07-30-ac-review.md` (verdict: NOT READY as a
> contract — gaps G1–G13, 11 sharpness fixes, 11 improvements), and
> `docs/engineering/reviews/2026-07-30-adr-0002-stress-test.md` (verdict: sound-with-changes — the
> security bypass suite grows from B1–B12 to **B1–B18**).
> Governed by `docs/engineering/architecture-addendum.md` (normative), then
> `docs/Burner_Trust_Network_Final_Handoff.pdf`, then `docs/product/decisions.md`.
> ADRs live in `docs/adr/`. New here? Read `docs/engineering/repo-map.md` first.

## Goal

Deliver Playa Post v1 — a private trust-graph PWA with typed bulletins — from an empty repository to a
**live production deployment meeting every clause of `docs/product/launch-definition-of-done.md`**, by
proving one production vertical slice end to end before building feature breadth.

## Definition of done for v1

`docs/product/launch-definition-of-done.md` is owner-stated and normative. v1 is done only when all six
clauses hold, **verified rather than asserted**, with an independent user-perspective QA sign-off before
"live" is claimed:

1. **Live** — deployed and reachable at a real production URL.
2. **Working, not mocked** — every feature runs against the real backend; no mock layers, stub data
   services, or disabled code paths in the deployed app.
3. **Real data** — honest seed users, connections, and bulletins so the product is immediately
   experienceable; seeds must not hide broken paths.
4. **Tested from the user's perspective** — browser-driven walkthroughs of the real deployed app with
   captured evidence.
5. **Visually correct** — the deployed UI matches `design/Playa Post.dc.html`, compared against the
   prototype rather than merely "renders without errors".
6. **Feature complete** — the whole PDF §3 "Included" list as modified by `docs/product/decisions.md`.

M6 exists to satisfy exactly this, and M6-AC10 through M6-AC15 are the clause-by-clause gates.
Per-feature engineering DoD remains addendum §25 plus the repo-specific additions in
`docs/engineering/repo-map.md`.

## Non-goals

- Any v1-excluded feature (PDF §3): native messaging or comments, likes/ratings/public reputation,
  payments, public people search, groups, native mobile apps, user-facing analytics, E2EE,
  automatic community-wide punishment.
- Private notes / `type:note` — cut by decision D2.
- Multiple notifying saved queries — cut by decision D1 (exactly one Notify Me).
- Microservices, event sourcing, a custom command bus, or a custom query framework (addendum §8, §18).
- Horizontal build-out of all modules before the M2 slice works (PDF §9, addendum §23).
- Performance projections, caches, or materialized views before measurement demands them (ADR-0004).

## Shape of the plan

| Milestone | Outcome | Exit signal |
|---|---|---|
| **M1** | Scaffold: workspace, boundaries, tests, CI, local Supabase, security baseline | CI green on an empty-but-enforced skeleton; boundary and privilege violations fail the build |
| **M2** | The addendum §23 vertical slice, working locally | The full slice passes as one e2e test against a real database |
| **M3** | Runtime spike → ADR-0001 decided | GO/NO-GO recorded with evidence for all 11 criteria (S1–S3a, S4–S10) |
| **M4** | Staging live + observability baseline | The M2 slice passes against deployed staging; B18 gates rollout |
| **M5** | v1 breadth | The §21 scenario matrix is green; PDF §3 scope complete |
| **M6** | **Production live, QA-signed-off** | All six launch-DoD clauses verified; independent QA sign-off recorded |

M1 → M2 → M3 are sequential. M3's spike may start during M2 (it needs no product code) but must not
gate M2. M5 work items parallelize once M4 lands. **M6 cannot start until M5 groups D (moderation) and
E (privacy/erasure) are green** — that gate is mechanical, not a judgment call (M6-AC3).

### Three standing rules introduced by the reviews

1. **Every M5/M6 work item carries at least one AC before the item is started.** The first draft put
   48 % of its ACs on 15 % of the scope; the fix is a rule, not a longer list.
2. **The B-suite is critical infrastructure, not tests.** ADR-0002 gives up database-enforced viewer
   visibility, so B1–B18 *is* the compensating control. A B-row is never deferred silently —
   `tests/security/b-rows.manifest.json` declares all eighteen, and a row that is neither implemented
   nor explicitly marked with a target milestone fails the job (M1-AC8).
3. **QA is an independent gate, not a self-report.** The launch-DoD's QA pass is performed by someone
   who did not implement the work, and its sign-off is an artifact (M6-AC15).

---

## M1 — Scaffold

**Entry criteria:** repository exists with `docs/` and `design/`.

**Goal:** a repository where the architecture and privilege rules of the addendum and ADR-0002 are
*executable* — a violation fails CI rather than a review. Nothing product-facing ships in M1; what ships
is the ability to detect drift.

### Work items (one PR each)

| # | Work item | Shape |
|---|---|---|
| M1.1 | pnpm workspace skeleton | `pnpm-workspace.yaml`, root `package.json`, `tsconfig.base.json` (strict, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`), the `apps/*` and `packages/*` directories per addendum §3. Empty modules are *not* created (§4). |
| M1.2 | Boundary enforcement | ESLint flat config + `dependency-cruiser`, with deliberately-violating fixtures under `tests/fitness/__fixtures__/` and a test asserting each is flagged by rule name. `pnpm boundaries`. Five rules live at M1a; two deferred to M1b.9 — see M1-AC2. |
| M1.3 | Test harness | Vitest workspace with `unit` and `integration` projects; `packages/testing` exports a Testcontainers Postgres harness that applies `supabase/migrations` **by default** and exposes `truncateAllTables()` for between-test reset. Unit tests must run without Docker. |
| M1.4 | Local Supabase + migration flow | `supabase/config.toml`, `migrations/`, `seed/`, `sql/`; `pnpm db:start|db:reset|db:migrate|db:types` (Kysely types generated from the live schema, checked in). |
| M1.5 | Security baseline migration | Schema `app`; roles `app_rw` (`NOSUPERUSER NOBYPASSRLS NOINHERIT`, member of nothing) and `app_migrator` (owner); the full ADR-0002 §3 revoke set **including functions, sequences, types and `ALTER DEFAULT PRIVILEGES FOR ROLE app_migrator`**; and the §4 verbatim policy shape (`ENABLE` + `FORCE` + `app_rw_full_access AS PERMISSIVE FOR ALL TO app_rw USING (true) WITH CHECK (true)` + `COMMENT ON POLICY`). A canary table exists from the baseline so assertions are non-vacuous. |
| M1.6 | Security fitness suite + B-row manifest | `tests/security/` with **B1, B2, B3, B4** and B12's secondary rule implemented, and `b-rows.manifest.json` declaring all eighteen rows as `implemented` or `pending: <milestone>`. |
| M1.7 | CI | GitHub Actions, ten named jobs (below). Required on `main`. Both server builds from day one (ADR-0001 rule 2). |
| M1.8 | Config + observability packages | `packages/configuration`: Zod-validated env, fails fast naming the missing key. `packages/observability`: structured logger with a **redaction allowlist**, correlation IDs, and trace-attribute redaction (ADR-0002 Q3). |
| M1.9 | Repo conventions | `CLAUDE.md`, PR template with an AC + evidence section and a boundary checkbox, `.env.example`, secret-scanning hook mirroring the CI job. |
| M1.10 | AC traceability index | `docs/engineering/ac-index.md`, regenerated by CI: every AC ID → the CI job or manual procedure that proves it → the work item it belongs to. This artifact is what makes M5-AC39 and the B-row gate provable. |

**The ten CI jobs, named:** `typecheck`, `lint`, `lint:boundaries`, `test:unit`, `test:integration`,
`test:security`, `build:web`, `build:server:cloudflare`, `build:server:node`, `secret-scan`.

> **Job name vs script name.** The CI *job* is `lint:boundaries`; the *script* it runs is
> `pnpm boundaries`. There is deliberately only one script name — an alias pair is two things to
> keep in sync and eventually one of them rots. Ratified in M1a.

### M1a / M1b — the split, and why

M1 was scoped as ten work items in one milestone. M1a shipped roughly half of them
([PR #2](https://github.com/drewdrewthis/playa-post/pull/2)); the rest are M1b. Recording the split
rather than quietly carrying it, because the M1b items are **not** optional polish — several of them
are the gate that makes an M2 feature safe to write at all, and merging M2 code past an unbuilt gate is
how a "we'll add the security suite later" milestone becomes permanent.

**M1a — executable skeleton (delivered, PR #2):**

| Item | What landed | What did not |
|---|---|---|
| M1.1 | pnpm workspace, strict `tsconfig.base.json` including `exactOptionalPropertyTypes` | — |
| M1.2 | Five boundary rules + one violating fixture each + fitness test | Two literal-content rules — see M1-AC2 |
| M1.3 | Vitest `unit`/`integration` projects; Testcontainers Postgres 16 harness applying `supabase/migrations` by default and exposing `truncateAllTables()` | — |
| M1.4 | `supabase/config.toml` (with `app` deliberately unexposed), `migrations/` + workflow README | `seed/`, `sql/`, the `db:*` scripts, checked-in Kysely types |
| M1.7 | GitHub Actions: install, typecheck, lint, boundaries, `build:web`, `build:server:node`, `build:server:cloudflare`, unit, integration | `test:security`, `secret-scan`, the ten *named* jobs, branch protection |
| M1.8 | `packages/configuration` (Zod, fails fast naming the key, never echoing values) | `packages/observability` |
| M1.9 | `CLAUDE.md` | PR template, `.env.example`, secret-scan hook |

**M1b — enforcement completion. Each row must merge before the M2 work in its gate column:**

| # | Item | Gate — must land before |
|---|---|---|
| M1b.1 | M1.4 remainder: `db:start\|db:reset\|db:migrate\|db:types`, `seed/`, `sql/`, checked-in Kysely types | any M2 repository or migration |
| M1b.2 | M1.5 security-baseline migration: schema `app`, `app_rw`/`app_migrator`, the full ADR-0002 §3 revoke set and §4 policy shape, canary table | M2's **first product table** |
| M1b.3 | M1.6 `tests/security/` B1–B4 + B12 secondary + `b-rows.manifest.json` | M2's **first viewer-scoped query** |
| M1b.4 | M1.8 remainder: `packages/observability` — redaction allowlist, correlation IDs, span-attribute redaction | M2 logging anything request-shaped |
| M1b.5 | M1.7 remainder: ten named CI jobs + branch protection ([#4](https://github.com/drewdrewthis/playa-post/issues/4)) | **any M2 merge** — this is the gate that makes every other row enforceable |
| M1b.6 | M1.9 remainder: PR template (AC + evidence + boundary checkbox), `.env.example`, secret-scan hook | M2's first PR |
| M1b.7 | M1-AC13 no-placeholder-layers fitness test ([#5](https://github.com/drewdrewthis/playa-post/issues/5)) | M2 creating `apps/server/src/modules/` — it is vacuous until then and load-bearing from then |
| M1b.8 | M1.10 `ac-index.md` regenerated by CI ([#6](https://github.com/drewdrewthis/playa-post/issues/6)) | M2 exit |
| M1b.9 | Boundary rules `no-container-outside-composition` and `no-sql-outside-persistence` | ships **in** the M2 PR that introduces the container (ADR-0003) and the first repository respectively |

M1b.5 is the load-bearing one. Until branch protection requires the named jobs, every other rule in
this document is advisory.

### Ratified toolchain constraint — TypeScript pinned to 6.0.3

`typescript` is pinned to **6.0.3**, not `latest` (7.0.2), and M1a's fitness test guards the pin.

TypeScript 7 is outside the supported range of **both** `dependency-cruiser` (`>=2.0.0 <7.0.0`) and
`typescript-eslint` (`>=4.8.4 <6.1.0`). The typescript-eslint break is loud. The dependency-cruiser one
**fails open**: on TS 7 it stops recognising `.ts` as a scannable extension, so `pnpm boundaries`
reports "no dependency violations found" over **zero modules** and exits 0 — the boundary gate appears
green while enforcing nothing.

Guard: `tests/fitness/boundaries.fitness.test.ts` asserts `totalCruised > 0` on the real tree, so the
zero-file failure mode fails CI instead of passing it. Do not raise the pin until both tools declare
support; when they do, the guard stays.

### Acceptance criteria

- **M1-AC1** `pnpm install && pnpm typecheck && pnpm lint && pnpm test:unit` exits 0 on a clean clone
  with no network beyond the npm registry. Separately, with **a running Docker daemon and no other
  setup**, `pnpm test:integration` exits 0 — the harness starts its own `postgres:16` container via
  Testcontainers and applies `supabase/migrations` itself, so there is no `db:start` prerequisite and no
  long-lived local database. *Evidence: two terminal transcripts, exit codes shown.*
  *(Amended in M1a: the original wording assumed a `pnpm db:start` step that the Testcontainers design
  makes unnecessary. `db:start` still ships in M1b.1 for local Supabase development — Auth, Storage,
  Studio — but integration tests must not depend on it, or they stop being runnable from a cold clone.)*
- **M1-AC2** Each **live** boundary rule is proven by its own fixture under
  `tests/fitness/__fixtures__/<rule-name>/`, and no fixture trips a rule other than its own.
  Live at M1a — the five addendum §19 minimums: `no-domain-to-infrastructure`,
  `no-application-to-transport`, `no-transport-to-persistence`, `no-web-to-server-internals`,
  `no-cross-module-persistence`. `pnpm boundaries` over the fixtures reports violations naming exactly
  those rules; over `apps/ packages/` it exits 0 having cruised a non-zero number of modules.
  *Evidence: both transcripts quoted, the rule names visible, module count visible.*
  *(Amended in M1a from seven to five. `no-container-outside-composition` and
  `no-sql-outside-persistence` are deferred to **M1b.9** — the first needs a DI container to point at
  and the second is a rule about SQL string literals rather than an import edge, so dependency-cruiser
  is the wrong tool for it. Both ship in the M2 PR that introduces the code they bind to. A rule
  configured against nothing is the empty abstraction addendum §4 forbids, and worse, it reports green
  forever. This deferral is tracked here, not only in `repo-map.md`.)*
- **M1-AC3** `pnpm db:reset` on a clean machine applies all migrations and exits 0; after `pnpm db:types`,
  `git diff --exit-code packages/database/src/schema.ts` exits 0. *Evidence: quoted commands with exit codes.*
- **M1-AC4 (B1)** Connecting as `anon` and as `authenticated` and selecting from every table in schema
  `app` raises SQLSTATE `42501`. The test **fails if the enumerated table count is 0**, so it cannot pass
  vacuously before M2's tables exist. Proven by granting `SELECT` to `authenticated` in a scratch
  migration. *Evidence: the failing run's assertion message, then the passing run naming each table.*
- **M1-AC5 (B3, full policy shape)** For every table in `app`: `relrowsecurity = true`,
  `relforcerowsecurity = true`, `relowner = app_migrator`, and exactly one `pg_policies` row with
  `policyname='app_rw_full_access'`, `permissive='PERMISSIVE'`, `roles={app_rw}`, `cmd='ALL'`,
  `qual='true'`, `with_check IS NULL OR 'true'`; plus `app_rw` has `rolsuper=false`,
  `rolbypassrls=false`, and no row in `pg_auth_members`. Proven by five scratch-migration regressions,
  each observed to fail: (a) no `FORCE`, (b) `TO` omitted, (c) `FOR SELECT` instead of `FOR ALL`,
  (d) table owned by `postgres`, (e) RLS enabled with no policy at all. *Evidence: five failing-run
  messages naming the offending table and clause, then the passing run.*
- **M1-AC6 (B2)** A request to the Supabase REST endpoint for **every** table in `app`, with a valid user
  JWT, returns 404 / `PGRST106`. Catalog-driven, so adding `app` to the exposed-schemas config fails.
  *Evidence: vitest output naming each table + one quoted `PGRST106` body + the failing run with `app` exposed.*
- **M1-AC7 (B4)** A catalog assertion over `pg_proc` for schema `app` fails if any `SECURITY DEFINER`
  function is absent from the checked-in allowlist, or is present but lacks `SET search_path`. Proven by
  adding one in a scratch migration. *Evidence: the failing run naming the function, then the passing run.*
- **M1-AC8 (B-row gate)** `pnpm test:security` reads `b-rows.manifest.json`, reports all **eighteen** row
  IDs with their state, and exits non-zero if any row is neither `implemented` nor carrying an explicit
  `pending: <milestone>` marker. Proven by deleting a row's entry. *Evidence: quoted runner output
  listing all eighteen IDs and states, plus the failing run.*
- **M1-AC9 (CI)** A PR runs all ten jobs by the names listed above; a PR with a deliberately failing
  `lint:boundaries` cannot be merged. Both server builds succeed. *Evidence: PR checks screenshot listing
  the ten job names + a screenshot of the blocked merge button.*
- **M1-AC10** Booting the server with a required env var absent exits non-zero within 2 s and prints the
  missing key's name and expected type, printing no value of any other secret. *Evidence: transcript with
  exit code.*
  *(M1a status: the mechanism exists and is proven for **malformed** values —
  `ConfigurationError` names the offending keys and omits their values, with a unit test asserting a
  password in a rejected `PORT` does not reach the message. It is **vacuous for absence** until a
  variable is actually required: M1a's schema has a safe default for every key, precisely because none
  of them is a secret yet. **First load-bearing at M2**, when `DATABASE_URL` becomes required — the AC
  is not satisfied by M1a alone.)*
- **M1-AC11** The logger drops non-allowlisted fields: `logger.info({ body: 'secret text', userId: 'u1' })`
  emits a line containing `u1` and not `secret text`. The same holds for OpenTelemetry span attributes
  (ADR-0002 Q3). *Evidence: quoted emitted JSON line + quoted exported span attributes.*
- **M1-AC12** A commit containing a secret-scanning pattern is rejected by the local hook **and** by the
  `secret-scan` CI job. *Evidence: quoted hook output on a deliberate local commit, plus the CI job's
  failing output on a throwaway branch pushed with `--no-verify` and then deleted.*
- **M1-AC13 (no placeholder layers, §4)** A fitness test fails if any directory under
  `apps/server/src/modules/` contains no file with a non-trivial export — files whose entire body is
  comments, `export {}`, or a re-export of nothing count as placeholders. Proven by adding one.
  *Evidence: the failing run naming the directory, then the passing run.* At M1 this passes trivially and
  is documented as first load-bearing at M2.
- **M1-AC14 (traceability)** `docs/engineering/ac-index.md` exists, is regenerated by a CI job, and maps
  every AC ID in this plan to a CI job name or `manual: <procedure>`. The job fails if any AC ID is
  unmapped. Proven by adding an AC. *Evidence: the failing run naming the unmapped AC, then the passing
  run, plus the generated index.*

**Done means (M1 as a whole, i.e. M1a + M1b):** a new agent can clone, run
`pnpm install && pnpm db:reset && pnpm test`, and get green; any of the seven boundary violations fails
the build; all five B3 privilege regressions are caught.

**M1a done means:** a new agent can clone, run `pnpm install && pnpm typecheck && pnpm lint &&
pnpm boundaries && pnpm build && pnpm test`, and get green with only Node 22 and Docker; each of the
five live boundary violations fails the build, proven by its fixture; and both server entrypoints
build. M1a explicitly does **not** satisfy M1-AC3 through M1-AC14 — those are M1b, gated per the table
above.

---

## M2 — First production vertical slice

**Entry criteria:** M1 exit signal met. ADR-0002 (revised), -0003, -0005, -0006, -0007, -0008 read.

**Goal:** implement addendum §23's flow **exactly**, and nothing beyond it:

```text
User signs in → creates or opens an invite → another user accepts
→ each user may assign private directional trust → graph renders the accepted connection
→ one user creates a Request bulletin → an eligible viewer sees it
→ Notify Me may produce a grouped notification → the viewer may dismiss or privately report it
→ the author archives it → one mutation is replayed successfully from offline state
```

### Modules required, and what is deliberately cut from each

| Module | In M2 | Cut to M5 |
|---|---|---|
| **identity** | Supabase magic-link sign-in; `app.users` per ADR-0008; onboarding (handle + display name) with the full handle rule set; actor resolution and the branded `ViewerId` at the tRPC context boundary | avatars, contact fields + per-field visibility, deactivation, erasure, suspension, reconciliation cron, export |
| **connections** | create invite (opaque revocable token), open invite, accept; `SetConnectionTrust` (private, directional, `unset` ≠ 0) | invite revocation UI, expiry policy, connection removal, introduction requests, blocking |
| **graph** | `app.visible_people` recursive CTE (ADR-0004) rendering the viewer + accepted 1st-degree connections; `disclosure` levels present and enforced by the §6a projection rule | ghost/topology-only nodes, degrees ≥ 2, `path_via`, truncation UI, clustering, perf gate |
| **bulletins** | `Request` type only: create, read via authorized board query, archive; lifecycle timestamps + `version` | the other six types, edit, expiry sweep, tags, location, URL detection |
| **views** | **no saved views.** A default board list + the ADR-0007 grammar restricted to `type:` and bare text; **one** Notify Me query (D1) | full grammar, saved views CRUD, notify-bell designation UI, sorts |
| **notifications** | Web Push subscribe; `EvaluateNotifyMeHandler` on `BulletinCreated`; one grouped push via a 60 s window; delivery-time authorization re-check + identifier-only payloads (ADR-0002 §11) | grouping across event families, cross-device dedup, subscription expiry, preferences, the query-change combined notification |
| **moderation** | private report of a bulletin → immediately hidden for the reporter; viewer-local dismissal | reason taxonomy, operator console + `app_operator_ro`, hide-author, blocking, withdrawal |
| **sync** | envelope + `mutation_results` + replay for exactly `bulletin.create`; the actorship precedence rule for every M2 mutation | full conflict matrix, `expired`, batching, `expectedVersion` paths, conflict UI |
| **audit** | `RecordAuditEntryHandler` consuming the slice's events | audit views, retention, operator search |
| **storage** | **not built** — nothing in the slice uploads a file | avatars, signed URLs, B16 |

**Frontend in M2:** sign-in, onboarding, graph home (1st degree), board list, compose Request, person
sheet with trust slider, report/dismiss, offline pending badge. Light theme only; no service worker yet.

### Work items (one PR each)

M2.1 migrations for the thirteen slice tables (each with the §4 policy shape) · M2.2 `packages/contracts`
+ tRPC skeleton + auth context → `Actor` → branded `ViewerId` · M2.3 composition root (ADR-0003) ·
M2.4 identity: onboarding + handle rules · M2.5 connections: invite create/open/accept ·
M2.6 connections: `SetConnectionTrust` · M2.7 graph: `visible-people.sql` + read model + §6a projection ·
M2.8 bulletins: create + archive · M2.9 views: grammar tokenizer/AST/compiler (restricted) ·
M2.10 views: Notify Me single query · M2.11 notifications: subscribe, evaluate, grouped send with
delivery-time re-check · M2.12 moderation: report + dismiss · M2.13 sync: envelope, idempotency,
actorship pre-handler, `bulletin.create` · M2.14 outbox drainer (Node poller) with backoff and
dead-lettering · M2.15 audit handler · M2.16 web: shell/sign-in/onboarding/graph · M2.17 web:
board/compose/person sheet · M2.18 web: Dexie + pending states · M2.19 security suite B5–B9, B13, B14,
B17 · M2.20 Playwright e2e for the slice.

### Acceptance criteria

- **M2-AC1 (slice, end to end)** A single Playwright run drives two browser contexts through the §23
  flow, structured as **eleven named `test.step()`s** matching the eleven flow lines, and passes. A
  skipped step is visible as a missing step in the report. *Evidence: Playwright HTML report showing
  eleven named steps, all passed, plus the terminal summary line.*
- **M2-AC2 (auth boundary)** No token → 401; tampered token → 401; valid token with incomplete
  onboarding → 403 `ONBOARDING_REQUIRED`. *Evidence: three `curl` transcripts.*
- **M2-AC3 (trust privacy, B6)** After A sets trust 85 on B, no payload reachable by B or a third party
  contains `85` in a trust field or a trust field at all — asserted on serialized JSON across graph read,
  board read, person sheet, sync response, **and error and conflict envelopes** (a `trust.set` conflict
  must not carry `currentState` for a connection the caller is not party to). *Evidence: vitest output
  naming the six surfaces + one quoted success body + one quoted conflict body.*
- **M2-AC4 (unset ≠ zero)** A connection with no trust assigned serializes as `trust: null`; a
  deliberately-set `0` serializes as `0`; the column is `NULL` vs `0`. *Evidence: two quoted API responses
  + one quoted `SELECT trust`.* (Filter disjointness moves to M5-AC17 with the full grammar.)
- **M2-AC5 (visibility, B5)** A third user with no relationship to A or B gets 0 rows from the graph
  query, 0 rows from the board query, and 404 on the bulletin by ID. **Person-projection sub-case
  (ADR-0002 §6a):** a bulletin that IS authorized for a viewer, whose author is below `full` disclosure,
  renders with no author name, handle, or avatar on the board, in search results, and in notifications.
  *Evidence: three quoted responses for the unrelated viewer + one quoted board row showing a Private author.*
- **M2-AC6 (transaction atomicity)** With a fault injected after the bulletin insert and before commit,
  `bulletins` and `outbox_events` both contain 0 new rows. *Evidence: two `SELECT count(*)` outputs.*
- **M2-AC7 (outbox → grouped push)** A matching Request bulletin produces exactly one delivery attempt
  within the window, recorded in `consumer_receipts`. **Window semantics:** the window opens at the first
  matching event; a second bulletin at t = 59 s joins that group (one notification total); one at
  t = 61 s produces a second notification. *Evidence: quoted `outbox_events` and `consumer_receipts` rows
  + the captured payloads for both boundary cases.*
- **M2-AC8 (consumer idempotency)** Delivering the same `BulletinCreated` twice produces one notification
  row and one receipt. *Evidence: quoted `SELECT count(*)` before/after.*
- **M2-AC9 (offline replay)** The same `bulletin.create` envelope twice produces exactly one bulletin;
  first `applied`, second `replayed` with an identical `result`. Same `mutationId` with a different
  payload → `rejected` / `IDEMPOTENCY_KEY_REUSE`. *Evidence: three quoted responses + `SELECT count(*) = 1`.*
- **M2-AC10 (report privacy, B9)** After V reports A's bulletin: absent from V's board immediately; still
  present for other eligible viewers; and no response reachable by A contains V's ID, handle, or display
  name across bulletin read, notifications, and A's own bulletin list. *Evidence: five quoted responses.*
- **M2-AC11 (dismissal is viewer-local)** V dismissing removes it from V's board and leaves it for every
  other eligible viewer. *Evidence: two quoted board responses.*
- **M2-AC12 (archive lifecycle)** After the author archives: absent from every non-author board, and
  `bulletins.getById` returns HTTP 404 with code `BULLETIN_GONE` for non-authors; the author's
  `bulletins.listMine` still returns it with `archivedAt` set. A second archive returns HTTP 200 and
  leaves `archivedAt` unchanged. *Evidence: quoted author and non-author responses before and after, plus
  the `archivedAt` value across both archive calls.*
- **M2-AC13 (grammar boundaries)** `type:note` rejected with a structured error naming the token (D2);
  unknown field `foo:bar` rejected, not ignored. Boundary pairs both directions: 256 characters accepted /
  257 rejected; 16 terms accepted / 17 rejected. *Evidence: six quoted responses covering the accepted and
  rejected side of each boundary.*
- **M2-AC14 (narrow-only + indistinguishability, B10/B17)** A board query referencing an unauthorized
  bulletin ID and one referencing a never-existent UUID return **byte-identical bodies and identical
  status codes**. *Evidence: quoted `diff` of the two response bodies, empty.*
- **M2-AC15 (composition assertion, B12)** Every query implementation taking a `ViewerId` references
  `app.visible_people` / `app.visible_bulletins` or the shared authorized-set builder; a fixture query
  taking a `ViewerId` without composing the authorized set fails the build. The secondary SQL-location
  rule uses a named AST/`sql`-tag-aware detection rule, not a bare `SELECT` grep, and has its own
  violating fixture. *Evidence: two failing-run messages, then the passing run.*
- **M2-AC16 (log hygiene)** Running the full e2e flow with log capture produces no line containing the
  bulletin body canary, the invite token, a JWT, or an email address. *Evidence: quoted grep for the four
  canaries, 0 matches.*
- **M2-AC17 (invite token)** The generator calls a CSPRNG with ≥ 16 bytes (unit-tested, with a fitness
  rule failing any non-CSPRNG source in that module); 10 000 generated tokens are all distinct and pass a
  length/charset assertion; a token generated for user A is not a prefix, suffix, or encoding of A's user
  ID or handle (asserted directly). A spent or revoked token returns `INVITATION_UNAVAILABLE`.
  *Evidence: quoted generator unit-test output, quoted distinctness count, two quoted reuse responses.*
- **M2-AC18 (failure surface)** Each returns a structured error with a stable code and no stack or
  internal detail: accepting your own invite, accepting twice, setting trust on a non-connection,
  reporting your own bulletin, archiving another user's bulletin, subscribing push twice.
  *Evidence: six quoted responses with codes.*
- **M2-AC19 (write-path IDOR, B13)** For every mutation type M2 implements — `bulletin.create`,
  `bulletin.archive`, `bulletin.report`, `bulletin.dismiss`, `connection.accept`, `trust.set`,
  `notifyMe.update` — an actor with no relationship to the subject gets a structured failure with **zero
  state change and zero outbox rows**, whether submitted via tRPC or via `sync.submitMutations`.
  Actorship is checked **before** version comparison, so no conflict envelope is emitted.
  *Evidence: per mutation type, a quoted error response plus `SELECT count(*)` unchanged on both the
  entity table and `outbox_events`.*
- **M2-AC20 (viewerId provenance, B14)** No tRPC input schema on any procedure contains a `viewerId`,
  `userId`, `actorId`, or `ownerId` field, asserted by walking the router type tree (not by grep); and
  `ViewerId` has exactly one constructor, taking an `Actor`. Proven by adding such a field.
  *Evidence: the failing run naming the procedure and field, then the passing run.*
- **M2-AC21 (push payload minimization, ADR-0002 §11)** A captured push payload contains identifiers and
  a generic string only — no headline, body, author name, or contact data. *Evidence: the captured payload
  quoted in full.*
- **M2-AC22 (delivery-time re-check, ADR-0002 §11)** A push computed for a recipient who is then made
  unauthorized before flush (deactivated, or the connection removed) is **not** delivered, and the receipt
  records the suppression. *Evidence: quoted receipt row + the push transport showing zero sends.*
- **M2-AC23 (outbox retry and dead-lettering)** A consumer that throws is retried with `available_at`
  growing per `least(15 min, 5s * attempts^2)`; after the 8th attempt the row is `status='dead'` and no
  further attempt occurs. *Evidence: quoted `SELECT event_id, attempts, status, available_at` snapshots
  across all eight attempts.*
- **M2-AC24 (concurrent drainers)** Two drainers running concurrently against a seeded backlog claim
  disjoint event sets — no event processed twice. *Evidence: quoted per-instance claimed-ID lists with an
  empty intersection + one receipt per event.*
- **M2-AC25 (handle rules, ADR-0008)** Onboarding rejects, each with a structured code naming the rule: a
  reserved handle (`admin`), a duplicate differing only by case (citext), a confusable of an existing
  handle, an out-of-charset handle, and an over-length handle. A change attempt returns `HANDLE_IMMUTABLE`.
  *Evidence: six quoted error responses.*
- **M2-AC26 (regression)** `pnpm boundaries` and `pnpm test:security` stay green with the nine new
  modules present — identity, connections, graph, bulletins, views, notifications, moderation, sync,
  audit (storage is not built) — and no module imports another module's persistence layer.
  *Evidence: both transcripts, exit 0, with the nine module names visible in the dependency-cruiser summary.*

**Done means:** M2-AC1 passes on a machine that is not the author's, with AC2–AC26 green in CI.

---

## M3 — Runtime compatibility spike

**Entry criteria:** M2 in progress or complete; the real transaction, push, and queue code paths exist.

**Goal:** convert ADR-0001 from `proposed` to a decided target with evidence. Scope and criteria live in
`docs/adr/ADR-0001-runtime-and-deployment-target.md` — **eleven criteria** (S1, S2, S3, **S3a**, S4–S10) —
with a 5-working-day timebox and a pre-committed Railway fallback. S3a (`current_user = session_user =
'app_rw'`, `rolbypassrls = false`, from the *deployed* process) was added by the ADR-0002 stress test: it
prevents the "connect as `postgres` to get the deploy green" failure, which would leave every other check
passing while the authorization model sits inert.

### Work items

M3.1 Worker entrypoint + tRPC (S1) · M3.2 Kysely transaction + rollback in `workerd` (S2) ·
M3.3 Supavisor connectivity, latency, **and deployed connection identity** (S3, S3a; test Hyperdrive as
mitigation if S3 fails) · M3.4 JWT validation (S4) · M3.5 Web Push (S5) · M3.6 Queues retry/DLQ (S6) ·
M3.7 Cron drain (S7) · M3.8 composition CPU, cold start, bundle, no-patched-deps (S8, S9) ·
M3.9 log/trace export (S10) · M3.10 spike report, ADR status flip, promote or delete throwaway code.

### Acceptance criteria

- **M3-AC1** `docs/engineering/spikes/M3-runtime-spike.md` contains, for **every one of the eleven**
  criteria, the criterion, a captured observation, and PASS/FAIL. No row may say "expected to work" or
  "not tested". *Evidence: the committed file; 11/11 rows carry an observation.*
- **M3-AC2** ADR-0001's status line reads `accepted — target: <Cloudflare Worker | Node on Railway>` with
  the deciding criterion named. *Evidence: quoted diff of the status line.*
- **M3-AC3 (the fallback is real)** Whatever the verdict, the M2 slice's e2e test passes against **both** a
  locally-run Node server and — if GO — the deployed Worker. *Evidence: two Playwright summary lines.*
- **M3-AC4 (S2 is not flaky)** The rollback test runs 50 consecutive times with 50 passes.
  *Evidence: quoted runner output showing 50/50.*
- **M3-AC5a (mechanical)** The lockfile contains no `patchedDependencies` and no vendored fork.
  *Evidence: quoted lockfile patch section, absent, plus the diff of added dependencies.*
- **M3-AC5b (judgment, signed)** The spike doc carries a named reviewer sign-off line asserting no
  hand-rolled crypto, connection pool, queue, or migration runner was introduced (§18).
  *Evidence: the quoted sign-off line with reviewer name and date.*
- **M3-AC6 (timebox)** The verdict is recorded within 5 working days of the spike branch's first commit,
  or an explicit extension with a stated reason appears in the spike doc. *Evidence: quoted `git log`
  first/last commit dates.*
- **M3-AC7 (boundaries survived)** `git diff --stat main...spike -- 'apps/server/src/modules/*/domain'
  'apps/server/src/modules/*/application'` is empty. *Evidence: quoted command output.*
- **M3-AC8 (S3a)** The deployed process reports `current_user = session_user = 'app_rw'` with
  `rolsuper = false` and `rolbypassrls = false`. *Evidence: quoted query output captured from the deployed
  process, not from a local psql session.*

---

## M4 — Staging live + observability baseline

**Entry criteria:** M2 exit signal met; M3 verdict recorded.

### Work items

M4.1 Supabase staging project (migrations by `app_migrator`, roles/grants/RLS per ADR-0002) ·
M4.2 frontend deploy (Cloudflare Pages) · M4.3 API deploy with `/health` carrying the deployed SHA ·
M4.4 queue/cron deploy · M4.5 CD: `main` → staging, **gated by B18**, migrations before rollout,
documented rollback · M4.6 observability: correlation IDs, RED metrics per tRPC procedure, outbox
depth/dead gauge, push failure rate · M4.7 alerts (four rules) · M4.8 staging smoke = the M2 e2e suite ·
M4.9 runbook `docs/procedures/operations.md`: deploy, rollback, secret rotation, **replay a dead outbox
event**, restore from backup, `app_migrator` break-glass · M4.10 expand/contract migration policy.

### Acceptance criteria

- **M4-AC1** `curl https://<staging-api>/health` returns 200 with a JSON `commit` equal to **the SHA the
  deploy job published** (not `git rev-parse HEAD` on `main`, which races with concurrent merges).
  *Evidence: quoted curl output beside the quoted deploy-job SHA artifact.*
- **M4-AC2** The M2 e2e suite passes against staging URLs from a clean CI runner with no pre-seeded
  fixtures. *Evidence: Playwright summary line from the CI job with the staging base URL visible in the
  run config.*
- **M4-AC3** Pushing to `main` deploys to staging with no manual step; migrations run before the API
  rollout. *Evidence: CI run URL/screenshot showing the ordered job graph and a green deploy.*
- **M4-AC4 (B18 gates rollout)** The post-deploy catalog smoke runs against the **live** staging database
  through the production connection path, asserts B1/B3/B4 plus `current_user = session_user = 'app_rw'`,
  and **blocks the rollout when it fails** — proven by pointing a staging deploy at a database whose
  `app_rw` has been granted `BYPASSRLS` and observing the refusal. *Evidence: the failing deploy's quoted
  job output + the passing run's assertion list.*
- **M4-AC5 (rollback works, tested)** A deliberately broken deploy is rolled back using
  `docs/procedures/operations.md` alone; `/health` returns the previous SHA within 10 minutes.
  *Evidence: two quoted `/health` outputs with timestamps.*
- **M4-AC6 (migration failure is safe)** A deliberately failing migration aborts the deploy, leaves the
  schema at the prior version with **no partial apply**, and the previous API version stays serving.
  *Evidence: quoted migration job output + `/health` showing the prior SHA + quoted `schema_migrations`
  state before and after.*
- **M4-AC7 (expand/contract proven)** The N-1 API image runs the smoke suite green against the newly
  migrated database. *Evidence: smoke summary line from the N-1 image.*
- **M4-AC8 (traceability)** A request made from the browser is findable in logs by its correlation ID, and
  its error links to the same ID in error tracking. *Evidence: screenshot of the log search by ID and the
  matching error record.*
- **M4-AC9 (metrics exist)** After the smoke run the metrics backend returns non-zero
  rate/error/duration series for at least three **named** tRPC procedures, plus outbox depth, dead-event
  count, and push failure rate. *Evidence: one quoted query result or screenshot per named series (six).*
- **M4-AC10 (all four alerts fire)** Each of dead outbox events > 0, error rate > 2 % over 5 min, outbox
  oldest-pending age > 5 min, and staging down fires end to end from a synthetic trigger within its stated
  window. *Evidence: four received-alert screenshots with timestamps.*
- **M4-AC11 (dead-event replay)** A `dead` event replayed via the runbook's documented command is
  delivered exactly once: a `consumer_receipts` row appears and no duplicate side effect is created.
  *Evidence: quoted receipt rows before/after + the runbook command transcript.*
- **M4-AC12 (log hygiene in deployed config)** The staging smoke run's exported logs contain none of the
  four canary strings. *Evidence: quoted grep over the exported staging logs, 0 matches.*
- **M4-AC13 (secrets)** No secret value appears in the repository, in **build logs**, or in the client
  bundle. *Evidence: quoted grep over `apps/web/dist`, quoted grep over the CI build-log artifact, and the
  `secret-scan` job status.*
- **M4-AC14 (staging is not open)** Staging requires a valid invite to sign up; an unauthenticated visitor
  reaches only the sign-in page. *Evidence: quoted curl of two data endpoints returning 401 + a screenshot
  of the gated sign-in page.*
- **M4-AC15 (backup restore is real)** A restore from an automated backup into a scratch project succeeds
  and the smoke suite passes against it. *Evidence: restore transcript + smoke summary line.*

---

## M5 — Remaining v1 breadth

**Entry criteria:** M4 exit signal met. **Standing rule: no M5 work item starts without at least one AC.**

### Work item groups

**A. Bulletins and board breadth** — A1 remaining six types · A2 edit (+ `expectedVersion`) · A3 expiry
sweep · A4 tags, location, URL detection · A5 full grammar · A6 saved views CRUD + defaults + sorts ·
A7 Notify Me designation UI (D1) · A8 Notify Me full matching incl. the query-change combined notification.

**B. Graph and connections** — B1 degrees ≥ 2 + ghost nodes with the ADR-0004 adjacency rule ·
B2 `path_via` + truncation UI · B3 introduction requests · B4 blocking + cache invalidation ·
B5 connection removal + invite revocation/expiry · B6 per-field contact visibility + name thresholds ·
B7 perf gate.

**C. Notifications** — C1 grouping/dedup across devices and families · C2 delivery records subsystem ·
C3 subscription lifecycle and failure handling · C4 preferences.

**D. Moderation and operator console** — D1 report reasons · D2 hide-author, disconnect, block from the
report flow · D3 operator console on `app_operator_ro` + separate entrypoint · D4 audit per operator read
and action · D5 D3-compliant copy.

**E. Identity, privacy, GDPR** — E1 avatars + storage module + signed URLs · E2 deactivation · E3 erasure ·
E4 export · E5 reconciliation cron · E6 privacy notice + pseudonymous-audit statement.

**F. Offline and sync** — F1 full conflict matrix · F2 conflict UI · F3 cache invalidation on block,
erasure, **and revoked authorization** · F4 batching + per-actor ordering · F5 retention + `expired`
outcome + staleness bound.

**G. Platform and quality** — G1 PWA/Workbox · G2 dark theme · G3 the §21 matrix · G4 a11y ·
G5 public API docs · G6 load test.

### Acceptance criteria

- **M5-AC1 (§21 matrix as a coverage index)** An e2e scenario test exists and passes for each of the
  twelve addendum §21 rows, and each test **references the specific AC or invariant it enforces**
  (e.g. row "blocking" → M5-AC2's seven assertions), recorded in `ac-index.md`. A well-named test that
  asserts nothing fails this AC because the referenced invariant list would be empty. *Evidence: runner
  output listing the twelve scenario names as passed, plus the generated index section mapping each row
  to its referenced ACs.*
- **M5-AC2 (blocking is total, B7)** After A blocks B: no graph path routes through the blocked edge in
  either direction; no bulletin of either is exposed to the other; directed requests fail closed; no
  notification is delivered — **including a grouped push computed before the block and flushed after it**;
  no contact field is exposed; B is not told; B's cached data is purged on next sync. *Evidence: one
  scenario test with the seven assertions quoted, plus the flush-boundary receipt row.*
- **M5-AC3 (hidden identities, B8)** A topology-only node's payload contains no name, handle, avatar, role,
  mutual count, or real internal ID, and its surrogate differs for two viewers of the same hidden person.
  **Structural case:** on a fixture graph where a ghost's neighbour set would uniquely determine it, the
  adjacency returned matches ADR-0004's rule (edges only to people the viewer already sees at `full`).
  *Evidence: two quoted payloads from two viewers + the quoted adjacency list for the fixture.*
- **M5-AC4 (erasure, B11)** After erasure: bulletins, reports, dismissals, views, Notify Me query, push
  subscriptions, contact fields, display name, and avatar object are gone from every read path; trust
  values others set on them are deleted; the handle is tombstoned and not re-issuable; the Supabase auth
  user is deleted; audit rows retain only the internal ID. A queued offline mutation referencing them
  returns `GONE`. *Evidence: quoted `SELECT` per table + one quoted API response + a storage object
  listing showing the avatar absent.*
- **M5-AC5 (conflict matrix, F1)** Every row of ADR-0005's matrix has a named integration test; a
  `bulletin.update` with a stale `expectedVersion` returns `conflict` with `currentVersion` and
  `currentState` and does not modify the row. *Evidence: test names listed against matrix rows + one quoted
  conflict response + a `SELECT` proving the row unchanged.*
- **M5-AC6 (write-path IDOR complete, B13)** Every mutation type in ADR-0005's matrix — not only M2's seven
  — has a B13 row proving zero state change and zero outbox rows for an unrelated actor.
  *Evidence: the B13 runner output listing one result per matrix row.*
- **M5-AC7 (`expired` outcome, F5)** A mutation with `clientCreatedAt` 31 days old returns `expired` with
  the user-facing message and changes no state. After the daily prune removes a `mutation_results` row,
  re-submitting that `mutationId` returns `expired`, **never** a silent duplicate apply.
  *Evidence: two quoted responses + `SELECT count(*) = 0` and `= 1` respectively.*
- **M5-AC8 (revoked-authorization cache invalidation, F3)** After a connection is removed, the removed
  peer's cached graph and board entries are purged on next sync and a refetch returns 0 rows.
  *Evidence: quoted sync response + Dexie contents before and after.*
- **M5-AC9 (batching and ordering, F4)** A batch of three mutations from one actor is applied in submission
  order; a mid-batch failure does not apply later dependent items out of order; each item carries its own
  outcome. *Evidence: quoted batch response array + quoted row timestamps.*
- **M5-AC10 (offline states are visible, F2)** The UI renders distinct labelled states for pending, failed,
  conflicted, and synchronized. *Evidence: four screenshots, one per state.*
- **M5-AC11 (cache staleness bound, E6)** Cached graph and board data older than the configured bound
  renders in an explicit stale state, and cached **person detail** is not rendered at all until re-sync; a
  client that never syncs after a server-side block does not present the blocked party's content past the
  bound. *Evidence: screenshot of the stale state + a quoted test asserting the blocked party's content is
  withheld past the bound.*
- **M5-AC12 (notification grouping and dedup, C1–C2)** Ten matching bulletins in one window produce exactly
  one notification; the same notification is not delivered as two separate alerts to two devices of one
  user; delivery records live in the notifications tables, not in bulletin rows. *Evidence: quoted counts
  from the notification tables + the captured payloads.*
- **M5-AC13 (subscription lifecycle, C3)** A push endpoint returning 404/410 causes the subscription row to
  be deleted with no further sends, while other devices of the same user still receive.
  *Evidence: quoted `SELECT` before/after + the second device's captured payload.*
- **M5-AC14 (Notify Me is singular, D1, A7)** Creating a second Notify Me query fails at the database
  constraint; toggling the bell on view B moves the query from view A and the UI states that it moved.
  *Evidence: quoted constraint-violation error + a screenshot of the moved-bell feedback.*
- **M5-AC15 (query-change combined notification, A8)** Changing the Notify Me query produces exactly **one**
  combined notification for pre-existing matches, and zero on a subsequent unchanged save.
  *Evidence: quoted push payload + notification counts before and after the no-op save.*
- **M5-AC16 (saved views are viewer-scoped, A6)** User B cannot read, update, or delete user A's view by ID
  — 404, not 403 (ADR-0002 §10). *Evidence: three quoted responses.*
- **M5-AC17 (full grammar, A5)** Each of `from: tag: loc: deg: trust: is:` plus negation, alternation, and
  quoted phrases parses to the expected AST and compiles to a result set matching a hand-computed fixture;
  `trust:unset` and `trust:0` select disjoint sets; B10 re-runs green over the full grammar.
  *Evidence: quoted AST + result counts per operator, the two disjoint counts, and the B10 output.*
- **M5-AC18 (search never touches people, B17)** Free-text search over a term matching only an author's
  display name returns 0 bulletins. `from:` over a non-authorized author and over a non-existent author
  return **0 rows with byte-identical bodies** — never a validation error, which would be a
  people-existence oracle. *Evidence: quoted response + quoted `diff` of the two `from:` bodies, empty.*
- **M5-AC19 (seven bulletin types, A1)** Each type round-trips create→read with its type-specific required
  fields; a payload missing a type-required field is rejected naming the field. *Evidence: seven quoted
  create responses + one quoted 400.*
- **M5-AC20 (edit does not reset expiry, A2)** Editing leaves `expires_at` byte-identical and bumps
  `version` and `updated_at`. *Evidence: quoted `SELECT` before and after.*
- **M5-AC21 (expiry sweep, A3)** An expired bulletin is absent from every board and returns `GONE` by ID
  within one sweep interval, with no manual step. *Evidence: quoted board response + quoted sweep log line
  with timestamps.*
- **M5-AC22 (introduction requests, B3)** An Introduction Request to a non-direct connection, or to a direct
  connection who has disabled them, fails closed with a structured code; the connector cannot forward it,
  and no forwarding endpoint exists in the contract surface. *Evidence: two quoted error responses + the
  quoted contract surface listing showing no forward procedure.*
- **M5-AC23 (graph correctness at depth, B1)** On a seeded fixture graph the viewer's `visible_people`
  result equals the hand-computed expected set at depths 1, 2, and 3, including the disclosure level per
  node. A block on an intermediate edge removes every path routed through it — nodes reachable only via
  that edge disappear. *Evidence: quoted result set beside the quoted expected fixture, before and after
  the block.*
- **M5-AC24 (`path_via` discloses nothing extra, B2)** `path_via` names an intermediary only when that
  intermediary is at `full` disclosure for this viewer; otherwise it carries the ghost surrogate, never a
  name. *Evidence: quoted `path_via` payload for a viewer with a hidden intermediary.*
- **M5-AC25 (report reasons, D1)** The reason enum accepts exactly the six PDF values — commercial spam,
  misleading content, repeated irrelevant posting, harassment, unsafe or illegal content, other — and
  rejects any other with a structured error naming the field; the stored reason never appears on an
  author-reachable path. *Evidence: quoted 400 for an out-of-enum value + quoted author-facing response.*
- **M5-AC26 (hide-author, D2)** After V hides author A: every current **and future** bulletin by A is absent
  from V's board; A's other viewers are unaffected; A is not told; A remains in V's graph (hiding ≠
  disconnect ≠ block). *Evidence: two quoted board responses including a bulletin created after the hide,
  plus a quoted graph response still containing A.*
- **M5-AC27 (operator console, D3–D4, B15)** An operator can review a private report, inspect the reported
  bulletin and metadata, and remove content / restrict posting / suspend an account. The operator path
  **cannot** read trust values, cannot see reporter identity in any surface reachable by a reported user,
  cannot write outside those four actions, connects as `app_operator_ro`, and emits an audit entry **per
  read** as well as per action. *Evidence: screenshots of the three actions + quoted audit rows for a read
  and an action + a quoted 42501 for a trust-table select on the operator role.*
- **M5-AC28 (moderation copy, D3/D5)** The report confirmation copy constant equals the approved string and
  contains no promised timeline, outcome, jury, or strike wording. *Evidence: quoted test assertion on the
  constant + screenshot of the sheet.*
- **M5-AC29 (no reputation surface, PDF principle 7)** A fitness test asserts no tRPC output schema contains
  a field matching the checked-in forbidden list — `reportCount`, `strikes`, `rating`, `score`, `followers`,
  `likes`, `reactions`, `popularity`, `endorsements`, and any `*Count` on a person or bulletin — and
  requires the list file to be non-empty. Proven by adding `reportCount` to a schema. *Evidence: the failing
  run naming the field, then the passing run, plus screenshots of the report and person sheets.*
- **M5-AC30 (deactivation, E2)** A deactivated user disappears from every other viewer's graph, board, and
  search, and their bulletins are not visible; reactivation restores exactly the prior state; the handle
  stays reserved and rows stay intact with `deactivated_at` set. *Evidence: quoted third-party responses
  before/off/on + a quoted `SELECT` showing rows present.*
- **M5-AC31 (export, E4)** A data export returns every category of the requesting user's personal data and
  **no** third party's private data — in particular no trust value another user set on them (ADR-0002 Q1)
  and no reporter identity. *Evidence: quoted export payload key list + a grep for a seeded third-party
  canary, 0 matches.*
- **M5-AC32 (reconciliation, E5)** An auth user with no `app.users` row, and an `app.users` row with no auth
  user, are both detected by the cron and reported — not silently ignored, not auto-repaired.
  *Evidence: quoted cron output naming both orphan directions on seeded fixtures.*
- **M5-AC33 (storage, B16, E1)** Direct bucket access as `anon`/`authenticated` is denied; a signed URL is
  minted only for an object the viewer is authorized to see under the §6a disclosure rule — in particular
  no avatar URL is minted for a topology-only person; every minted TTL is ≤ 5 minutes. *Evidence: quoted
  403 for direct access + a quoted board response for a viewer with a ghost author showing no signed URL +
  quoted TTL values.*
- **M5-AC34 (abuse limits)** Failed invite-token lookups beyond the configured threshold return 429 with a
  stable code, and the response shape for a valid token is identical to that for an invalid one. Invite
  creation, report creation, push subscription, and magic-link requests are each rate-limited server-side
  with a structured code. *Evidence: quoted 429s (five surfaces) + the two token responses shown identical
  in shape.*
- **M5-AC35 (perf gate, B7)** Server-side p95 for the initial graph read is < 300 ms at 5 000 people with 20
  connections each, enforced as a blocking CI job that fails the build on regression. *Evidence: quoted
  benchmark output with the p95 figure and the job's pass/fail status.*
- **M5-AC36 (a11y, G4)** The board and person sheet pass an automated axe scan with zero critical or serious
  violations. The graph is operable by keyboard for each enumerated operation: focus a node, traverse to the
  next/previous node, open the person sheet, close it with Escape, pan, zoom, and reach every interactive
  control in DOM order; `prefers-reduced-motion` suppresses graph animation. *Evidence: quoted axe summary
  + a screen recording or keystroke transcript covering the seven operations + a screenshot with reduced
  motion active.*
- **M5-AC37 (API parity, G5)** The B5 visibility matrix runs a second time through the public API surface
  with identical expected results. *Evidence: the matrix output for both surfaces, quoted side by side.*
- **M5-AC38 (full B-suite green)** `pnpm test:security` reports all **eighteen** B-rows as `implemented` and
  passing; no row carries a `pending` marker. *Evidence: quoted runner output listing eighteen rows.*
- **M5-AC39 (regression, split by provability)** (a) Every CI-executable M1–M4 AC passes on `main`.
  *Evidence: CI run URL plus the `ac-index.md` mapping table showing which job covers which AC.*
  (b) Each non-CI-executable M1–M4 AC — M1-AC9, M1-AC12, M4-AC5, M4-AC8, M4-AC10, M4-AC11, M4-AC15 — is
  re-verified manually within the release window. *Evidence: the dated re-verification transcript or
  screenshot per AC.*

---

## M6 — Production launch (terminates in the owner's launch DoD)

**Entry criteria:** M5 exit signal met, including M5 groups D and E green.

**Goal:** satisfy every clause of `docs/product/launch-definition-of-done.md`, verified rather than
asserted, with an independent QA sign-off before "live" is claimed to the owner.

### Work items

M6.1 production Supabase project + isolated secrets and VAPID keypair · M6.2 production deploy pipeline
with the mechanical launch gate · M6.3 production observability, alerts, on-call routing ·
M6.4 pre-launch rollback and restore drills · M6.5 privacy notice, terms, operator contact path live ·
M6.6 **honest seed dataset** (users, connections, bulletins) with a documented generator ·
M6.7 **no-mock audit** of the deployed build · M6.8 **visual QA pack**: side-by-side captures of every
settled surface against `design/Playa Post.dc.html`, both themes · M6.9 **PDF §3 feature-completeness
checklist**, line by line · M6.10 **independent user-perspective QA pass and sign-off** ·
M6.11 first invitation cohort.

### Acceptance criteria

Infrastructure gates first, then the six launch-DoD clauses.

- **M6-AC1 (prod is live and is the released SHA — DoD clause 1)** `curl https://<prod>/health` returns 200
  with `commit` equal to the tagged release SHA, and the app's real production URL loads the sign-in screen
  in a browser. *Evidence: quoted curl beside the quoted tag SHA + a screenshot of the loaded production URL.*
- **M6-AC2 (environments are isolated)** Prod and staging use different Supabase projects, different VAPID
  keypairs, and different secrets; a staging-issued JWT is rejected by prod with 401; a prod database
  credential does not authenticate against staging. *Evidence: the two project refs, a quoted 401 for the
  cross-environment token, and a quoted authentication failure for the cross-environment credential.*
- **M6-AC3 (the launch gate is mechanical)** The release job refuses to deploy production unless the M5
  group D and group E AC suites are green **and** the QA sign-off artifact (M6-AC15) is present; proven by
  a deliberately failing gate run for each of the two conditions. *Evidence: two quoted CI outputs of
  refused deploys naming the failing condition, then the permitted one.*
- **M6-AC4 (B18 gates prod rollout)** The post-deploy catalog smoke runs against the live production
  database through the production connection path and blocks rollout on failure. *Evidence: quoted job
  output listing the B1/B3/B4 assertions plus `current_user='app_rw'`.*
- **M6-AC5 (rollback proven in prod, before real users)** A deliberate bad deploy is rolled back by runbook
  alone; `/health` returns the previous SHA within 10 minutes. *Evidence: two quoted `/health` outputs with
  timestamps.*
- **M6-AC6 (restore proven in prod, before real users)** A restore from an automated production backup into
  a scratch project succeeds and the smoke suite passes against it. *Evidence: restore transcript + smoke
  summary line.*
- **M6-AC7 (first real invitation)** An operator-issued invitation admits exactly one real account; a second
  use of the same token returns `INVITATION_UNAVAILABLE`; audit entries for issuance and acceptance exist.
  *Evidence: quoted audit rows + the sign-in screenshot + the quoted reuse response.*
- **M6-AC8 (prod log hygiene)** Production logs from the first cohort's first 24 hours contain none of the
  four canary patterns, and no bulletin body, contact value, or JWT appears in any exception trace.
  *Evidence: quoted grep over exported production logs and traces, 0 matches.*
- **M6-AC9 (erasure works in prod)** A test account created in production is fully erased via the production
  path, and M5-AC4's assertions hold against the production database. *Evidence: quoted `SELECT` per table
  from prod + the quoted API response.*
- **M6-AC10 (working, not mocked — DoD clause 2)** The deployed production build contains no mock layer,
  stub data service, fixture-backed repository, or feature flag disabling a code path. Asserted three ways:
  a build-time fitness check fails if any module matching the mock/stub/fake naming rule is reachable from
  the production entrypoint graph; the deployed bundle contains none of the checked-in mock module names;
  and every §23 flow step is observed writing to the production database. *Evidence: quoted fitness-check
  output, quoted grep over the deployed bundle (0 matches), and quoted `SELECT` rows created by the QA
  walkthrough in the production database.*
- **M6-AC11 (real seed data — DoD clause 3)** Production contains a seeded cohort of at least 8 users, 15
  connections with varied trust values (including `unset`), and 12 bulletins spanning all seven types, all
  created through the **real application paths** (not direct SQL inserts), so a first visitor sees a
  populated graph and board. The seed generator is checked in and re-runnable. *Evidence: screenshot of the
  seeded graph and board as a seeded user + quoted row counts per table + the generator's run transcript
  showing API calls rather than inserts.*
- **M6-AC12 (user-perspective E2E on the deployed app — DoD clause 4)** A browser-driven walkthrough of the
  **deployed production app** covers the eleven §23 steps as a user performs them — magic-link sign-in,
  invite, accept, trust, graph, bulletin, notify, dismiss/report, archive, offline replay — with a captured
  screenshot or recording per step and the steps written down. This is distinct from the CI e2e suite: it
  runs against production with real email delivery and a real push subscription.
  *Evidence: the QA pack containing eleven captioned screenshots or a recording with a step index, plus the
  written step list.*
- **M6-AC13 (visual correctness vs the prototype — DoD clause 5)** Every settled surface — graph home,
  board, person sheet, compose sheet, report sheet, intro request, onboarding, offline queue state — is
  captured side by side against `design/Playa Post.dc.html` in **both** the warm-desert light and
  neon-night dark themes, and each difference is either resolved or recorded as an accepted, justified
  deviation in the QA pack (the three escalations E1, E2, E4 are pre-accepted deviations and are listed as
  such). *Evidence: the side-by-side capture set (8 surfaces × 2 themes) + the deviation list with a
  justification per entry.*
- **M6-AC14 (feature completeness — DoD clause 6)** A checklist enumerating every line of PDF §3 "Included",
  as modified by `docs/product/decisions.md`, marks each line implemented and links it to the AC and the
  QA-pack evidence that demonstrates it in production. No line may be marked partial or deferred.
  *Evidence: the committed checklist with every line ticked and linked; a reviewer can follow any line to
  running evidence.*
- **M6-AC15 (independent QA sign-off — DoD gate)** A user-perspective QA pass performed by someone who did
  **not** implement the work signs off on clauses 1–6, in a dated artifact naming the reviewer, listing what
  was exercised, and recording any defect found and its resolution. A sign-off that merely restates the
  clauses without naming what was exercised does not satisfy this AC, and the release job checks for the
  artifact's presence (M6-AC3). *Evidence: the committed sign-off document with reviewer name, date,
  exercised-surface list, and defect log.*

**Done means:** all six launch-DoD clauses are verified with captured evidence, QA has signed off
independently, and real invited people are using the product.

---

## Alternatives considered (plan level)

| Alternative | Why not |
|---|---|
| **Build modules horizontally, then integrate** | Forbidden (addendum §23, PDF §9). Integration risk lands last, when it is most expensive. |
| **Decide the runtime before writing code (M3 before M2)** | The spike is only meaningful against real transaction, push, and queue code; a toy spike proves nothing about S2/S5/S6. |
| **Skip M1's fitness functions, review boundaries manually** | A rule that is not executable is a suggestion. This is the main thing an agent-driven build erodes (R8). |
| **End at staging (the first draft of this plan)** | The goal says "live", and the owner's launch DoD says production with QA sign-off. Ending at staging left production configuration, isolation, seeding, visual QA, and the launch gate entirely unspecified — the AC review's top finding. |
| **Ship to production before M5's D and E groups** | Inviting real people into a private trust network without blocking, erasure, and an operator console is a safety gap, not a scope trade. M6-AC3 makes the gate mechanical. |
| **Let the implementers run the launch QA pass** | The launch DoD requires independence. Self-QA is the failure mode the gate exists to prevent, and M6-AC15's artifact makes it auditable. |
| **Keep the B-suite at B1–B12** | The stress test showed B1–B12 covers reads by authorized-but-unrelated viewers and nothing else — no write path, no provenance, no policy shape, no live database, no operator, no storage. |
| **Use Supabase RLS as the enforcement mechanism** | See ADR-0002. |
| **One big M2 PR** | Unreviewable, and it hides boundary erosion. M2 is 20 PRs for that reason. |

## Risks

| # | Risk | Severity | Mitigation | One-way door? |
|---|---|---|---|---|
| R1 | Supabase pooler + Kysely transactions unreliable in `workerd` | High | Pre-committed Railway fallback; both entrypoints built in CI from M1 | No |
| R2 | A subtly duplicated visibility predicate leaks data | **Critical** | ADR-0002 single-composition rule + B12 composition assertion + the B5–B11 matrix | No, but a leak is not undoable |
| R3 | Recursive-CTE graph performance degrades non-linearly | Medium | Measure from M2, gate in M5-AC35; incremental loading before caching | No |
| R4 | GDPR erasure shape is hard to change once real users are erased | Medium | Erasure test written before erasure code; M6-AC9 proves it in prod | **Yes** |
| R5 | The graph surrogate key is rotated, shuffling every ghost layout | Low | Documented "do not rotate" note in platform secrets | **Yes** in effect |
| R6 | Notification grouping duplicates or drops pushes under retry | Medium | `consumer_receipts` + M2-AC8 + M2-AC23/AC24 | No |
| R7 | Scope creep into excluded v1 features | Medium | D2 cut notes; M5-AC29 is a standing fitness test against reputation surfaces | No |
| R8 | Agent-driven implementation erodes module boundaries over many PRs | High | M1-AC2 fitness functions + M2-AC26 regression + PR template checkbox | No |
| R9 | The M3 timebox slips and blocks M4 | Medium | Fallback pre-committed; slipping past 5 days is itself the trigger to take Node | No |
| R10 | Two-user flows under-tested because e2e is expensive | Medium | M2-AC1 uses two contexts from the start; every privacy AC is multi-actor | No |
| R11 | A table with RLS enabled and no policy returns zero rows **silently** — a privacy-config bug presents as a product bug | Medium | M1-AC5's exact-shape assertion, including the no-policy regression case | No |
| R12 | The operator console becomes the widest read surface in the system | High | ADR-0002 §8 gives it a role, an entrypoint, and per-read audit before it is built; B15/M5-AC27 assert scope | Hard to narrow later |
| R13 | The deployed API connects as `postgres` to unblock a deploy, leaving every Testcontainers check green while the model is inert | High | ADR-0001 S3a at spike time; B18/M4-AC4/M6-AC4 gate rollout | No |
| R14 | A `viewerId` accepted from request input — total silent impersonation | **Critical** | Branded `ViewerId` with one constructor + B14/M2-AC20 AST assertion | No, but a leak is not undoable |
| R15 | **Seed data hides broken paths** — the launch DoD warns about exactly this | Medium | M6-AC11 requires seeds created through real application paths, not SQL inserts, so a broken write path cannot be seeded around | No |
| R16 | **Visual QA degrades to "it renders"** — the most likely way clause 5 is quietly dropped | Medium | M6-AC13 requires side-by-side captures against the prototype across 8 surfaces × 2 themes, with an explicit deviation list | No |

## Escalations for the product owner (addendum §24, PDF §10)

Each changes user-visible behavior or the privacy promise and is not a routine implementation detail.
**Proposed resolutions proceed as stated unless the owner objects.** E1–E3 come from the initial plan;
E4–E6 were raised by the ADR-0002 stress test.

**E1 — Edges between two other people render at uniform weight.** The prototype varies edge thickness by
trust for *every* edge; deriving weights for edges the viewer is not party to requires reading third
parties' private directional trust, contradicting PDF §4. *Proposed: only edges incident to the viewer carry
weight.* Visible change to the graph's look; pre-recorded as an accepted deviation for M6-AC13.

**E2 — Free-text board search does not match author names.** The prototype includes author name in its text
haystack (`design/Playa Post.dc.html:671`); at scale that is people search through the text channel.
*Proposed: `from:` covers author narrowing, bounded to already-authorized authors, filter-then-resolve.*
Visible change to search behavior; pre-recorded as an accepted deviation for M6-AC13.

**E3 — Handles are immutable in v1.** The PDF says "stable" without ruling on change; a re-issued handle is
an impersonation vector in a recognition-based network. *Proposed: immutable, operator-assisted change only,
old handles tombstoned.* Constrains a user-facing capability.

**E4 — Private-node adjacency disclosure.** A ghost adjacent to exactly {Moss, Juniper, Kestrel} — three
people the viewer sees fully — is uniquely determined by structure to anyone with ordinary social knowledge
of that camp, even though no forbidden field was sent. The surrogate ID prevents correlation *across*
viewers; it does nothing about re-identification *within* one view. *Proposed (privacy-conservative): a
topology-only node's adjacency is restricted to edges incident to people the viewer already sees at `full`
disclosure, and ghosts expose no mutual count and no connection count — polled over time, a mutual count
leaks the existence and timing of connections the viewer cannot see.* Residual accepted and stated: a ghost
adjacent to three or more fully-visible people remains narrowable by a viewer with social knowledge. The
alternative — degree only, no adjacency — would make ghosts nearly meaningless as topology, which is why it
is not the proposal. **Visible change: the graph shows fewer ghost edges than the prototype.**

**E5 — Handle availability at onboarding is a people-existence oracle.** `citext unique` means the sign-up
flow answers "is `moss` taken?" — one bit of people search in a product where PDF §3 excludes public people
search and §4 states there is none. *Proposed (privacy-conservative): the onboarding form does not expose an
availability check. A handle is submitted with the rest of onboarding and, if taken, the server returns a
generic "that handle is not available" on submit, rate-limited per account and per IP under M5-AC34.* This
trades a little sign-up polish for closing a trivially scriptable enumeration channel. **Visible change: no
live green-tick handle checker during onboarding.**

**E6 — Maximum staleness for cached graph and board data.** PDF §5 requires cached data to be invalidated on
synchronization, which makes revocation contingent on a device syncing; a device that never syncs again
renders a blocked person's board and graph forever. This is the closest the design comes to "returning
hidden data and relying on the frontend to conceal it" (addendum §15). *Proposed (privacy-conservative):
cached graph and board data older than **24 hours** renders in an explicit stale state, and cached **person
detail** (name, avatar, contact fields) is not rendered at all beyond **24 hours** without a successful
re-sync — the board's own bulletin content stays readable offline up to **7 days**, after which the offline
corpus is cleared.* Rationale for the split: bulletin content is the offline value proposition
(principle 8), while person identity is what a block is meant to withdraw. **Visible change: a user offline
for more than a day sees people rendered as placeholders, and after a week the cached board empties.** This
directly trades offline usefulness against revocation latency, which is why it is the owner's call.

---

## Appendix — Proposed GitHub issues for M1 + M2

Not filed. Labels: `feature`, `adr`, `vertical-slice`, `bug`.

### M1

| # | Title | Body | Label |
|---|---|---|---|
| 1 | Scaffold pnpm workspace per addendum §3 | Create `pnpm-workspace.yaml`, root `package.json`, strict `tsconfig.base.json`, and the `apps/*` + `packages/*` directories per §3. Do not create empty module directories — §4 forbids placeholder layers and M1-AC13 enforces it. | feature |
| 2 | Enforce module boundaries with dependency-cruiser + ESLint | Implement seven executable rules (the five §19 prohibitions plus `no-container-outside-composition` and `no-sql-outside-persistence`). Add a violating fixture per rule under `tests/fitness/__fixtures__/` and assert each is flagged **by rule name**. | feature |
| 3 | Vitest workspace + Testcontainers Postgres harness | Two Vitest projects (`unit`, `integration`). `packages/testing` starts Postgres, applies `supabase/migrations`, truncates between tests. Unit tests must run with no Docker so M1-AC1's first half holds. | feature |
| 4 | Local Supabase dev + migration and type-generation flow | `supabase/config.toml`, `migrations/`, `seed/`, `sql/`; `pnpm db:start|reset|migrate|types`. Kysely types checked in; CI fails on drift. | feature |
| 5 | Baseline security migration per ADR-0002 §2–§4 | Schema `app`; roles `app_rw` (`NOSUPERUSER NOBYPASSRLS NOINHERIT`, member of nothing) and `app_migrator` (owner). Full revoke set **including functions, sequences, types** and `ALTER DEFAULT PRIVILEGES FOR ROLE app_migrator`. Verbatim per-table shape: `ENABLE` + `FORCE` + `CREATE POLICY app_rw_full_access AS PERMISSIVE FOR ALL TO app_rw USING (true) WITH CHECK (true)` + `COMMENT ON POLICY`. Include a canary table so assertions are non-vacuous. | adr |
| 6 | Security suite B1–B4 + B12 secondary + the B-row manifest | Implement the rows checkable before features exist, plus `b-rows.manifest.json` declaring all eighteen as `implemented` or `pending: <milestone>`. B3 asserts the **full policy shape** (`FORCE`, `relowner`, exact `pg_policies` row, empty `pg_auth_members`). Prove each with a scratch-migration regression. | adr |
| 7 | GitHub Actions CI with both server builds | Ten named jobs: `typecheck`, `lint`, `lint:boundaries`, `test:unit`, `test:integration`, `test:security`, `build:web`, `build:server:cloudflare`, `build:server:node`, `secret-scan`. Required on `main`. Both server builds are the §22 fitness function. | feature |
| 8 | `packages/configuration` — fail-fast validated env | Zod-validated environment config. Boot fails within 2 s naming the missing key and its expected type, printing no other secret's value. | feature |
| 9 | `packages/observability` — redacting logger and traces | Allowlist-based redaction for log fields **and OpenTelemetry span attributes** (ADR-0002 Q3), plus correlation-ID plumbing. A test asserts a non-allowlisted field reaches neither stdout nor an exported span. | feature |
| 10 | Repo conventions: CLAUDE.md, PR template, secret scanning | `CLAUDE.md` pointing at the addendum, repo map, and launch DoD; PR template with an AC + evidence section and a boundary checkbox; a pre-commit hook mirroring the `secret-scan` CI job. | feature |
| 11 | AC traceability index generated by CI | `docs/engineering/ac-index.md` mapping every AC ID to a CI job name or `manual: <procedure>`. The job fails if any AC ID in the plan is unmapped. This is what makes M5-AC39 and the B-row gate provable. | feature |

### M2

| # | Title | Body | Label |
|---|---|---|---|
| 12 | Schema migrations for the vertical slice | All thirteen M2 tables, each with the ADR-0002 §4 verbatim policy shape, grants, indexes, and `version` columns where ADR-0005 requires them. One migration per logical group. | vertical-slice |
| 13 | tRPC skeleton, contracts package, auth context, branded `ViewerId` | `packages/contracts`, the tRPC root, and the context boundary that verifies the Supabase JWT and resolves an `Actor` (ADR-0008 rule 8). `ViewerId` is branded with exactly one constructor taking an `Actor`; no JWT or Supabase client reaches an application service. | adr |
| 14 | Composition root via explicit factories | Implement ADR-0003: `container.ts`, `request-scope.ts`, `registrations.ts`, with the dependency-cruiser rule restricting container imports to `entrypoints/` and `composition/`. | adr |
| 15 | identity: onboarding, actor resolution, handle rules | Magic-link sign-in; handle rules (citext unique, charset, reserved blocklist, confusable check, immutability per E3); display name; `app.users` per ADR-0008. Incomplete onboarding returns `ONBOARDING_REQUIRED`. Handle-taken returns a generic message with no availability endpoint (E5). | vertical-slice |
| 16 | connections: invite create / open / accept | Opaque revocable token from a CSPRNG, ≥ 16 bytes, not derived from any ID. Acceptance is transactional and emits `ConnectionAccepted`. A spent or revoked token returns `INVITATION_UNAVAILABLE`. | vertical-slice |
| 17 | connections: private directional trust | `SetConnectionTrust` — directional, private, viewer-owned; `unset` distinct from `0`, modelled as NULL. Emits `ConnectionTrustChanged`. Never exposed to the other party or a third party, **including via conflict envelopes**. | vertical-slice |
| 18 | graph: `visible_people` recursive CTE + read model + person projection | Checked-in `SECURITY INVOKER` function with `SET search_path = ''` per ADR-0004, limited in M2 to the viewer plus accepted 1st-degree connections. Blocks prune inside the recursive term. Implements ADR-0002 §6a: every person representation in every payload is projected through this function's `disclosure` level. | vertical-slice |
| 19 | bulletins: create and archive a Request | `CreateBulletinService` and `ArchiveBulletinService` with lifecycle timestamps, `version`, and `BulletinCreated`/`BulletinArchived` outbox events in the same transaction. Request type only. Non-author `getById` on an archived bulletin returns 404 `BULLETIN_GONE`. | vertical-slice |
| 20 | views: query grammar tokenizer, Zod AST, and SQL compiler | ADR-0007 restricted to `type:` and bare text. Unknown fields, over-length input, and > 16 terms are rejected naming the offending token; well-formed values that resolve to nothing return zero rows, never an error. Compiles to parameterized SQL over the authorized CTE. | adr |
| 21 | views: single Notify Me query | One row per user enforced by a primary key on `owner_id` (D1 as a constraint). Stores source text plus validated AST with `ast_version`. `UpdateNotifyMeQuery` emits `NotifyMeQueryChanged`. | vertical-slice |
| 22 | notifications: subscription, grouped delivery, delivery-time re-check | Web Push subscribe, `EvaluateNotifyMeHandler` on `BulletinCreated`, `SendGroupedPushHandler` with a 60 s window. Recipient authorization is re-evaluated in the send handler inside the receipt transaction (ADR-0002 §11); payloads carry identifiers and a generic string only. | vertical-slice |
| 23 | moderation: private report and viewer-local dismissal | Reporting hides the bulletin for the reporter immediately and never discloses the reporter to the author. Dismissal is viewer-local. No strike counts, no aggregation. | vertical-slice |
| 24 | sync: envelope, idempotency, actorship, replay | ADR-0005 envelope; `app.mutation_results` written in the same transaction as the effect; the `bulletin.create` handler. **Actorship is verified before any handler and before version comparison**, so an unrelated actor never receives a conflict envelope. Same ID + same hash → `replayed`; different hash → `IDEMPOTENCY_KEY_REUSE`. | adr |
| 25 | Outbox drainer entrypoint (Node poller) | `FOR UPDATE SKIP LOCKED` claiming, exponential backoff `least(15 min, 5s * attempts^2)`, dead-lettering after 8 attempts, `consumer_receipts` for idempotent consumers (ADR-0006). Two concurrent drainers must claim disjoint sets. Cloudflare cron form follows the M3 verdict. | adr |
| 26 | audit: record entries from slice events | `RecordAuditEntryHandler` consuming the slice's events, covering the ADR-0002 Q4 list. Entries carry internal IDs only — no bulletin content, no contact data. | vertical-slice |
| 27 | web: shell, sign-in, onboarding, graph home | React/Vite PWA shell (warm-desert light theme), magic-link sign-in, onboarding, and graph home rendering the viewer plus 1st-degree connections with pan/zoom. | vertical-slice |
| 28 | web: board, compose Request, person sheet with trust slider | Board list over the authorized query, compose sheet limited to Request, person sheet with the private directional trust slider and its qualitative hints. | vertical-slice |
| 29 | web: Dexie offline store and pending-mutation states | Dexie stores for cached graph/board, pending mutations, and sync metadata; visible pending / failed / conflicted / synchronized badges. No service worker yet. | vertical-slice |
| 30 | Security suite B5–B9 for slice entities | Visibility matrix **including the §6a person-projection sub-case**, trust privacy across success **and conflict/error envelopes**, blocking precursors, hidden-identity payload shape, report privacy. | adr |
| 31 | Security suite B13, B14, B17 | B13 write-path IDOR for every M2 mutation type (zero state change **and** zero outbox rows); B14 `viewerId` provenance via router-type-tree walk; B17 existence-oracle indistinguishability on single-entity fetch. | adr |
| 32 | Playwright e2e for the full §23 slice | One test, two browser contexts, structured as eleven named `test.step()`s matching the eleven flow lines. This test is the M2 exit signal. | vertical-slice |

---

## Handoff

- ACs ready for ac-reviewer (per-milestone Acceptance criteria sections above).
- Implementation → coder (or fast-coder for mechanical scaffold steps M1.1/M1.9, per
  `~/.claude/references/model-selection.md`).
