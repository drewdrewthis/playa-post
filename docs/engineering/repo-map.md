# Repo map — orientation for anyone (human or agent) arriving cold

**Read this first. Then read `docs/engineering/architecture-addendum.md`, which is normative and wins
every argument.** This page tells you where things are and how to run them; it does not restate rules.

## What this product is

Playa Post (Burner Trust Network): a private, opt-in community network. Real-world relationships form a
navigable trust graph; short typed bulletins (offers, requests, events, collaboration, appreciation,
network updates, introduction requests) sit on top of it. The graph is home; the board is secondary.
Trust is **private, directional, and viewer-owned**. There is no public reputation, no people search, and
no messaging. It works offline.

## Documents, in precedence order

| Order | Document | What it is |
|---|---|---|
| 1 | `docs/engineering/architecture-addendum.md` | **Normative** architecture. Structure, boundaries, DI, CQRS-lite, outbox, testing, deployment, DoD. |
| 2 | `docs/Burner_Trust_Network_Final_Handoff.pdf` | Product handoff: principles, scope, UX, data concepts, privacy/moderation rules. |
| 3 | `docs/product/decisions.md` | Settled product decisions D1–D3 resolving spec↔prototype conflicts. |
| 4 | `design/Playa Post.dc.html` | The settled UX prototype. **Product evidence, not architecture.** Never copy its structure — but the deployed UI *must* match it visually (launch DoD clause 5). |
| — | `docs/product/launch-definition-of-done.md` | **Owner-stated and normative.** What "v1 is done" means: live, not mocked, real seed data, user-perspective E2E on the deployed app, visually correct vs the prototype, feature complete — with an independent QA sign-off gate. |
| — | `docs/engineering/implementation-plan.md` | Milestones M1–M6 with acceptance criteria, risks, and the open owner escalations E1–E6. Where the work is going. |
| — | `docs/engineering/m2-lane-briefs.md` | M2 broken into seven sequenced implementation lanes: scope, migrations owned, module layout, what each lane must not touch, and its gate. Subordinate to the plan. |
| — | `docs/adr/` | Architecture Decision Records. Read the index in `docs/adr/README.md`. |
| — | `docs/engineering/reviews/` | Review findings that shaped the plan and ADR-0002 (AC review; ADR-0002 stress test). |
| — | `docs/engineering/ac-index.md` | Generated: every AC → the CI job or manual procedure that proves it. |
| — | `docs/procedures/` | Operational runbooks (deploy, rollback, secret rotation, replaying a dead outbox event, `app_migrator` break-glass). Created in M4. |

If the PDF and the addendum disagree, the addendum wins. If the prototype and either disagree, the
prototype loses on *architecture* — but the prototype remains the visual target. Decisions D1–D3 record
three resolutions already made — do not reopen them. Six escalations (E1–E6) are open with the owner and
carry proposed defaults that proceed unless objected to; see the end of the implementation plan.

## Where code lives

