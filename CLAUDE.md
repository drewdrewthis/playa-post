# CLAUDE.md — operating instructions for agents working in this repo

**Read `docs/engineering/repo-map.md` first.** It orients you in five minutes. Then
`docs/engineering/architecture-addendum.md`, which is **normative and wins every
argument**. This file is the short operational layer on top of those: what to run,
what will fail you, and how work ships.

| Question | Answer |
|---|---|
| What is normative? | [`docs/engineering/architecture-addendum.md`](docs/engineering/architecture-addendum.md) |
| Where does anything live? | [`docs/engineering/repo-map.md`](docs/engineering/repo-map.md) |
| Why is it like that? | [`docs/adr/`](docs/adr/) — start at [`docs/adr/README.md`](docs/adr/README.md) |
| Where is the work going? | [`docs/engineering/implementation-plan.md`](docs/engineering/implementation-plan.md) |

## Commands

Node **22** (`.nvmrc`), pnpm from `packageManager` in `package.json`.

```bash
pnpm install            # workspace install
pnpm dev                # web (:5173) + server (:3000) in parallel
pnpm build              # web + the server bundle
pnpm build:web          # vite + PWA service worker
pnpm build:server:node  # tsup, platform=node   -> apps/server/dist/node/main.js
pnpm typecheck          # root tsconfig + every workspace package
pnpm lint               # eslint flat config
pnpm boundaries         # dependency-cruiser — the architecture fitness function
pnpm db:start           # local Supabase stack (db:stop to tear it down)
pnpm db:reset           # replay every migration from scratch
pnpm db:migrate         # apply only the migrations not yet applied
pnpm db:types           # rewrite packages/database/src/schema.ts from the live database
pnpm test               # every vitest project
pnpm test:unit          # no infrastructure; fast enough to run on save
pnpm test:integration   # Testcontainers Postgres; needs a running docker daemon
pnpm test:security      # ADR-0002 bypass suite; needs a running docker daemon
```

There is **one** boundary script, `pnpm boundaries` — no `lint:boundaries` alias,
because two names for one command is two things to keep in sync. The CI *job*
that runs it is named `lint:boundaries` per the implementation plan's named-job
list; job name and script name are allowed to differ, and that mapping is
recorded in the plan.

**One server target: the Node bundle, deployed to Render** ([ADR-0009](docs/adr/ADR-0009-deploy-node-server-to-render.md),
which supersedes ADR-0001). Do not add a second entrypoint or a second bundle to
"keep options open" — that was ADR-0001 rule 2, and it was right only while two
targets were genuinely live. What keeps the deployment reversible now is
`pnpm boundaries`: runtime code exists only under `entrypoints/**` and
infrastructure adapters, so moving hosts is a change to `main.ts`, `http-server.ts`,
and `render.yaml`, never to a module. A new hosting target is a new ADR, not a new
build script.

That guarantee is **Node-host** portability (Render → Railway → Fly → a container),
not edge-runtime portability. Nothing proves this tree would run under `workerd`
any more. Need a domain service to make randomness, read a file, or open a socket?
Declare the port in `domain/` and let an adapter import `node:crypto` — the
boundary rule fails the build otherwise, and that rule is now the only thing
checking it.

`render.yaml` at the repo root is the service definition. It restates several
values the code also declares (health path, bundle location, Node version);
`tests/fitness/render-blueprint.fitness.test.ts` holds those couplings and
explains each. Edit the blueprint and that test together.

CI (`.github/workflows/ci.yml`) runs install → typecheck → lint → boundaries →
build:web → build:server:node → unit → integration → security.
**Run the same commands locally before you push.** A red PR is a broken promise,
not a work-in-progress signal — that is what draft status is for.

## Boundary rules — executable, not advisory

`pnpm boundaries` fails the build. The rules are in
[`.dependency-cruiser.cjs`](.dependency-cruiser.cjs) and encode
architecture-addendum §19.

| Rule | What it stops |
|---|---|
| `no-domain-to-infrastructure` | `modules/*/domain/` **and** `modules/*/application/` importing its own module's persistence, entrypoints, composition, a **Node builtin** (`node:crypto`, `fs`, …), or tRPC/Supabase/Kysely/pg/Fastify/pino/React |
| `no-application-to-transport` | `modules/*/application/` importing `transport/` or an entrypoint |
| `no-transport-to-persistence` | `modules/*/transport/` importing a repository or a database client |
| `no-web-to-server-internals` | `apps/web` importing anything under `apps/server` |
| `no-cross-module-persistence` | one module importing **another** module's `persistence/` |

Allowed direction: **Transport → Application → Domain ← Infrastructure.**

Cross-module interaction goes through a small public application interface, a
published event, a shared contract in `packages/contracts`, or a coordinating
application service. **Never a direct reach-in.**

> **If a rule is in your way, change the design — not the rule.** Wanting an
> exception is the signal that the dependency is pointing the wrong way.

