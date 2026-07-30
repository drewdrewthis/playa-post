# Playa Post — Implementation Plan (empty repo → live)

> **Status:** proposed, 2026-07-30. Supersedes nothing. Governed by
> `docs/engineering/architecture-addendum.md` (normative), then
> `docs/Burner_Trust_Network_Final_Handoff.pdf`, then `docs/product/decisions.md`.
> Architecture decisions referenced as ADR-NNNN live in `docs/adr/`.
> New here? Read `docs/engineering/repo-map.md` first.

## Goal

Deliver Playa Post v1 — a private trust-graph PWA with typed bulletins — from an empty repository to a
live deployment, by proving one production vertical slice end to end before building feature breadth.

## Non-goals

- Any v1-excluded feature (PDF §3): native messaging or comments, likes/ratings/public reputation,
  payments, public people search, groups, native mobile apps, user-facing analytics, E2EE,
  automatic community-wide punishment.
- Private notes / `type:note` — cut by decision D2.
- Multiple notifying saved queries — cut by decision D1 (exactly one Notify Me).
- Microservices, event sourcing, a custom command bus, or a custom query framework (addendum §8, §18).
- Horizontal build-out of all modules before the M2 slice works (PDF §9, addendum §23).
- Performance projections, caches, or materialized views before measurement demands them (ADR-0004 §8).

## Shape of the plan

| Milestone | Outcome | Exit signal |
|---|---|---|
| **M1** | Scaffold: workspace, boundaries, tests, CI, local Supabase | CI green on an empty-but-enforced skeleton; boundary violations fail the build |
| **M2** | The addendum §23 vertical slice, working locally | The full slice passes as one e2e test against a real database |
| **M3** | Runtime spike → ADR-0001 decided | GO/NO-GO recorded with evidence for S1–S10 |
| **M4** | Staging live + observability baseline | The M2 slice passes against deployed staging |
| **M5** | v1 breadth | The §21 scenario matrix is green; v1 scope complete |

M1 → M2 → M3 are sequential. M3's spike may start during M2 (it needs no product code) but must not
gate M2. M5 work items parallelize once M4 lands.

---

## M1 — Scaffold

**Entry criteria:** repository exists with `docs/` and `design/` (satisfied at this commit).

**Goal:** a repository where the architecture rules of the addendum are *executable* — a violation fails
CI rather than a review. Nothing product-facing ships in M1; what ships is the ability to detect drift.

### Work items (one PR each)

