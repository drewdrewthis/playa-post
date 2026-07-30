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
| 4 | `design/Playa Post.dc.html` | The settled UX prototype. **Product evidence, not architecture.** Never copy its structure. |
| — | `docs/engineering/implementation-plan.md` | Milestones M1–M5 with acceptance criteria. Where the work is going. |
| — | `docs/adr/` | Architecture Decision Records. Read the index in `docs/adr/README.md`. |
| — | `docs/procedures/` | Operational runbooks (deploy, rollback, secret rotation, replaying a dead outbox event). Created in M4. |

If the PDF and the addendum disagree, the addendum wins. If the prototype and either disagree, the
prototype loses. Decisions D1–D3 record three such resolutions already made — do not reopen them.

## Where code lives

```text
apps/web/        React + Vite PWA. Feature-oriented: src/features/{identity,connections,graph,
                 bulletins,views,notifications,moderation,sync}/{api,components,hooks,model,routes,
                 state,tests}. Shell/router/providers in src/app/. Shared UI in src/shared/.
apps/server/     The modular monolith.
  composition/   The ONLY place that knows about the object graph (ADR-0003).
  entrypoints/   http/ · queue/ · cron/. The ONLY place that knows about the runtime (ADR-0001).
  modules/       identity · connections · graph · bulletins · views · notifications · moderation ·
                 sync · storage · audit. Each: transport/ application/ domain/ persistence/ tests/
                 plus a <name>.module.ts. (Addendum §4 — a module only grows the directories it needs.)
  shared/        auth · events · errors · logging · transactions.
packages/        contracts · database · observability · configuration · testing.
supabase/        migrations/ · sql/ · seed/ · tests/.
scripts/         Repo tooling.
tests/           fitness/ (executable architecture rules) · security/ (ADR-0002 bypass suite).
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

`pnpm lint:boundaries` (dependency-cruiser + ESLint) fails the build on:

| Rule | Meaning |
|---|---|
| `no-domain-to-infrastructure` | domain must not import tRPC, React, Kysely, Supabase, Cloudflare/Railway APIs, HTTP types, DB row types, or logging implementations |
| `no-application-to-transport` | application services must not touch request/response objects |
| `no-transport-to-persistence` | routers never call repositories or the database |
| `no-web-to-server-internals` | `apps/web` may import `packages/contracts`, nothing else from the server |
| `no-cross-module-persistence` | a module must not import another module's persistence, internal domain entity, private service, SQL, test helper, or internal transport schema |
| `no-container-outside-composition` | only `entrypoints/` and `composition/` may import the container |
| `no-sql-outside-persistence` | SQL literals only in `**/persistence/**` and `supabase/**` |

Deliberately-violating fixtures live in `tests/fitness/__fixtures__/`; a test asserts each is caught.
If you find yourself wanting to add an exception, that is the signal to change the design, not the rule.

Cross-module interaction goes through: a small public application interface, a published event, a shared
contract with clear ownership, or a coordinating application service. Never a direct reach-in.

## Security model in one paragraph

Authentication is Supabase (magic link), verified at the tRPC boundary and mapped to an **internal**
user ID (ADR-0008). Authorization is **server-side and authoritative** (ADR-0002): product tables live
in schema `app`, which is not exposed to PostgREST; the API connects as a least-privileged `app_rw` role;
RLS is enabled everywhere as a deny-by-default backstop; and every viewer-scoped read passes `viewer_id`
explicitly into a checked-in SQL visibility function. The client may hide things for usability, but
client checks are never authoritative and hidden data must never reach the client (addendum §15).
`tests/security/` (B1–B12) is the proof; adding a viewer-scoped query means adding a row to that matrix.

## How to run it

```bash
pnpm install
pnpm db:start          # local Supabase
pnpm db:reset          # apply migrations + seed
pnpm db:types          # regenerate Kysely types (checked in; CI fails on drift)
pnpm dev               # web + server
```

## How to test it

```bash
pnpm typecheck
pnpm lint
pnpm lint:boundaries   # architecture fitness functions
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

Portable by construction (addendum §22): Cloudflare static frontend, plus either a Cloudflare Worker API
with Queues and Cron, or a conventional Node server and worker — both against Supabase. The choice is
ADR-0001, decided by the M3 spike. **Both server entrypoints build in CI regardless of the verdict** —
that is the fitness function keeping the choice reversible. Runtime-specific code belongs only in
`entrypoints/` and infrastructure adapters. The outbox table, not the queue, is the delivery record
(ADR-0006), so the queue technology is an entrypoint detail.

## Before you call something done

Addendum §25, in full — behavior implemented; authorization enforced server-side; module boundaries
preserved; domain and application responsibilities separated; persistence covered by integration tests;
important state changes emit transactional outbox events; offline behavior defined where applicable;
errors structured and observable; logs free of sensitive content; docs and ADRs updated when the
architecture changes; proven libraries over custom infrastructure; SOLID with attention to SRP and
dependency inversion.

Plus, in this repo specifically:
- a new viewer-scoped query adds a row to the ADR-0002 B5 matrix;
- a new offline mutation type adds a row to the ADR-0005 conflict matrix;
- a new grammar field adds a row to the ADR-0007 table plus a golden-file test.

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