Each rule has a deliberately-violating fixture in
`tests/fitness/__fixtures__/<rule-name>/`, and
`tests/fitness/boundaries.fitness.test.ts` asserts every rule is still caught by
its own fixture and by nothing else. **Do not "fix" a fixture.** Adding a rule
without adding its fixture fails that test on purpose.

Two more rules from the repo map — `no-container-outside-composition` and
`no-sql-outside-persistence` — are **M1b.9** in the implementation plan: they
ship in the M2 PR that introduces the code they bind to (the DI container and
the first repository). They are not configured yet because a rule with nothing
to check reports green forever, which is worse than no rule at all.

## Conventions

- **Files are kebab-case, named for behavior**: `create-bulletin.service.ts`,
  `postgres-bulletin.repository.ts`, `bulletin-visibility.policy.ts`. Not
  `manager`, `helper`, `utils`, `processor` (addendum §20).
- **Tests are named by cost**: `*.unit.test.ts` runs in the `unit` project,
  `*.integration.test.ts` in `integration`. The suffix is the selector, so a
  test's price is visible in its filename. Fitness tests live in `tests/fitness/`.
- **Exact versions only.** `.npmrc` sets `save-exact=true`. Never commit a `^`.
- **Only `composition/` reads `process.env`.** Everything else receives a
  `Configuration` from `@playa-post/configuration`. An ambient environment read
  inside a module is a hidden, untestable dependency.
- **Never put a secret in a schema default.** A default that works in production
  is a secret in source control (addendum §17).
- **Secret names, paths, and retrieval steps** live in `docs/engineering/secrets.md`
  (never values).
- **Directories are created when a real file lands in them**, never as
  placeholders (addendum §4). `apps/server/src/modules/` does not exist yet
  because M1 has no product code. That is correct, not missing.

## Toolchain notes that will bite you

- **TypeScript is pinned to 6.x on purpose.** TypeScript 7 is outside the
  supported range of both `dependency-cruiser` (`>=2.0.0 <7.0.0`) and
  `typescript-eslint` (`>=4.8.4 <6.1.0`). On TS 7, dependency-cruiser silently
  stops parsing `.ts` files — `pnpm boundaries` reports **zero violations over
  zero files** and passes. The fitness test asserts `totalCruised > 0` precisely
  to catch that failure mode. Do not bump TypeScript past 6 until both tools
  support it.
- **Workspace packages ship TypeScript source**, not build output — their
  `exports` point at `src/index.ts`. Vite, Vitest, and tsc consume that directly;
  the server bundle uses tsup with `noExternal: [/^@playa-post\//]`.
- **`packages/contracts` is intentionally an empty barrel.** It is the only legal
  import surface from `apps/web` into the server side. See its README before
  putting anything in it.
- **`exactOptionalPropertyTypes` is on.** `{ foo?: string }` will not accept
  `{ foo: undefined }`. Write `undefined`-valued optionals as omissions, or type
  them `foo?: string | undefined` when "explicitly absent" is a real state.
- **Integration tests need no `db:start`.** `startPostgresTestDatabase()` boots
  its own `postgres:17` and applies `supabase/migrations` by default; call
  `truncateAllTables()` in `beforeEach` rather than restarting the container.
- **`packages/database/src/schema.ts` is generated and checked in.** Write a
  migration and you owe a `pnpm db:types` in the same commit; an integration test
  regenerates the file against Testcontainers and fails CI on any difference.
  Never hand-edit it — see [`packages/database/README.md`](packages/database/README.md).

## How work ships

1. **Branch off latest `main`.** Never commit to `main`.
2. **Commit incrementally**, with messages that say why.
3. **Open a DRAFT PR.** Every PR starts as a draft.
4. **Prove it.** The PR body must show the actual command output for lint,
   boundaries, build, and tests — not a claim that they pass.
5. **Mark ready only when CI is green** and the review gates pass.
6. **Never rewrite shared history.** No force-push to `main`, no rebasing a
   branch someone else is reviewing.

If another agent is working in this checkout, use a git worktree rather than
switching branches underneath them.

## Definition of done

Addendum §25 in full. The parts most often skipped:

- Authorization enforced **server-side**; client checks are never authoritative.
- Module boundaries preserved — `pnpm boundaries` green.
- Persistence covered by integration tests against real Postgres.
- Important state changes emit transactional outbox events.
- Logs contain no bulletin content and no private contact information.
- **Documentation and ADRs are updated when the architecture changes.** An
  architectural decision that only exists in a PR description does not exist. If
  you introduce a pattern, add or amend an ADR in `docs/adr/` in the same PR, and
  update `docs/engineering/repo-map.md` if the shape of the tree changed.
- Proven libraries over custom infrastructure (addendum §18). Building a router,
  DI framework, ORM, migration system, validation library, event bus, offline
  database, logging framework, job queue, test runner, query language, or crypto
  layer requires an ADR justifying it first.

## Decisions

Choose the simplest proven implementation when a detail is open (addendum §24).
**Do not ask the product owner about routine implementation details.** Escalate
only what changes the user experience, the trust or privacy model, creates
irreversible data constraints, introduces significant operational cost, requires
custom infrastructure, or conflicts with an architectural principle.
