# ADR-0001 — Runtime and deployment target

- **Status:** proposed (decided by the M3 spike; see Verification)
- **Date:** 2026-07-30
- **Drivers:** addendum §22 (deployment boundary), §18 (hardened libraries), §24 (simplest proven); PDF §8 "Deployment posture"

## Context

The addendum requires the system to be deployable, without touching domain or application code, as either:

- **A.** Cloudflare static frontend + Cloudflare Worker API + Cloudflare Queues + Cloudflare Cron + Supabase
- **B.** Cloudflare static frontend + conventional Node API/worker (Railway) + Supabase

Both are permitted. Neither may influence module boundaries. The risk in A is not architectural, it is
library-compatibility: `workerd` has no Node TCP sockets by default, a CPU-time budget per request, no
long-lived process, and WebCrypto instead of `node:crypto`. Four things in this product press exactly
there: Kysely multi-statement transactions over Postgres, VAPID Web Push signing, Supabase JWT
verification, and per-request DI composition.

The frontend is not in question: a React/Vite PWA deploys as static assets to Cloudflare in both options.

## Decision

**Target A (Cloudflare Worker API) as the preferred runtime, contingent on a timeboxed spike in M3.
Target B (Node on Railway) is the pre-committed fallback and stays permanently buildable.**

Structural rules that make the choice reversible and keep it honest:

1. Runtime-specific code exists **only** under `apps/server/src/entrypoints/**` and
   `apps/server/src/**/persistence|infrastructure` adapters. Nothing under `modules/*/application` or
   `modules/*/domain` may reference `workerd`, `@cloudflare/*`, `node:*`, or Railway APIs.
   Enforced by dependency-cruiser (ADR see `docs/engineering/repo-map.md` §Boundaries).
2. **Both entrypoints are built in CI from day one** (M1), even after a "go". A Cloudflare-only decision
   that lets the Node entrypoint rot converts a reversible choice into a one-way door.
3. The outbox table — not the queue — is the authoritative delivery ledger (ADR-0006), so the queue
   technology is an entrypoint detail in both targets.

## Spike scope (M3) and go/no-go criteria

Run against a **real Supabase staging project** from a **deployed** Worker (not `wrangler dev` alone).
Timebox: **5 working days**. Every criterion is pass/fail with the stated observation.

| # | Capability | GO criterion (observation that must be captured) |
|---|-----------|---------------------------------------------------|
| S1 | tRPC over fetch | A tRPC v11 procedure served by the fetch adapter returns HTTP 200 with the typed payload; the web app's generated client calls it with no `any`. Evidence: response body + `tsc` clean. |
| S2 | Kysely explicit transaction | A use case writing one domain row **and** one outbox row in a single `BEGIN…COMMIT` commits atomically; an injected mid-transaction error leaves **0** rows in both tables. Evidence: two SQL `SELECT count(*)` outputs. |
| S3 | Pooled connectivity | 200 sequential requests through Supabase Supavisor (transaction mode) produce **zero** `prepared statement "sN" already exists` errors and zero connection exhaustion; p95 query round-trip from the Worker < 150 ms. Evidence: run log + latency summary. |
| S4 | Supabase JWT validation | Valid Supabase access token → 200; tampered signature → 401; expired token → 401; token for another project/audience → 401. Verified with WebCrypto against the project JWKS, no vendored crypto. Evidence: four `curl` transcripts. |
| S5 | Web Push | A VAPID-signed, AES-GCM-encrypted push sent from the Worker to a real browser subscription causes a notification to appear. Evidence: screenshot of the delivered notification + 201 from the push service. |
| S6 | Queues | Producer→consumer round trip; a deliberately failing consumer retries with backoff and lands in a DLQ after max attempts; a duplicated delivery produces exactly one effect. Evidence: queue metrics/log showing retries, DLQ depth 1, and a single-row `SELECT`. |
| S7 | Cron | A scheduled trigger invokes the outbox drainer on schedule and drains a seeded pending event. Evidence: two consecutive scheduled invocations in logs + the event's `status` flipping to `published`. |
| S8 | DI composition | Per-request composition (ADR-0003) costs **< 5 ms CPU**; cold start p95 **< 400 ms**. Evidence: Workers analytics CPU-time percentile. |
| S9 | Bundle & compat | Server bundle builds for `workerd` with `nodejs_compat` at **< 3 MB** gzipped, with **no** patched, forked, or vendored dependency. Evidence: build output size + `pnpm why`/lockfile showing no `patchedDependencies`. |
| S10 | Observability | Structured logs with request correlation IDs and error traces are exported off-Worker and queryable. Evidence: a screenshot of one request's log line found by its correlation ID. |

**NO-GO if any of the following is true** (any single one is sufficient):

- Any of S1–S7 cannot be made to pass.
- Passing any criterion requires forking, patching, or vendoring a dependency, or hand-rolling crypto,
  a connection pool, a queue, or a migration runner (violates addendum §18).
- S2 passes only intermittently — a flaky transaction under the pooler is a no-go, not a known issue.
- Sustained p95 CPU per API request > 40 ms, or the spike cannot measure it.
- The spike exceeds its 5-day timebox for any reason other than a Cloudflare/Supabase incident.

On NO-GO: **Railway Node** (Node 22 LTS, Fastify + tRPC fetch adapter, `pg` pool direct to Supabase,
outbox drained by an in-process poller — see ADR-0006), Cloudflare Pages retained for the frontend.
No domain or application code changes; the diff is confined to `entrypoints/` and deployment config.
This fallback requires no further approval — it is pre-committed here.

## Alternatives considered

| Alternative | Why not (now) |
|---|---|
| **Node on Railway from the start** | Defensible and lower-risk, but forgoes edge latency and a simpler ops surface (no container, no autoscaling config) before we know whether the constraints actually bite. The spike is 5 days; the fallback is pre-committed and cheap. Chosen if any criterion fails. |
| **Supabase Edge Functions (Deno)** | Third runtime to support, weaker tRPC/Kysely ecosystem story, and couples compute to the database vendor. No advantage over A or B. |
| **Hetzner VM / self-managed** | Cheapest at scale, highest ops burden (patching, TLS, deploys, backups) for an unproven product. Named in the PDF as acceptable; revisit only on cost pressure. |
| **Vercel / AWS Lambda** | Equivalent to B with a different bill; adds a vendor without removing a risk. |
| **Cloudflare Worker + Hyperdrive** | Worth testing *inside* the spike as a mitigation for S3, not as a separate decision. |

## Consequences

- **Positive:** the deployment target stops being a blocking unknown after 5 days; both paths stay open;
  no product code is written against a runtime assumption.
- **Negative:** we carry the cost of building/typechecking two entrypoints indefinitely (small, and it
  *is* the fitness function for §22).
- **Risk:** a "go" on a spike ≠ a go at production load. S3 (pooler behaviour under concurrency) is the
  most likely late failure. Mitigation: the fallback stays buildable, and M4's staging soak re-checks S3
  under concurrent load before the decision is marked `accepted`.
- **One-way door check:** none. Nothing in either target creates irreversible data constraints.

## Verification

This ADR moves to `accepted` (target named in the title) when the M3 spike report — committed at
`docs/engineering/spikes/M3-runtime-spike.md` — records a captured observation for every one of S1–S10
and an explicit GO or NO-GO verdict, and CI builds both entrypoints on `main`.