```text
apps/web/        React + Vite PWA. Feature-oriented: src/features/{identity,connections,graph,
                 bulletins,views,notifications,moderation,sync}/{api,components,hooks,model,routes,
                 state,tests}. Shell/router/providers/auth/api client/offline queue in
                 src/app/{routes,auth,api,offline,shell} (the M2 frontend). Shared UI in src/shared/.
                 A screen whose pieces outgrow one route file gets a sibling feature directory —
                 src/app/{people,notifications,bulletins,graph,moderation,profile}/ — holding its
                 components, its own <feature>.css, and any pure logic worth unit-testing on its
                 own (src/app/bulletins/
                 is the board: card, detail sheet, search bar, the query builder and the relative-time
                 formatter; src/app/graph/ is the network canvas: graph-layout.ts seeded from person
                 ids, graph-viewport.ts pan/zoom arithmetic, graph-node-identity.ts §6a for dots,
                 graph-counts.ts, graph-network.tsx, graph-viz.css; src/app/moderation/ is the report
                 sheet and what the board says when a hide fails: report-abuse-draft.ts holds the
                 reason vocabulary and the send gate, report-abuse-sheet.tsx renders them,
                 hide-failure.ts turns a refused or undelivered moderation.report/moderation.dismiss
                 into a message plus whether a retry can work and whether the card belongs back,
                 hide-failure-notice.css styles the notice board.tsx renders from it).
                 A feature stylesheet is imported
                 by the component that owns it, never added to screens.css.
                 ⚠ The unit project runs in environment: 'node' and there is no component-test
                 harness, so logic left inside a component is logic no test can reach — extract it
                 to a sibling module, as compose-bulletin-draft.ts, report-abuse-draft.ts and
                 auth/sign-in-failure.ts all do.
                 src/app/theme/ is the design system: tokens.css (two token sets, light on :root and
                 dark on [data-theme='dark']), screens.css (the column and every shared screen
                 element), typefaces.ts (the self-hosted font imports, which double as the service
                 worker's precache budget), and the theme provider/toggle — ADR-0015. Values come
                 from design/Playa Post.dc.html, which is product evidence and never imported.
apps/server/     The modular monolith.
  composition/   The ONLY place that knows about the object graph, and the only place that reads
                 process.env (ADR-0003). config.ts · container.ts · request-scope.ts ·
                 supabase-jwks-url.ts; registrations.ts arrives with the first module.
  entrypoints/   http/ · outbox-drainer/ · notification-flush/ (ADR-0006 — two in-process pollers,
                 no separate queue or cron facility; ADR-0009 retired the Cloudflare dual-target this
                 line used to describe). The ONLY place that knows about the runtime (ADR-0009).
  modules/       identity · connections · graph · bulletins · views · notifications · moderation ·
                 sync · storage · audit. Each: transport/ application/ domain/ persistence/ tests/
                 plus a <name>.module.ts. (Addendum §4 — a module only grows the directories it needs:
                 modules/graph has no domain/, because ADR-0004 decision 7 makes the graph a read
                 model rather than an aggregate; modules/views was domain/ + tests/ alone while the
                 board grammar was all it shipped, and gained application/ persistence/ transport/ with
                 Notify Me in M2.10 — its <name>.module.ts is now a factory as well as a barrel. Saved
                 views (app.saved_views, views.saved.*) landed there too, ahead of M5, with the
                 comp's per-view bell modelled as a pointer FROM app.notify_me_queries so decision
                 D1's "exactly one Notify Me query per user" stays a primary key: ADR-0016.)
                 A module MAY also grow an infrastructure/ for a
                 non-persistence adapter — modules/connections/infrastructure/ holds the node:crypto
                 CSPRNG behind the invite-token port, and modules/notifications/infrastructure/ holds
                 the Web Push transport, because domain/ and application/ may not import a Node builtin
                 and persistence/ is the one directory domain/ may never import (ADR-0012). A module that
                 owns a database function checks its source in at persistence/sql/ and carries a
                 byte-identical copy in the migration that installs it — modules/graph's
                 visible-people.sql and visible-edges.sql, and modules/bulletins'
                 visible-bulletins.sql, each pinned by a verbatim-containment assertion
                 (ADR-0004:73-74). Re-installing one is a NEW migration carrying the new text,
                 never an edit to the old one; a function whose `returns table` shape changed has
                 to be DROPped there first, because `create or replace` refuses it.
  shared/        auth (Actor, branded ViewerId, JWT verification — ADR-0011) · trpc (initTRPC, the
                 root router, the request context) · errors · health. events/logging/transactions
                 arrive with the code that needs them.
packages/        contracts · database · observability · configuration · testing. contracts/src/*.ts
                 is the declared wire surface (ADR-0014) — the only legal import from apps/web
                 into the server side.
supabase/        migrations/ · sql/ · seed/ · tests/.
scripts/         Repo tooling.
tests/           fitness/ (executable architecture rules) · security/ (ADR-0002 bypass suite) ·
                 integration/ (root-level cross-module integration tests) · e2e/ (Playwright
                 browser proof: spec + global-setup + support harness). tests/integration/ is
                 the legal place to import composition/container.ts outside apps/ — dependency-
                 cruiser cruises only apps/ and packages/, so a container import under
                 apps/*/tests would trip no-container-outside-composition; here it does not.
```

**Do not create a package because code *could* be shared** (addendum §3). Code stays in its owning app
or feature until a real cross-runtime dependency exists.

## The dependency direction (memorize this)

```text
tRPC procedure → application service → domain behavior/policy → repository interface → PostgreSQL
                                                                       ↑
                                                              infrastructure implements
```

Allowed: `Transport → Application → Domain ← Infrastructure`.

## Boundary rules — these are executable, not advisory

`pnpm boundaries` (dependency-cruiser + ESLint) fails the build on:

