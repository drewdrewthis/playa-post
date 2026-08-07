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
pnpm test:unit:changed  # unit tests touched by uncommitted changes; local iteration only, not in CI
pnpm test:integration   # Testcontainers Postgres; needs a running docker daemon
pnpm test:security      # ADR-0002 bypass suite; needs a running docker daemon
pnpm test:e2e           # Playwright browser e2e; run `pnpm exec playwright install chromium` once
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

CI (`.github/workflows/ci.yml`) runs **nine parallel jobs**, named exactly:
`typecheck`, `lint`, `lint:boundaries`, `test:unit`, `test:integration`,
`test:security`, `build:web`, `build:server:node`, `secret-scan`. Nothing
`needs:` anything else, so each failure names itself. Those nine strings are the
checks branch protection requires — **renaming a job silently un-requires its
check**, so change one only deliberately and update the protection rule with it.

A tenth job, `test:e2e`, runs the Playwright browser e2e. It is **advisory in
M2**, deliberately **not** in branch protection — the nine required names above
are unchanged — because adding it there is a repo-settings change out of any
lane's scope (see `docs/engineering/l5-plan.md`, decision D2).
Shared Node/pnpm/install lives in one composite action,
[`.github/actions/setup-workspace`](.github/actions/setup-workspace/action.yml).
**Run the same commands locally before you push.** A red PR is a broken promise,
not a work-in-progress signal — that is what draft status is for.

`secret-scan` runs [gitleaks](https://github.com/gitleaks/gitleaks) over the full
commit history, pinned by version *and* SHA-256. A genuine false positive is
retired by adding its fingerprint to `.gitleaksignore` — never by loosening the
job.

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
| `no-container-outside-composition` | anything outside `entrypoints/**` and `composition/**` importing `composition/container.ts` |

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

`no-container-outside-composition` shipped with the DI container it binds to
(M2.3, ADR-0003). **`no-sql-outside-persistence` shipped with the first
repository** (M1b.9's second half, lane L1) and is **not** a dependency-cruiser
rule: it governs SQL *literals and `sql` fragments*, not import edges, so it is a
TypeScript-AST walker at
[`tests/fitness/find-sql-outside-persistence.ts`](tests/fitness/find-sql-outside-persistence.ts),
driven by `no-sql-outside-persistence.fitness.test.ts`, with its own fixtures
under `tests/fitness/sql-fixtures/` (a sibling of `__fixtures__/`, because
`boundaries.fitness.test.ts` requires every directory in `__fixtures__/` to be
named after a dependency-cruiser rule). It scopes to `apps/server/src/**` minus
`persistence/` minus tests, and it is the only check that can see a `sql` tag
imported as `@playa-post/database`'s re-export rather than as `kysely`.

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
- **`.env.example` lists every key `@playa-post/configuration` reads** — the
  defaulted ones (`NODE_ENV`, `HOST`, `PORT`, `LOG_LEVEL`) and the two with no
  default (`DATABASE_URL`, `SUPABASE_URL`), **names and placeholders only,
  never a value**; see `packages/configuration/src/environment-schema.ts` and
  `docs/engineering/secrets.md`. The two files must stay in sync, and
  `tests/fitness/render-blueprint.fitness.test.ts` asserts that every
  undefaulted key is declared in `render.yaml` too.
  `DATABASE_URL` is a secret, declared there as a bare key with `sync: false`;
  its user must be `app_rw` (ADR-0002 §2) — any other role silently disables
  `FORCE ROW LEVEL SECURITY` for every query. `SUPABASE_URL` is **not** a
  secret and carries its value in the blueprint, because a project ref is a
  public identifier and this line decides whose users the API accepts
  ([ADR-0011](docs/adr/ADR-0011-access-token-verification-at-the-trpc-boundary.md)).
- **A pre-commit hook scans staged changes for secrets**, mirroring the
  `secret-scan` CI job. It lives at `.githooks/pre-commit`; `pnpm install`'s
  `prepare` script wires it in via `git config core.hooksPath .githooks`.
  Bypass with `git commit --no-verify` if you must — CI's `secret-scan` job
  is the backstop either way. Its pinned gitleaks version and checksum must
  be bumped together with `ci.yml`'s `secret-scan` job (see the comment
  there).
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
- **`tsc --noEmit` is incremental locally.** `incremental: true` lives in
  `tsconfig.base.json`; each leaf tsconfig sets its own `tsBuildInfoFile` so
  the root check and all seven package checks cache independently. Verified
  against the pinned TS 6.0.3: `noEmit` does not block `incremental` in this
  config shape (no `composite`), the `.tsbuildinfo` files are written on every
  run, and `*.tsbuildinfo` is already gitignored. CI checks out fresh every
  run and never sees a cache, so this cannot mask a CI failure — but if a
  local typecheck ever looks suspiciously clean, delete the `*.tsbuildinfo`
  files and re-run before trusting it.
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
- **The security suite runs two harnesses, not one.** B1/B3/B4 are catalog facts
  and use the database above; **B2 is about the REST layer**, so it uses
  `startSupabaseRestTestStack()` — the same database plus Supabase's PostgREST,
  started with the `[api] schemas` list read from `supabase/config.toml`
  ([ADR-0010](docs/adr/ADR-0010-supabase-rest-security-harness.md)). Still no
  `db:start`, still the same `test:security` job. That config list is an **input**
  to the server under test, never the subject of an assertion — adding `"app"` to
  it makes B2 red because the schema becomes reachable, which is the only version
  of that check worth having. `POSTGREST_TEST_IMAGE` must be bumped **by hand**
  when the Supabase CLI's PostgREST pin moves; nothing couples them.
- **`packages/database/src/schema.ts` is generated and checked in.** Write a
  migration and you owe a `pnpm db:types` in the same commit; an integration test
  regenerates the file against Testcontainers and fails CI on any difference.
  Never hand-edit it — see [`packages/database/README.md`](packages/database/README.md).

## How work ships

1. **Branch off latest `main`.** Never commit to `main`.
2. **Commit incrementally**, with messages that say why.
3. **Open a DRAFT PR.** Every PR starts as a draft
   (`.github/PULL_REQUEST_TEMPLATE.md` pre-fills the required sections).
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
