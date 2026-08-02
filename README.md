# Playa Post (Burner Trust Network)

Private, opt-in community network: real-world relationships form a navigable trust graph; short typed bulletins support offers, requests, events, collaboration, appreciation, and introductions.

**New here? Start with [`docs/engineering/repo-map.md`](docs/engineering/repo-map.md)**, then the
normative [architecture addendum](docs/engineering/architecture-addendum.md) and the
[implementation plan](docs/engineering/implementation-plan.md).
Agents: [`CLAUDE.md`](CLAUDE.md) is the operational layer on top of those.

## Quickstart

Requires **Node 22** (see `.nvmrc`) and **Docker** — integration tests use Testcontainers.
pnpm comes from the `packageManager` field, so `corepack enable` is enough.

```bash
pnpm install
pnpm dev                     # web on :5173, server on :3000
curl localhost:3000/healthz  # {"status":"ok"}
```

### Verify

```bash
pnpm typecheck
pnpm lint
pnpm boundaries              # architecture fitness function — see below
pnpm build                   # web + the server bundle
pnpm build:server:node       # the server alone — the bundle Render runs (ADR-0009)
pnpm test:unit               # no infrastructure
pnpm test:integration        # Testcontainers Postgres 17; needs docker running
pnpm test:security           # ADR-0002 bypass suite; needs docker running
pnpm test                    # all three projects
```

CI runs exactly these, in this order, on every PR.

### Local database

```bash
supabase start     # Postgres, Auth, Storage, Studio — see supabase/config.toml
supabase db reset  # replay every migration from scratch
```

Integration tests do **not** need this. `startPostgresTestDatabase()` from
`@playa-post/testing` boots its own throwaway `postgres:17`, applies
`supabase/migrations` by default, and exposes `truncateAllTables()` for between-test
reset — so `pnpm test:integration` runs from a cold clone with only Docker.

Migration workflow: [`supabase/migrations/README.md`](supabase/migrations/README.md).

## Architecture boundaries are executable

`pnpm boundaries` fails the build on a broken dependency direction. The allowed
direction is **Transport → Application → Domain ← Infrastructure**; the rules live in
[`.dependency-cruiser.cjs`](.dependency-cruiser.cjs) and encode
[addendum §19](docs/engineering/architecture-addendum.md).

Each rule has a deliberately-violating fixture under `tests/fitness/__fixtures__/`, and
`tests/fitness/boundaries.fitness.test.ts` proves every rule still catches its own
fixture and no other. A boundary rule nobody has watched fail is a rule you are
trusting on faith.

## What lives here
- Product code for the Playa Post PWA + API (React/Vite PWA, tRPC, PostgreSQL/Supabase — see docs/).
- `apps/web` — the PWA. `apps/server` — the modular monolith. `packages/` — contracts, configuration, testing.
- `docs/` — canonical handoff spec (PDF), architecture addendum, ADRs, implementation plan.
- `design/` — settled prototype (`Playa Post.dc.html` + imports) from claude.ai/design. The prototype is product evidence, not production architecture.

## What does NOT live here
- LangWatch product work → langwatch/langwatch or langwatch/langwatch-saas.
- Fleet-ops chores → drewdrewthis/misc-issues.

## Source design project
https://claude.ai/design/p/fbf84464-c3e1-4cec-8d1f-79dea851fd20?file=Playa+Post.dc.html