| Rule | Meaning |
|---|---|
| `no-domain-to-infrastructure` | domain **and application** must not import tRPC, React, Kysely, Supabase, Fastify, a **Node builtin**, hosting-provider APIs, HTTP types, DB row types, or logging implementations |
| `no-application-to-transport` | application services must not touch request/response objects |
| `no-transport-to-persistence` | routers never call repositories or the database |
| `no-web-to-server-internals` | `apps/web` may import `packages/contracts`, nothing else from the server |
| `no-cross-module-persistence` | a module must not import another module's persistence, internal domain entity, private service, SQL, test helper, or internal transport schema |
| `no-container-outside-composition` | only `entrypoints/` and `composition/` may import the container |
| `no-sql-outside-persistence` | SQL literals and `sql` fragments only in `**/persistence/**` (and `supabase/**`, which is SQL by definition) |

Deliberately-violating fixtures live in `tests/fitness/__fixtures__/` (dependency-cruiser's, one
directory per rule) and `tests/fitness/sql-fixtures/` (the SQL walker's — kept separate because
`boundaries.fitness.test.ts` asserts every directory in `__fixtures__/` is named after a
dependency-cruiser rule). A test asserts each fixture is still caught. If you find yourself wanting to
add an exception, that is the signal to change the design, not the rule.

**All seven are live as of M2.4 (lane L1).** The first six are dependency-cruiser rules in
`.dependency-cruiser.cjs`, each proven by its own fixture. **`no-sql-outside-persistence` is not one of
them**: it is a rule about SQL *literals and `sql` fragments* rather than an import edge, so it is a
TypeScript-AST walker (`tests/fitness/find-sql-outside-persistence.ts`) driven by
`no-sql-outside-persistence.fitness.test.ts` — the same reasoning `find-viewer-identifier-inputs.ts`
used for B14. It landed with the first repository, because a rule configured against nothing is the
empty abstraction §4 forbids and reports green forever.

Its scope is `apps/server/src/**` minus `persistence/` minus tests. `packages/**` is out of scope on
purpose: those are libraries rather than layered modules, and `packages/database` and
`packages/testing` both run SQL by design.

All commands below now work, including `test:e2e` (M2, lane L5) — a **tenth**, advisory-only CI
job not in branch protection (see `CLAUDE.md`). `pnpm install/dev/build/build:web/
build:server:node/typecheck/lint/boundaries/test/test:unit/test:integration/test:security/
test:e2e` plus the `db:*` family (`db:start/db:stop/db:reset/db:migrate/db:types`, completed by
M1b.1). The script is `pnpm boundaries`
— one name, no alias; the CI *job* that runs it is named `lint:boundaries`.

Cross-module interaction goes through: a small public application interface, a published event, a shared
contract with clear ownership, or a coordinating application service. Never a direct reach-in.

## Security model in one paragraph

Authentication is Supabase (magic link), verified at the tRPC boundary and mapped to an **internal**
user ID (ADR-0008). Authorization is **server-side and authoritative** (ADR-0002): product tables live in
schema `app`, which is not exposed to PostgREST; the API connects as a least-privileged, non-owning
`app_rw` role; RLS is `ENABLE`d **and `FORCE`d** everywhere as a deny-by-default backstop with one exact
`app_rw_full_access` policy per table; and every viewer-scoped read passes a **branded `ViewerId`** —
constructible only from the authenticated `Actor`, never from request input — into a checked-in
`SECURITY INVOKER` visibility function. Unauthorized and non-existent are indistinguishable. Operator
reads are the single sanctioned bypass, on their own read-only role and entrypoint, audited per read.
The client may hide things for usability, but client checks are never authoritative and hidden data must
never reach the client (addendum §15).

**`tests/security/` (B1–B18) is the control, not a test suite** — ADR-0002 deliberately gives up
database-enforced viewer visibility, so this suite is what replaces it. `b-rows.manifest.json` declares
all eighteen rows; a row that is neither implemented nor explicitly marked `pending: <milestone>` fails
the job. Read ADR-0002 before touching anything in `tests/security/`.

The suite runs against **two** harnesses, both from `@playa-post/testing`, because its rows are not all
the same shape:

| Harness | Rows | What it boots |
|---|---|---|
| `startPostgresTestDatabase()` | B1, B3, B4 — catalog and privilege facts | `postgres:17` with `supabase/migrations` applied |
| `startSupabaseRestTestStack()` | B2 — a statement about the **REST layer**, which bare Postgres does not have | the same database plus Supabase's PostgREST image, started with the `[api] schemas` list read from `supabase/config.toml` |

[ADR-0010](../adr/ADR-0010-supabase-rest-security-harness.md) records why the second one is a
purpose-built pair rather than `supabase start`'s ten containers, and why it mints its own JWTs instead
of running GoTrue. The exposure list is an **input** to the server under test, never the subject of an
assertion: add `"app"` to `[api] schemas` and B2 goes red because the schema becomes reachable, not
because a string stopped matching.