| # | Work item | Shape |
|---|---|---|
| M1.1 | pnpm workspace skeleton | `pnpm-workspace.yaml`, root `package.json`, `tsconfig.base.json` (strict, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`), the `apps/web`, `apps/server`, `packages/{contracts,database,observability,configuration,testing}` directories exactly per addendum §3. Empty modules are *not* created — directories appear when a module has behavior (§4). |
| M1.2 | Boundary enforcement | ESLint flat config + `dependency-cruiser` with the §19 rules, plus deliberately-violating fixtures under `tests/fitness/__fixtures__/` and a test asserting each is flagged. `pnpm lint:boundaries`. |
| M1.3 | Test harness | Vitest workspace with `unit` and `integration` projects; `packages/testing` exports a Testcontainers Postgres harness that applies `supabase/migrations` and truncates between tests. |
| M1.4 | Local Supabase + migration flow | `supabase/config.toml`, `migrations/`, `seed/`, `sql/`; `pnpm db:start|db:reset|db:migrate|db:types` (Kysely types generated from the live schema, checked in). First migration creates schema `app`, roles `app_rw`/`app_migrator`, and the ADR-0002 revoke/RLS baseline. |
| M1.5 | Security fitness suite (skeleton) | `tests/security/` with ADR-0002 tests **B1–B4** and **B12** implemented against the M1.4 baseline schema. B5–B11 arrive with the features they guard. |
| M1.6 | CI | GitHub Actions: `typecheck`, `lint`, `lint:boundaries`, `test:unit`, `test:integration` (Testcontainers), `build:web`, `build:server:cloudflare`, `build:server:node`. Required on `main`. Both server builds from day one (ADR-0001 rule 2). |
| M1.7 | Config + observability packages | `packages/configuration`: Zod-validated env, fails fast at boot with the missing key named. `packages/observability`: structured logger with a **redaction allowlist** (log only listed fields) + correlation-ID plumbing. |
| M1.8 | Repo conventions | `CLAUDE.md`, PR template carrying an AC section, `CONTRIBUTING`-level notes in `docs/engineering/repo-map.md`, `.env.example`, secret-scanning hook. |

### Acceptance criteria

- **M1-AC1** `pnpm install && pnpm typecheck && pnpm lint && pnpm test` exits 0 on a clean clone with no
  network access to anything but the registry. *Evidence: terminal transcript of the four commands on a
  fresh clone, exit codes shown.*
- **M1-AC2** A fixture file importing `kysely` from a `modules/*/domain/` path fails `pnpm lint:boundaries`
  with the named rule `no-domain-to-infrastructure`; removing the import makes it pass. Same for all five
  §19 prohibitions: domain→infra, application→transport, transport→persistence, web→server-internals,
  cross-module persistence import. *Evidence: `pnpm lint:boundaries` stdout showing 5 named violations,
  then a clean run — both quoted.*
- **M1-AC3** `pnpm db:reset` on a clean machine applies all migrations and exits 0; `pnpm db:types`
  produces a Kysely schema file with **no diff** against the checked-in one (a drifted schema fails CI).
  *Evidence: `git diff --exit-code packages/database/src/schema.ts` after `pnpm db:types`, exit code 0.*
- **M1-AC4** Security suite B1 passes: connecting as `anon` and as `authenticated` and selecting from
  every table in schema `app` raises SQLSTATE `42501`. *Evidence: vitest output naming each table, plus
  one quoted `permission denied for schema app` error.*
- **M1-AC5** Security suite B3 passes and is **catalog-driven**: it enumerates `pg_class` for schema
  `app` and fails if any table has `relrowsecurity = false`. Proven by adding a table without RLS in a
  scratch migration and observing the failure. *Evidence: the failing run's assertion message naming the
  offending table, then the passing run.*
- **M1-AC6** CI runs all nine jobs on a PR and blocks merge on any failure; both `build:server:cloudflare`
  and `build:server:node` succeed. *Evidence: screenshot or URL of a PR checks list showing 9/9 green.*
- **M1-AC7** Booting the server with a required env var absent exits non-zero within 2 s and prints the
  missing key's name and expected type; it does **not** print any value of any other secret.
  *Evidence: terminal transcript of the failed boot, exit code shown.*
- **M1-AC8** The logger drops non-allowlisted fields: `logger.info({ body: 'secret text', userId: 'u1' })`
  emits a line containing `u1` and **not** containing `secret text`. *Evidence: quoted stdout of the
  emitted JSON line.*
- **M1-AC9** A commit containing a string matching the secret-scanning patterns is rejected by the hook
  and by CI. *Evidence: quoted hook output on a deliberate test commit (not pushed).*
- **M1-AC10 (regression/scope)** No `modules/` subdirectory exists that contains only empty or
  placeholder files (addendum §4: "do not create empty abstractions"). *Evidence:
  `find apps/server/src/modules -type d -empty` returns nothing, plus a reviewer-visible file listing.*

**Done means:** a new agent can clone, run `pnpm install && pnpm db:reset && pnpm test`, and get green;
and any of the five boundary violations fails the build.

---

## M2 — First production vertical slice

**Entry criteria:** M1 exit signal met. ADR-0002, -0003, -0005, -0006, -0007, -0008 read and unchallenged.

**Goal:** implement addendum §23's flow **exactly**, and nothing beyond it:

```text
User signs in
→ creates or opens an invite
→ another user accepts
→ each user may assign private directional trust
→ graph renders the accepted connection
→ one user creates a Request bulletin
→ an eligible viewer sees it
→ Notify Me may produce a grouped notification
→ the viewer may dismiss or privately report it
→ the author archives it
→ one mutation is replayed successfully from offline state
```

### Modules required, and what is deliberately cut from each

| Module | In M2 | Cut to M5 |
|---|---|---|
| **identity** | Supabase magic-link sign-in; `app.users` per ADR-0008; onboarding (handle + display name); actor resolution at the tRPC context boundary | avatars, contact fields + per-field visibility, deactivation, erasure, suspension, reconciliation cron |
| **connections** | create invite (opaque revocable token), open invite, accept; `SetConnectionTrust` (private, directional, `unset` ≠ 0) | invite revocation UI, expiry policy, connection removal, introduction requests, blocking |
| **graph** | `app.visible_people` recursive CTE (ADR-0004) rendering the viewer + accepted 1st-degree connections; disclosure levels present in the read model | ghost/topology-only nodes, degrees ≥ 2, `path_via`, pan/zoom polish, clustering, truncation UI, perf benchmark as a blocking gate |
| **bulletins** | `Request` type only: create, read via authorized board query, archive; lifecycle timestamps + `version` | the other six types, edit, expiry sweep, tags, location, URL detection, drafts (never — none in v1) |
| **views** | **no saved views.** A default board list + the ADR-0007 grammar restricted to `type:` and bare text; **one** Notify Me query (D1) with the same restricted grammar | full grammar (`from: tag: loc: deg: trust: is:`, negation, alternation), saved views CRUD, the notify-bell designation UI, sorts |
| **notifications** | Web Push subscribe; `EvaluateNotifyMeHandler` on `BulletinCreated`; **one** grouped push via a 60 s grouping window | grouping across event families, dedup across devices, digest, preferences, the "one combined notification after a query change" rule |
| **moderation** | private report of a bulletin → immediately hidden for the reporter; viewer-local dismissal | reason taxonomy beyond a single enum, operator console, hide-author, blocking, report withdrawal |
| **sync** | envelope + `mutation_results` + replay for exactly `bulletin.create` (ADR-0005) | full conflict matrix, batching, `expectedVersion` paths, client conflict UI beyond a pending/synced badge |
| **audit** | `RecordAuditEntryHandler` consuming the slice's events | audit views, retention policy, operator search |
| **storage** | **not built** — nothing in the slice uploads a file | avatars, image attachments |

**Frontend in M2:** sign-in, onboarding, graph home (1st degree), board list, compose Request, person
sheet with the trust slider, report/dismiss actions, and the offline pending badge. Warm-desert light
theme only; neon-night dark theme is M5. No PWA install/Workbox yet — offline is Dexie + the pending
queue, so the slice's offline replay is provable without a service worker.

### Work items (one PR each)

| # | Work item |
|---|---|
| M2.1 | Migrations: `users`, `invitations`, `connections`, `connection_trust`, `bulletins`, `dismissals`, `reports`, `notify_me_queries`, `push_subscriptions`, `outbox_events`, `consumer_receipts`, `mutation_results`, `audit_entries` — each with RLS + grants per ADR-0002 |
| M2.2 | `packages/contracts` + tRPC skeleton + auth context (JWT verify → `Actor`), `composition/` per ADR-0003 |
| M2.3 | identity module: onboarding, actor resolution, handle rules |
| M2.4 | connections module: invite create/open/accept, transactional + `ConnectionAccepted` outbox event |
| M2.5 | connections module: `SetConnectionTrust` (directional, private, `unset` distinct) |
| M2.6 | graph module: `visible-people.sql` + `ListVisibleGraphQuery` + read model |
| M2.7 | bulletins module: `CreateBulletinService` + `ArchiveBulletinService` + `BulletinCreated`/`BulletinArchived` events |
| M2.8 | views module: grammar tokenizer + Zod AST + compiler (fields `type:` and text only) + `ListVisibleBulletinsQuery` |
| M2.9 | views module: Notify Me single query storage + `UpdateNotifyMeQuery` |
| M2.10 | notifications module: push subscription, `EvaluateNotifyMeHandler`, `SendGroupedPushHandler`, 60 s grouping window |
| M2.11 | moderation module: `ReportBulletinService` (hides for reporter) + `DismissBulletinService` |
| M2.12 | sync module: envelope, `mutation_results`, `bulletin.create` handler, replay path |
| M2.13 | outbox drainer entrypoint (Node poller form; Cloudflare form arrives with M3's verdict) |
| M2.14 | audit module: `RecordAuditEntryHandler` |
| M2.15 | web: shell, sign-in, onboarding, graph home |
| M2.16 | web: board list, compose Request, person sheet + trust slider |
| M2.17 | web: Dexie offline store, pending-mutation UI states |
| M2.18 | Security suite B5–B9 for the entities that now exist |
| M2.19 | Playwright e2e covering the whole §23 flow with two real users |

### Acceptance criteria

Authorization and privacy first — these are the ones that must not be weakened for schedule.

- **M2-AC1 (slice, end to end)** A single Playwright run drives two browser contexts through every step
  of the §23 flow and passes. *Evidence: Playwright HTML report with the run's step-by-step trace, plus
  the terminal summary line showing 1 passed.*
- **M2-AC2 (auth boundary)** A tRPC call with no token → 401; with a tampered token → 401; with a valid
  token for a user whose onboarding is incomplete → 403 with code `ONBOARDING_REQUIRED`.
  *Evidence: three `curl` transcripts with status lines quoted.*
- **M2-AC3 (trust privacy, B6)** After A sets trust 85 on B, no response body reachable by B or by any
  third party contains `85` in a trust field or a trust field at all — asserted on serialized JSON across
  graph read, board read, person sheet, and the sync response. *Evidence: vitest assertion output naming
  the four endpoints, plus one quoted response body.*
- **M2-AC4 (unset ≠ zero)** A connection with no trust assigned returns `trust: null` (or an explicit
  `unset` marker), never `0`; and a deliberately-set `0` returns `0`. The board filter `trust:unset`
  and `trust:0` select disjoint sets. *Evidence: two quoted API responses + the query result counts.*
- **M2-AC5 (visibility, B5)** A third user with no connection to A or B receives **0 rows** from the
  graph query, **0 rows** from the board query, and 404 on the bulletin by ID. *Evidence: three quoted
  responses with counts/status.*
- **M2-AC6 (transaction atomicity)** With a fault injected after the bulletin insert and before commit,
  `bulletins` and `outbox_events` both contain 0 new rows. *Evidence: two `SELECT count(*)` outputs
  quoted from the integration test.*
- **M2-AC7 (outbox → async consequence)** Creating a Request bulletin that matches the viewer's Notify Me
  query results in exactly one Web Push delivery attempt within the 60 s window, recorded in
  `consumer_receipts`. Two bulletins inside one window produce **one** grouped notification, not two.
  *Evidence: quoted rows from `outbox_events` and `consumer_receipts`, plus the captured push payload.*
- **M2-AC8 (consumer idempotency)** Delivering the same `BulletinCreated` event twice produces exactly one
  notification row and one receipt; the second delivery is a no-op. *Evidence: quoted `SELECT count(*)`
  before/after the duplicate delivery.*
- **M2-AC9 (offline replay)** Submitting the same `bulletin.create` envelope twice produces exactly one
  bulletin; the first response is `applied`, the second `replayed` with an identical `result`.
  Submitting the same `mutationId` with a different payload returns `rejected` /
  `IDEMPOTENCY_KEY_REUSE`. *Evidence: three quoted API responses + `SELECT count(*) = 1`.*
- **M2-AC10 (report privacy, B9)** After viewer V reports author A's bulletin: the bulletin is absent from
  V's board immediately; it is still present for other eligible viewers; and **no** response reachable by
  A contains V's ID, handle, or display name — asserted across bulletin read, notifications, and any
  author-facing endpoint. *Evidence: four quoted responses.*
- **M2-AC11 (dismissal is viewer-local)** V dismissing a bulletin removes it from V's board and leaves it
  present for every other eligible viewer. *Evidence: two quoted board responses.*
- **M2-AC12 (archive lifecycle)** After the author archives, the bulletin disappears from every viewer's
  board and returns 404/`GONE` by ID for non-authors, while remaining visible to the author under
  `is:mine`-equivalent access. Archiving twice is idempotent. *Evidence: quoted responses for author and
  non-author, before and after.*
- **M2-AC13 (grammar rejects, ADR-0007)** `type:note` is rejected with a structured error naming the
  token (D2); an unknown field `foo:bar` is rejected, **not** ignored; a 300-character query is rejected;
  17 terms are rejected. *Evidence: four quoted error responses with the offending token named.*
- **M2-AC14 (filters narrow, never widen — B10)** A board query crafted to reference a bulletin the viewer
  is not authorized to see returns 0 rows and no error leak (no "exists but hidden" signal difference in
  status code or timing shape). *Evidence: quoted response + the equivalent response for a
  genuinely-nonexistent ID, shown identical.*
- **M2-AC15 (no SQL outside persistence — B12)** No SQL string literal exists outside
  `**/persistence/**` and `supabase/**`. *Evidence: quoted output of the fitness test's search, 0 matches.*
- **M2-AC16 (log hygiene)** Running the full e2e flow with log capture produces no log line containing
  the bulletin body text, the invite token, a JWT, or an email address. *Evidence: quoted output of a
  grep for the four seeded canary strings over the captured log file, 0 matches.*
- **M2-AC17 (invite is opaque and revocable)** The invite token is ≥ 128 bits of entropy, is not derived
  from any user ID, and an accepted or revoked token returns `INVITATION_UNAVAILABLE` on reuse.
  *Evidence: quoted token + two quoted responses.*
- **M2-AC18 (failure surface)** Each of these returns a structured error with a stable code and no stack
  or internal detail in the body: accepting your own invite, accepting twice, setting trust on a
  non-connection, reporting your own bulletin, archiving another user's bulletin, subscribing push twice.
  *Evidence: six quoted responses with codes.*
- **M2-AC19 (regression)** The M1 boundary and security suites remain green with the eight new modules
  present — in particular, no module imports another module's persistence layer. *Evidence: `pnpm
  lint:boundaries` + `pnpm test:security` transcripts, exit 0.*

**Done means:** M2-AC1 passes on a machine that is not the author's, with M2-AC2 through AC19 green in CI.

---

## M3 — Runtime compatibility spike

**Entry criteria:** M2 in progress or complete. The spike needs the M2 transaction + push + queue code
paths to exist in some form; use the real ones once M2.7/M2.10/M2.13 have landed.

**Goal:** convert ADR-0001 from `proposed` to a decided target with evidence.

**Scope:** ADR-0001's S1–S10, run from a deployed Worker against a real Supabase staging project.
**Timebox: 5 working days.** Go/no-go criteria and the pre-committed NO-GO fallback (Node on Railway)
are specified in full in `docs/adr/ADR-0001-runtime-and-deployment-target.md` — that ADR is the
authority; this milestone is its execution.

### Work items

| # | Work item |
|---|---|
| M3.1 | Worker entrypoint + tRPC fetch adapter + typed client call (S1) |
| M3.2 | Kysely + driver in `workerd`; atomic domain-write + outbox-write, with a rollback test (S2) |
| M3.3 | Supavisor transaction-mode connectivity under 200 sequential requests + latency capture; test Hyperdrive as mitigation if S3 fails (S3) |
| M3.4 | Supabase JWT validation via WebCrypto/JWKS, four token cases (S4) |
| M3.5 | VAPID Web Push from `workerd` to a real subscription (S5) |
| M3.6 | Cloudflare Queues producer/consumer, retry, DLQ, duplicate delivery (S6) |
| M3.7 | Cron trigger drains the outbox (S7) |
| M3.8 | Composition + cold-start CPU measurement (S8); bundle size and no-patched-deps check (S9) |
| M3.9 | Log/trace export off-Worker with correlation IDs (S10) |
| M3.10 | Write `docs/engineering/spikes/M3-runtime-spike.md`, flip ADR-0001 status, delete the spike branch's throwaway code or promote it into `entrypoints/` |

### Acceptance criteria

- **M3-AC1** `docs/engineering/spikes/M3-runtime-spike.md` exists and contains, for **every** one of
  S1–S10, the criterion, a captured observation (transcript, screenshot, or metric), and PASS/FAIL. No
  row may say "expected to work" or "not tested". *Evidence: the committed file; a reviewer can check
  10/10 rows have an observation.*
- **M3-AC2** ADR-0001's status line reads `accepted — target: Cloudflare Worker` or
  `accepted — target: Node on Railway`, with the deciding criterion named. *Evidence: quoted diff of the
  ADR status line.*
- **M3-AC3 (the no-go path is real, not theoretical)** Whatever the verdict, the M2 slice's e2e test
  passes against **both** a locally-run Node server and — if GO — the deployed Worker. A "go" that leaves
  the fallback unproven is not a go. *Evidence: two Playwright summary lines, one per runtime.*
- **M3-AC4 (S2 is not flaky)** The transaction rollback test runs 50 consecutive times with 50 passes.
  *Evidence: quoted test runner output showing 50/50.*
- **M3-AC5 (no forbidden workarounds — §18)** The lockfile contains no `patchedDependencies`, no
  vendored fork, and no hand-rolled crypto, pool, queue, or migration runner introduced by the spike.
  *Evidence: quoted `pnpm-lock.yaml` patch section (absent) + a listed diff of new dependencies.*
- **M3-AC6 (timebox honored)** The verdict is recorded within 5 working days of the spike branch's first
  commit, or an explicit extension with a stated reason is recorded in the spike doc.
  *Evidence: `git log` first/last commit dates on the spike branch, quoted.*
- **M3-AC7 (boundaries survived)** No file under `modules/*/domain` or `modules/*/application` changed
  during the spike. *Evidence: `git diff --stat main...spike -- 'apps/server/src/modules/*/domain'
  'apps/server/src/modules/*/application'` returns empty, quoted.*

**Done means:** the ADR is decided with evidence, and both runtimes still run the slice.

---

## M4 — Staging live + observability baseline

**Entry criteria:** M2 exit signal met; M3 verdict recorded.

**Goal:** the M2 slice runs on deployed infrastructure a stranger can reach, with enough telemetry to
debug it.

### Work items

| # | Work item |
|---|---|
| M4.1 | Supabase staging project: migrations applied by `app_migrator` in CI, roles/grants/RLS per ADR-0002, secrets in the platform store |
| M4.2 | Frontend deploy: Cloudflare Pages, environment-injected API URL, cache headers |
| M4.3 | API deploy on the ADR-0001 target, with `/health` returning the deployed commit SHA |
| M4.4 | Queue/cron deploy: outbox drainer + the daily prune, per the chosen target |
| M4.5 | CD pipeline: `main` → staging automatically; migrations run before the API rollout; documented rollback |
| M4.6 | Observability baseline: structured logs with correlation IDs, error tracking, RED metrics per tRPC procedure, outbox depth/dead-event gauge, push failure rate |
| M4.7 | Alerts: dead outbox events > 0, error rate > 2 % over 5 min, outbox oldest-pending age > 5 min, staging down |
| M4.8 | Staging smoke: the M2 e2e suite retargeted at staging, run on every deploy |
| M4.9 | Runbook: `docs/procedures/operations.md` — deploy, rollback, rotate secrets, replay a dead event, restore from backup |

### Acceptance criteria

- **M4-AC1** `curl https://<staging-api>/health` returns 200 with a JSON body whose `commit` equals
  `git rev-parse HEAD` on `main`. *Evidence: quoted curl output beside the quoted git SHA.*
- **M4-AC2** The M2 e2e suite passes against staging URLs from a clean CI runner (no local state, no
  seeded fixtures beyond what the test creates). *Evidence: Playwright summary line from the CI job, with
  the staging base URL visible in the run config.*
- **M4-AC3** Pushing a commit to `main` deploys to staging with no manual step, and migrations run before
  the API rollout. *Evidence: CI run URL/screenshot showing the ordered job graph and a green deploy.*
- **M4-AC4 (rollback works, tested not assumed)** A deliberately broken deploy is rolled back using
  `docs/procedures/operations.md` alone, and `/health` returns the previous SHA within 10 minutes.
  *Evidence: two quoted `/health` outputs (broken SHA, then previous SHA) with timestamps.*
- **M4-AC5 (traceability)** A request made from the browser can be found in logs by its correlation ID,
  and its error — if any — links to the same ID in error tracking. *Evidence: screenshot of the log
  search by ID and the matching error record.*
- **M4-AC6 (log hygiene in production config, regression on M2-AC16)** The staging smoke run's logs
  contain none of the four canary strings (bulletin body, invite token, JWT, email).
  *Evidence: quoted grep over the exported staging logs, 0 matches.*
- **M4-AC7 (alerts fire)** Manually inserting a `dead` outbox event triggers the alert to the configured
  channel within 5 minutes. *Evidence: screenshot of the received alert with its timestamp.*
- **M4-AC8 (secrets)** No secret value appears in the repository, in build logs, or in the client bundle;
  `grep` for the staging service key over the built web bundle returns 0 matches.
  *Evidence: quoted grep output over `apps/web/dist`, plus the secret-scan CI job status.*
- **M4-AC9 (staging is not open)** Staging requires a valid invite to sign up; an unauthenticated visitor
  can reach only the sign-in page and no data endpoint. *Evidence: quoted curl of two data endpoints
  returning 401, plus a screenshot of the gated sign-in page.*
- **M4-AC10 (backup restore is real)** A restore of the staging database from an automated backup into a
  scratch project succeeds and the smoke suite passes against it. *Evidence: terminal transcript of the
  restore plus the smoke summary line.*

**Done means:** a URL exists that a non-author can use to complete the slice, and an on-call agent can
diagnose it from the runbook alone.

---

## M5 — Remaining v1 breadth

**Entry criteria:** M4 exit signal met.

**Goal:** complete PDF §3's included scope. Work items are independent after M4 and can run in parallel.
Every item carries the addendum §25 DoD, and every new viewer-scoped query adds a row to ADR-0002's B5
matrix — that is not optional cleanup, it is the item's DoD.

### Work item groups

**A. Bulletins and board breadth**
A1 remaining six types (Offer, Event, Collaboration, Appreciation, Network Update, directed Introduction
Request) with per-type validation · A2 edit (edit does not reset expiry) + `expectedVersion` ·
A3 expiry sweep + archive lifecycle · A4 tags, location, URL detection in body ·
A5 full ADR-0007 grammar (`from: tag: loc: deg: trust: is:`, negation, alternation, quoted phrases) ·
A6 saved views CRUD + suggested defaults (Everything, Offers and Requests, Events, My Bulletins,
Dismissed) + sorts · A7 Notify Me designation UI per D1 (bell moves the single query, with clear
feedback) · A8 Notify Me full matching incl. the "one combined notification after a query change" rule.

**B. Graph and connections breadth**
B1 degrees ≥ 2 with topology-only ghost nodes + surrogate IDs (ADR-0004) · B2 `path_via`, mutual counts,
truncation UI · B3 introduction requests (2nd-degree via a mutual who permits them; no forwarding chain) ·
B4 blocking as a one-way invariant with cache invalidation on sync · B5 connection removal + invite
revocation/expiry · B6 per-field contact visibility + name-visibility thresholds ·
B7 the ADR-0004 performance benchmark promoted to a blocking CI gate.

**C. Notifications**
C1 grouping + dedup across devices and event families · C2 delivery records as a separate subsystem
(never bulletin rows) · C3 subscription lifecycle, expiry, and failure handling · C4 preferences.

**D. Moderation and operator console**
D1 report reasons (commercial spam, misleading, repeated irrelevant posting, harassment, unsafe/illegal,
other) · D2 hide-author, disconnect, block from the report flow · D3 operator console: review reports,
inspect the reported bulletin and metadata, remove content, restrict posting, suspend/disable an account ·
D4 operator actions are audited and produce no user-visible strike count · D5 copy per D3 — no promised
timelines, outcomes, or juries.

**E. Identity, privacy, GDPR**
E1 avatars via private storage buckets + `storage` module · E2 deactivation (reversible) ·
E3 GDPR erasure per ADR-0008, irreversible, transactional, with `UserErased` · E4 data export ·
E5 auth↔app reconciliation cron · E6 privacy notice + the pseudonymous-audit statement.

**F. Offline and sync**
F1 the full ADR-0005 conflict matrix, one integration test per row · F2 conflict UI (pending / failed /
conflicted / synchronized) · F3 cache invalidation on block, erasure, and revoked authorization ·
F4 batch submission + per-actor ordering · F5 `mutation_results` retention + the `expired` outcome.

**G. Platform and quality**
G1 PWA: Workbox/vite-plugin-pwa, install, offline shell · G2 neon-night dark theme + theme persistence ·
G3 the §21 e2e scenario matrix, complete · G4 accessibility pass (keyboard, contrast, reduced motion —
the graph is motion-heavy) · G5 first-class public API documentation with the same authorization rules
as the PWA · G6 load test at target scale.

### Acceptance criteria

- **M5-AC1 (the §21 matrix, complete)** An e2e scenario test exists and passes for each of the twelve
  addendum §21 rows: invite and connection acceptance; directional trust changes; graph visibility;
  hidden identities; blocking; bulletin visibility; bulletin reporting; viewer-controlled dismissal and
  author hiding; Notify Me matching; offline mutation replay; event idempotency; account erasure.
  *Evidence: test-runner output listing all twelve scenario names as passed — the names must map 1:1 to
  the twelve rows, quoted.*
- **M5-AC2 (blocking is total)** After A blocks B: no graph path routes through the blocked edge in
  either direction; no bulletin of either is exposed to the other; directed requests fail closed;
  no notification is delivered; no contact field is exposed; B is not told; and B's cached data is purged
  on next sync. *Evidence: one scenario test asserting all seven, with the assertion list quoted.*
- **M5-AC3 (hidden identities, B8)** A topology-only node's serialized payload contains no name, handle,
  avatar, role, or the person's internal ID, and its surrogate ID differs for two different viewers of the
  same hidden person. *Evidence: two quoted payloads from two viewers, showing different surrogates and
  no identity fields.*
- **M5-AC4 (erasure, B11)** After erasure: the user's bulletins, reports, dismissals, views, Notify Me
  query, push subscriptions, contact fields, display name, and avatar are gone from every read path;
  trust values *others* set on them are deleted; the handle is tombstoned and not re-issuable; the
  Supabase auth user is deleted; audit rows retain only the internal ID. A queued offline mutation
  referencing them returns `GONE`. *Evidence: quoted `SELECT` results per table + one quoted API response.*
- **M5-AC5 (conflict matrix)** Every row of ADR-0005's matrix has a named integration test; a
  `bulletin.update` with a stale `expectedVersion` returns `conflict` with `currentVersion` and
  `currentState` and does **not** modify the row. *Evidence: test names listed against matrix rows, plus
  one quoted conflict response and a `SELECT` proving the row is unchanged.*
- **M5-AC6 (notification grouping and dedup)** Ten matching bulletins inside one grouping window produce
  exactly one notification; the same notification is not delivered twice to two devices of the same user
  as two separate alerts; delivery records live in the notifications tables, not in bulletin rows.
  *Evidence: quoted counts from the notifications tables + the captured push payloads.*
- **M5-AC7 (Notify Me is singular — D1)** Attempting to create a second Notify Me query fails at the
  database constraint; toggling the bell on view B moves the query from view A and the UI states that it
  moved. *Evidence: quoted constraint-violation error + a screenshot of the moved-bell feedback.*
- **M5-AC8 (no reputation surface — PDF principle 7)** No API response and no UI surface exposes a
  count of reports, a strike count, a rating, a follower count, or any aggregate popularity signal for a
  person or bulletin. *Evidence: a fitness test grepping response schemas for the forbidden field names,
  0 matches, quoted; plus a reviewer walkthrough of the report and person surfaces.*
- **M5-AC9 (operator moderation, D3)** An operator can review a private report, see the reported bulletin
  and metadata, and remove content / restrict posting / suspend an account; the reported user is never
  shown the reporter; each operator action writes an audit entry; and no automatic global penalty exists.
  *Evidence: screenshots of the console performing each of the three actions + quoted audit rows.*
- **M5-AC10 (search never touches people — PDF §4)** Free-text board search over a term matching only an
  author's display name returns 0 bulletins; `from:` over a non-authorized author returns 0 rows and
  does not disclose that the person exists. *Evidence: two quoted responses.*
- **M5-AC11 (offline states are visible)** The UI renders distinct, labelled states for pending, failed,
  conflicted, and synchronized mutations. *Evidence: four screenshots, one per state.*
- **M5-AC12 (perf gate)** The graph read p95 is under 300 ms at the ADR-0004 synthetic scale, enforced as
  a blocking CI job. *Evidence: quoted benchmark output with the p95 figure and the job's pass status.*
- **M5-AC13 (a11y)** The board and person sheet pass an automated axe scan with zero critical/serious
  violations, and the graph is fully operable by keyboard with `prefers-reduced-motion` honored.
  *Evidence: quoted axe summary + a screen recording or transcript of the keyboard walkthrough.*
- **M5-AC14 (API parity)** The public API enforces identical authorization to the PWA: the B5 visibility
  matrix is run a second time through the public API surface with identical expected results.
  *Evidence: the matrix test output for both surfaces, quoted side by side.*
- **M5-AC15 (regression)** The full M1–M4 AC set still passes on `main` at M5 completion.
  *Evidence: CI run URL with all jobs green.*

**Done means:** PDF §3's included list is implemented, the §21 matrix is green, and no excluded feature
has crept in.

---

## Alternatives considered (plan level)

| Alternative | Why not |
|---|---|
| **Build modules horizontally, then integrate** | Explicitly forbidden (addendum §23, PDF §9). Integration risk lands last, when it is most expensive, and none of the twelve things the slice must prove get proven until the end. |
| **Decide the runtime before writing code (M3 before M2)** | The spike is only meaningful against real transaction, push, and queue code. Spiking against toy code proves nothing about S2/S5/S6, which are the criteria most likely to fail. |
| **Skip M1's fitness functions, review boundaries manually** | The addendum's boundary rules are the main thing an agent-driven build will erode. A rule that is not executable is a suggestion. M1.2 is cheap and permanent. |
| **Ship to production, not staging, at M4** | A live private network implies real invitations and real data before erasure, blocking, and moderation exist (all M5). Staging first; production gates on M5's D and E groups. |
| **Use Supabase RLS as the enforcement mechanism** | See ADR-0002 for the full argument. |
| **Defer ADRs until the choices bite** | The PDF's implementation mandate requires an implementation plan and initial ADRs *before* consequential infrastructure choices. |
| **One big M2 PR** | Unreviewable, and it hides boundary erosion. M2 is 19 PRs for that reason. |

## Risks

| # | Risk | Severity | Mitigation | One-way door? |
|---|---|---|---|---|
| R1 | Supabase pooler + Kysely transactions are unreliable in `workerd` (spike S2/S3) | High | Pre-committed Railway fallback; both entrypoints built in CI from M1 | No |
| R2 | A subtly duplicated visibility predicate leaks data | **Critical** | ADR-0002 single-definition rule + the B5–B11 matrix, extended per new query as a DoD item | No, but a leak is not undoable |
| R3 | Recursive-CTE graph performance degrades non-linearly | Medium | Measure from M2 (non-blocking) and gate in M5; incremental loading before caching | No |
| R4 | GDPR erasure shape is hard to change once real users are erased | Medium | Erasure test written before erasure code; tombstone shape fixed in ADR-0008 | **Yes** — erasure is irreversible by design |
| R5 | The graph surrogate key (ADR-0004) is rotated, shuffling every ghost layout | Low | Documented "do not rotate" note in platform secrets | **Yes** in effect |
| R6 | Notification grouping produces duplicate or missing pushes under retry | Medium | `consumer_receipts` + the double-delivery test (M2-AC8) | No |
| R7 | Scope creep into excluded v1 features (messaging via notes, reputation via report counts) | Medium | D2 already cut notes; M5-AC8 is a standing fitness test against reputation surfaces | No |
| R8 | Agent-driven implementation erodes module boundaries over many PRs | High | M1.2 fitness functions + M2-AC19 regression AC + boundary check in every PR template | No |
| R9 | The M3 timebox slips and blocks M4 | Medium | Fallback is pre-committed; slipping past 5 days is itself the trigger to take Node | No |
| R10 | Two-user flows are under-tested because e2e is expensive | Medium | M2-AC1 uses two browser contexts from the start; every privacy AC is inherently multi-actor | No |

## Escalations for the product owner (addendum §24)

These three change user-visible behavior or the trust model and are **not** routine implementation
details. Proposed resolutions are stated; each proceeds as proposed unless the owner objects.

1. **Edges between two other people render at uniform weight** (ADR-0004 §5). The prototype varies edge
   thickness by trust for *every* edge, including edges the viewer is not party to. Deriving those
   weights requires reading third parties' private directional trust, which contradicts *"One person's
   trust value is never exposed to the other person or third parties"* (PDF §4). Proposed: only edges
   incident to the viewer carry weight. **Visible change to the graph's look.**
2. **Free-text board search does not match author names** (ADR-0007). The prototype includes author name
   in the text haystack; at scale that is people search through the text channel, which the PDF forbids.
   Proposed: `from:` covers author narrowing, bounded to already-authorized authors. **Visible change to
   search behavior.**
3. **Handles are immutable in v1** (ADR-0008 rule 4). The PDF says the handle is "stable" without saying
   whether users may change it. Proposed: immutable, operator-assisted change only, old handles
   tombstoned — because a re-issued handle is an impersonation vector in a recognition-based network.
   **Constrains a user-facing capability.**

Also flagged, decided but worth the owner knowing: **staging is not production.** Production launch is
gated on M5's moderation (D) and privacy/erasure (E) groups, because inviting real people into a private
trust network without blocking, erasure, and an operator console is a safety gap, not a scope trade.

---

## Appendix — Proposed GitHub issues for M1 + M2

Not filed. Labels: `feature`, `adr`, `vertical-slice`, `bug`.

### M1

| # | Title | Body | Label |
|---|---|---|---|
| 1 | Scaffold pnpm workspace per addendum §3 | Create `pnpm-workspace.yaml`, root `package.json`, strict `tsconfig.base.json`, and the `apps/*` + `packages/*` directories exactly as specified in addendum §3. Do not create empty module directories — §4 forbids placeholder layers. | feature |
| 2 | Enforce module boundaries with dependency-cruiser + ESLint | Implement the five §19 prohibitions as executable rules. Add deliberately-violating fixtures under `tests/fitness/__fixtures__/` and a test asserting each is flagged by name. Exposed as `pnpm lint:boundaries`. | feature |
| 3 | Vitest workspace + Testcontainers Postgres harness | Two Vitest projects (`unit`, `integration`). `packages/testing` exports a harness that starts Postgres, applies `supabase/migrations`, and truncates between tests. | feature |
| 4 | Local Supabase dev + migration and type-generation flow | `supabase/config.toml`, `migrations/`, `seed/`, `sql/`; `pnpm db:start|reset|migrate|types`. Kysely types are generated and checked in; CI fails on drift. | feature |
| 5 | Baseline security migration: schema `app`, roles, grants, RLS | Per ADR-0002: create schema `app`, roles `app_rw` (NOSUPERUSER NOBYPASSRLS) and `app_migrator`, revoke from `anon`/`authenticated`/`PUBLIC`, enable RLS with the named `app_rw_full_access` policy. | adr |
| 6 | Security fitness suite B1–B4, B12 | Implement ADR-0002's bypass tests that are checkable before features exist: role denial, PostgREST unreachability, catalog RLS assertion, SECURITY DEFINER allowlist, no-SQL-outside-persistence. Must fail loudly when a new table skips RLS. | feature |
| 7 | GitHub Actions CI with both server builds | Jobs: typecheck, lint, lint:boundaries, test:unit, test:integration, build:web, build:server:cloudflare, build:server:node, secret-scan. Required on `main`. Both server builds are the ADR-0001 §22 fitness function. | feature |
| 8 | `packages/configuration` — fail-fast validated env | Zod-validated environment config. Boot fails within 2 s naming the missing key and its expected type, without printing any other secret's value. | feature |
| 9 | `packages/observability` — redacting structured logger | Structured logger with an allowlist-based redaction policy (log only listed fields) plus correlation-ID plumbing. A test asserts a non-allowlisted field never reaches stdout. | feature |
| 10 | Repo conventions: CLAUDE.md, PR template, secret scanning | `CLAUDE.md` pointing at the addendum and repo map; PR template with an AC + evidence section and a boundary checkbox; pre-commit secret scanning matching CI. | feature |

### M2

| # | Title | Body | Label |
|---|---|---|---|
| 11 | Schema migrations for the vertical slice | All thirteen M2 tables with RLS, grants, indexes, and `version` columns where ADR-0005 requires them. One migration per logical group; each reviewable independently. | vertical-slice |
| 12 | tRPC skeleton, contracts package, and auth context | `packages/contracts`, the tRPC root, and the context boundary that verifies the Supabase JWT and resolves an `Actor` per ADR-0008 rule 8. No JWT or Supabase client reaches an application service. | vertical-slice |
| 13 | Composition root via explicit factories | Implement ADR-0003: `container.ts`, `request-scope.ts`, `registrations.ts`, with a dependency-cruiser rule restricting container imports to `entrypoints/` and `composition/`. | adr |
| 14 | identity: onboarding and actor resolution | Magic-link sign-in, handle rules (citext unique, charset, reserved blocklist, confusable check), display name, `app.users` per ADR-0008. Incomplete onboarding returns `ONBOARDING_REQUIRED`. | vertical-slice |
| 15 | connections: invite create / open / accept | Opaque revocable invite token (≥128 bits, not derived from any ID). Acceptance is transactional and emits `ConnectionAccepted`. Reuse of a spent or revoked token returns `INVITATION_UNAVAILABLE`. | vertical-slice |
| 16 | connections: private directional trust | `SetConnectionTrust` — directional, private, viewer-owned. `unset` is distinct from `0` and modelled as NULL. Emits `ConnectionTrustChanged`. Never exposed to the other party or third parties. | vertical-slice |
| 17 | graph: `visible_people` recursive CTE + read model | Checked-in SECURITY INVOKER SQL function per ADR-0004, limited in M2 to the viewer plus accepted 1st-degree connections, with disclosure levels present in the read model. Blocks prune inside the recursive term. | vertical-slice |
| 18 | bulletins: create and archive a Request | `CreateBulletinService` and `ArchiveBulletinService` with lifecycle timestamps, `version`, and `BulletinCreated`/`BulletinArchived` outbox events written in the same transaction. Request type only. | vertical-slice |
| 19 | views: query grammar tokenizer, Zod AST, and SQL compiler | ADR-0007, restricted in M2 to `type:` and bare text. Unknown fields, over-length input, and >16 terms are rejected with the offending token named — never ignored. Compiles to parameterized SQL over the authorized CTE. | adr |
| 20 | views: single Notify Me query | One row per user enforced by a primary key on `owner_id` (decision D1 as a constraint). Stores source text plus validated AST with `ast_version`. `UpdateNotifyMeQuery` emits `NotifyMeQueryChanged`. | vertical-slice |
| 21 | notifications: push subscription and grouped Notify Me delivery | Web Push subscribe, `EvaluateNotifyMeHandler` on `BulletinCreated`, `SendGroupedPushHandler` with a 60 s grouping window. Delivery records are their own subsystem, never bulletin rows. | vertical-slice |
| 22 | moderation: private report and viewer-local dismissal | Reporting hides the bulletin for the reporter immediately and never discloses the reporter to the author. Dismissal is viewer-local. No strike counts, no aggregation. | vertical-slice |
| 23 | sync: mutation envelope, idempotency, and replay | ADR-0005 envelope, `app.mutation_results` written in the same transaction as the effect, and the `bulletin.create` handler. Same ID + same hash → `replayed`; same ID + different hash → `IDEMPOTENCY_KEY_REUSE`. | vertical-slice |
| 24 | Outbox drainer entrypoint (Node poller) | `SELECT … FOR UPDATE SKIP LOCKED` claiming, exponential backoff, dead-lettering after 8 attempts, and `consumer_receipts` for idempotent consumers, per ADR-0006. Cloudflare cron form follows the M3 verdict. | adr |
| 25 | audit: record entries from slice events | `RecordAuditEntryHandler` consuming the slice's events. Entries carry internal IDs only — no bulletin content, no contact data. | vertical-slice |
| 26 | web: shell, sign-in, onboarding, graph home | React/Vite PWA shell with the warm-desert light theme, magic-link sign-in, onboarding, and the graph home rendering the viewer plus 1st-degree connections with pan/zoom. | vertical-slice |
| 27 | web: board, compose Request, person sheet with trust slider | Board list over the authorized query, the compose sheet limited to Request, and the person sheet with the private directional trust slider and its qualitative hints. | vertical-slice |
| 28 | web: Dexie offline store and pending-mutation states | Dexie stores for cached graph/board, pending mutations, and sync metadata; visible pending / failed / conflicted / synchronized badges. No service worker yet. | vertical-slice |
| 29 | Security suite B5–B9 for slice entities | Extend ADR-0002's bypass tests to the entities that now exist: visibility matrix, trust privacy, blocking precursors, hidden-identity payload shape, report privacy. | feature |
| 30 | Playwright e2e for the full §23 slice | One test, two browser contexts, covering sign-in → invite → accept → trust → graph → Request bulletin → eligible view → grouped notification → dismiss/report → archive → offline replay. This test is the M2 exit signal. | vertical-slice |

---

## Handoff

- ACs ready for ac-reviewer (see the per-milestone Acceptance criteria sections above).
- Implementation → coder (or fast-coder for mechanical scaffold steps M1.1/M1.8, per
  `~/.claude/references/model-selection.md`).