## How to run it

```bash
pnpm install
pnpm db:start          # local Supabase
pnpm db:reset          # drop, re-apply every migration, re-seed
pnpm db:migrate        # or: apply only the migrations not yet applied
pnpm db:types          # regenerate Kysely types (checked in; CI fails on drift)
pnpm dev               # web + server
```

## How to test it

```bash
pnpm typecheck
pnpm lint
pnpm boundaries        # architecture fitness functions
pnpm test:unit         # domain + application, no infrastructure
pnpm test:integration  # Testcontainers Postgres, real SQL
pnpm test:security     # ADR-0002 bypass suite
pnpm test:e2e          # Playwright, multi-user scenarios
pnpm test              # everything
```

Test at the narrowest useful level (addendum §21). Domain tests: state transitions, invariants, policies,
conflict rules. Application tests: authorization, coordination, transactions, events, failures.
Repository integration tests: SQL correctness, recursive graph behavior, visibility, concurrency,
idempotency. E2E: critical user flows. **Prefer observable behavior and state over method-call
assertions**, and unit tests instantiate classes directly rather than resolving from the container.

## Deployment

The backend is the **Node server bundle on Render's free plan** — ADR-0009, an owner decision that
supersedes ADR-0001 and its M3 spike. `render.yaml` at the repo root is the service definition: free
plan, `frankfurt` (nearest the Supabase project), Node 22, health check on `/healthz`, `autoDeploy`
off because M4.5 gates rollout on B18. Static frontend hosting is unchanged and not decided by ADR-0009.

Portability (addendum §22) is still real, but it is carried by the boundary rules rather than by
building a second bundle: runtime-specific code belongs only in `entrypoints/` and infrastructure
adapters, so changing host or server library is a diff to `main.ts`, `http-server.ts`, and `render.yaml`.
The outbox table, not the queue, is the delivery record (ADR-0006), so delivery scheduling stays an
entrypoint detail too — in M2 that is an in-process Node poller.

## Before you call something done

Addendum §25, in full — behavior implemented; authorization enforced server-side; module boundaries
preserved; domain and application responsibilities separated; persistence covered by integration tests;
important state changes emit transactional outbox events; offline behavior defined where applicable;
errors structured and observable; logs free of sensitive content; docs and ADRs updated when the
architecture changes; proven libraries over custom infrastructure; SOLID with attention to SRP and
dependency inversion.

Plus, in this repo specifically:
- a new viewer-scoped query adds a row to the ADR-0002 **B5** matrix **and** composes the shared
  authorized-set CTE (B12 fails the build otherwise);
- a new offline mutation type adds a row to the ADR-0005 conflict matrix **and** a **B13** write-path
  IDOR row proving zero state change and zero outbox rows for an unrelated actor;
- a new grammar field adds a row to the ADR-0007 table plus a golden-file test;
- a new person representation in any payload is projected through `app.visible_people`'s disclosure
  level (ADR-0002 §6a) — never built by joining `app.users` directly;
- no new field carries sensitive content into a log line, a span attribute, a queue payload, or a push
  payload (PDF §6, ADR-0002 Q3/§11);
- every AC in the plan is mapped in `docs/engineering/ac-index.md`, or CI fails.

And for v1 as a whole, `docs/product/launch-definition-of-done.md` is the terminating bar: live, not
mocked, real seed data, user-perspective E2E on the deployed app with captured evidence, visually correct
against the prototype, feature complete per PDF §3 as modified by `decisions.md` — signed off by a QA
pass independent of the implementers. Plan milestone M6 exists to satisfy exactly that, clause by clause.

## Decision-making

Choose the simplest proven implementation when a detail is left open (addendum §24). Do **not** ask the
product owner about routine implementation details. Do escalate anything that changes the user
experience, the trust or privacy model, creates irreversible data constraints, introduces significant
operational cost, requires custom infrastructure, or conflicts with an architectural principle.
Custom infrastructure additionally requires an ADR naming why hardened options are insufficient (§18).
Open escalations are listed at the end of `docs/engineering/implementation-plan.md`.

## Naming

Behavior, not roles. `CreateBulletinService`, `BulletinVisibilityPolicy`, `PostgresBulletinRepository`,
`ListVisibleBulletinsQuery`, `SendGroupedPushHandler`. Not `BulletinManager`, `DataService`, `Helper`,
`Utils`, `Processor`. Commands imperative, events past tense, queries describe their result, booleans
read as questions.
