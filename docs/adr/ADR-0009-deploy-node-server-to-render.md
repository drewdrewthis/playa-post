# ADR-0009 — Deploy the Node server to Render

- **Status:** accepted — product-owner decision, 2026-08-02
- **Date:** 2026-08-02
- **Supersedes:** [ADR-0001](ADR-0001-runtime-and-deployment-target.md) (runtime and deployment target)
- **Drivers:** owner decision 2026-08-02 — *"we're going to make the system simpler by setting up the
  backend server on a free Render"*; addendum §22 (deployment boundary), §24 (simplest proven), §18
  (hardened libraries over custom infrastructure)

## Context

ADR-0001 left the runtime undecided on purpose. It named Cloudflare Workers the *preferred* target,
Node the pre-committed fallback, and paid for that optionality with three standing costs:

1. a second HTTP entrypoint (`cloudflare-worker.ts`) and a second tsup bundle, built on every CI run;
2. a 5-working-day M3 spike (criteria S1–S10 plus S3a) whose only product is a verdict;
3. a design constraint on every future infrastructure adapter — Kysely transactions, Web Push signing,
   JWT verification, and connection pooling all had to be chosen so they would work under `workerd`
   *and* Node.

The product owner has decided to stop paying those costs and take the Node target now. That decision is
the owner's to make: it changes operational cost and the launch posture, which addendum §24 places
outside "routine implementation detail".

The decision sits **inside** the normative envelope rather than against it. Addendum §22 permits exactly
two shapes and this is the second one — *"Cloudflare static frontend + conventional Node server and
worker + Supabase"* — and §22 already anticipates the outcome: *"If Cloudflare runtime constraints
create meaningful friction … use a conventional Node deployment such as Railway or Hetzner."* Render is
that same class of target: a container running Node 22, no edge runtime, no vendor-specific request
model. §22 is not amended by this ADR; only ADR-0001's *preference* between its two permitted shapes is.

Render specifically, over the Railway fallback ADR-0001 pre-committed: the free plan removes the
"stand up a billing relationship before the first deploy" step, and `render.yaml` gives us the service
definition as code in the repository rather than as dashboard state nobody can review.

## Decision

**The backend deploys as the Node server build — `apps/server/dist/node/main.js` — to Render, on the
free plan, defined by `render.yaml` at the repository root. It is the only server runtime target.**

1. **One entrypoint, one bundle.** `apps/server/src/entrypoints/http/main.ts` (Fastify, via
   `http-server.ts`) is the server's single HTTP entrypoint. `pnpm build:server:node` is the only server
   build; `pnpm build` is web + that one bundle. The `cloudflare-worker.ts` entrypoint, the
   `build:server:cloudflare` script, its tsup target, and its CI step are deleted.
2. **ADR-0001 rule 2 is retired with it.** "Both entrypoints build in CI from day one" was the fitness
   function for a choice that no longer exists. Building a bundle for a runtime nobody will deploy to is
   not reversibility, it is maintenance of a fiction — the very thing addendum §4 calls an empty
   abstraction.
3. **ADR-0001's structural rule 1 survives, and this PR makes it actually enforce what it claimed.**
   Runtime-specific code lives only under `apps/server/src/entrypoints/**` and infrastructure adapters;
   nothing under `modules/*/domain` or `modules/*/application` may reference a Node builtin, Fastify, a
   database client, or a hosting provider's API.

   **State plainly what was traded away.** Until this ADR, the thing that actually failed when a Node
   builtin reached module code was the `platform: 'neutral'` bundle — not the boundary rule, which had
   no `node:` term and scoped `from` to `domain/` alone. Deleting that bundle without widening the rule
   would have left "runtime code lives only in entrypoints" as an assertion nothing checked. So the rule
   is widened here in the same PR: `no-domain-to-infrastructure` now covers `domain/` **and**
   `application/`, and forbids Node's standard library in both, with fixtures under
   `tests/fitness/__fixtures__/no-domain-to-infrastructure/` proving each case fails.

   **What that buys, precisely — and what it does not.** It guarantees *Node-host* portability: moving
   Render → Railway → Fly → a container is a diff to `main.ts`, `http-server.ts`, and `render.yaml`, and
   the rule fails the build if a module quietly acquires a host dependency. It does **not** guarantee
   edge-runtime portability. Nothing now proves the tree would run under `workerd`, and this ADR does not
   claim it does; re-establishing that would mean re-adding a neutral-platform build, which is the
   expensive half of the "new ADR" in the Reversibility section.

   The shape the rule forces is dependency inversion, not deprivation: declare the port in `domain/`
   (`TokenGenerator`, `Clock`) and let an adapter import `node:crypto`. M2's CSPRNG invite token
   (M2-AC17) is the first real instance.
4. **The service is infrastructure-as-code.** `render.yaml` declares the plan, region, Node version,
   build command, start command, and health check path. Secrets are never valued in it: a secret gets a
   `key` and `sync: false`, and its value is set in the Render dashboard (addendum §17).
5. **Health check.** Render polls `/healthz`, the path `entrypoints/http/health.ts` already exports as
   `HEALTH_PATH`. That module stays the single source of the liveness payload even with one entrypoint —
   it is the thing Render's health check is bound to, and it must not query the database (a health check
   that fails when a dependency is slow turns one degraded dependency into a restart loop).
6. **Region `frankfurt`,** the free-plan region closest to the Supabase project's `eu-west-3`. Every
   request pays the API↔database round trip; the frontend's static assets do not.
7. **`autoDeploy: false`.** Plan item M4.5 requires rollout to be gated by the B18 post-deploy catalog
   smoke, with migrations run before the API rolls. Render's own push-to-deploy would bypass that gate,
   so deploys are triggered by the CD job that owns the gate, not by the git push.

## Alternatives considered

| Alternative | Why not |
|---|---|
| **Run the ADR-0001 M3 spike anyway, then decide** | The spike's product is a verdict, and the owner has supplied one. Five working days spent to maybe reach the answer we already hold is the definition of unnecessary work (§24). |
| **Keep the Worker entrypoint building "just in case"** | This is ADR-0001 rule 2, and it was right *while two targets were live*. With one target it inverts: the second bundle is unexecuted, undeployed, and unverified against any real dependency, so it would rot into false assurance while still constraining every library choice. Reversibility now comes from the boundary rules and from git history. |
| **Node on Railway** (ADR-0001's pre-committed fallback) | Equivalent architecture, and a defensible pick. Render was chosen by the owner; the free plan starts without a billing relationship and `render.yaml` puts the service definition under review in-repo. Nothing in this ADR depends on Render's API surface, so the two remain interchangeable. |
| **Fly.io / Hetzner VM / a container on AWS** | Each adds ops burden (Dockerfile, patching, TLS, or an orchestrator) that the launch bar does not require. Hetzner stays the answer under cost pressure at scale, as the PDF notes. |
| **Supabase Edge Functions (Deno)** | A third runtime, weaker tRPC/Kysely story, and couples compute to the database vendor. Rejected in ADR-0001 for those reasons and they have not changed. |
| **Paid Render instance now** | Buys away the free-plan caveats below (no spin-down, zero-downtime deploys), but the caveats are acceptable at the launch bar and the upgrade is a one-line `plan:` change with no code impact. Spend when a measurement demands it, not before. |

## Consequences

**Positive — the simplification is the point.**

- **One runtime target, one bundle, one CI build step.** The `build:server:cloudflare` job disappears
  from `.github/workflows/ci.yml`; the ten-job list becomes nine. Every CI run gets shorter and there is
  one fewer artifact to reason about.
- **No dual-entrypoint drift risk.** Two entrypoints serving one product is a correctness surface: the
  cross-runtime "byte-identical health output" test existed precisely because the two could diverge. One
  entrypoint cannot diverge from itself, so the class of bug is gone rather than tested for.
- **Library choice stops being constrained by `workerd`.** Kysely transactions, `pg`'s pool, `node:crypto`
  for VAPID signing, and a long-lived in-process outbox poller are all now simply available. ADR-0006's
  Node-poller delivery path is the one that ships; its Cloudflare Queues/Cron variant is unreachable and
  will be pruned when that ADR is next touched.
- **M3 shrinks from a 5-day spike to a deploy.** Risk R1 ("Supabase pooler + Kysely transactions
  unreliable in `workerd`") and risk R9 ("the M3 timebox slips and blocks M4") are both closed outright.
- **The deployment surface is reviewable.** `render.yaml` is a file in a PR, not a dashboard someone
  configured once.

**Negative — free-plan caveats, accepted knowingly.** Verified against Render's plan documentation on
2026-08-02; re-check before relying on any number. The same discipline applies to `render.yaml`'s
schema keys, which no test in this repo can validate: confirm `runtime: node` is current (it replaced
the legacy `env:` key) and that `region: frankfurt` is free-plan-eligible **before** the first
`render blueprint launch`. A blueprint that fails schema validation fails at launch time, not in CI.

- **Spin-down on idle → cold starts.** A free web service is spun down after roughly 15 minutes with no
  inbound traffic, and the next request pays the spin-up — tens of seconds, not milliseconds.
  *Acceptable because:* the launch bar (`docs/product/launch-definition-of-done.md`) is live, working,
  real-data, visually correct and QA-signed-off. It sets no latency SLO. The audience is an invited
  private network, not the open internet, and a first-request delay after an idle period is a nuisance
  rather than a failure. M3-AC5 measures it rather than assuming it.
- **Spin-down stops the outbox drainer, which is the consequence that actually bites.** This ADR makes
  the in-process Node poller the shipping delivery path (ADR-0006; plan M2.14, "no cron variant"). A
  spun-down instance is a *process that is not running*, so nothing drains: a bulletin posted at 02:10
  produces its grouped push whenever the next unrelated visitor happens to wake the service — minutes or
  hours later, with no upper bound. Cold-start latency is a nuisance; this is a **feature that silently
  does not work**, and launch-DoD clause 2 ("working, not mocked" — real push, real worker in the
  deployed app) is the clause it fails.
  *Not waved away:* **M3-AC6 measures outbox latency across an idle window** and is the gate on whether
  this stays acceptable. If it fails, the resolutions in preference order are (a) a paid instance, which
  never spins down, or (b) an external scheduler poking the drain endpoint — **not** a longer poll
  interval, which does not address a process that is not running.
- **750 free instance-hours per month, pooled across the workspace.** A 31-day month is 744 hours, so
  the budget covers exactly **one** always-on free service and no more. A second — a staging copy, or a
  separately-hosted drainer — draws from the same pool and pushes past it.
  *Acceptable because:* spin-down means a low-traffic invite-only service bills well under its
  wall-clock hours, so one service is not close to the ceiling; and M4's staging environment is the
  first thing that would genuinely need a second one. That is a known, priced moment to upgrade rather
  than a surprise.
  ⚠ **Keep-alive and this budget are mutually exclusive, and saying so is the point.** Pinging the
  health check to defeat spin-down means the instance runs ~744 h/month against a 750 h pool — it
  consumes essentially the entire free allowance, foreclosing the M4 staging service. So "just keep it
  warm" is not a free mitigation for the two bullets above: **choosing keep-alive means the paid `plan:`
  line arrives at M4, not later.** Budget for that rather than discovering it when staging cannot start.
- **No zero-downtime deploys on the free plan.** A deploy stops the running instance and starts the new
  one; requests in that window fail. *Acceptable because:* pre-launch there are no users to drop, and
  post-launch the deploy window is seconds on an app with no availability commitment. That argument
  stands on its own; nothing about rollback verification is claimed here.
  **What ships today does not identify the running version.** `/healthz` returns `{"status":"ok"}` and
  Decision 5 keeps it that way deliberately. The SHA-carrying endpoint is **`/health`, a separate
  endpoint arriving in M4.3**, added alongside `/healthz` and never replacing it — so M4-AC5's
  "rollback returns the previous SHA within 10 minutes" is **not verifiable until M4.3 lands**. Stating
  that rather than implying today's liveness probe covers it: an earlier draft of this bullet justified
  an accepted consequence with a mechanism this same ADR forbids, one character off the path the PR
  built a drift guard for.
- **No persistent disk and a single instance.** Neither is used: all state is in Supabase, and the
  outbox drainer's `FOR UPDATE SKIP LOCKED` claiming (ADR-0006) is what makes horizontal scale possible
  later, independent of the host.
- **One more vendor in the deploy path** (Supabase + Render). Small, and both are replaceable behind the
  same entrypoint boundary.

**Reversibility.** This is not a one-way door.

- Nothing about Render appears in domain, application, or transport code — only `render.yaml`,
  `entrypoints/http/main.ts`, and CI. The diff to move to Railway, Fly, or a container is confined to
  those.
- **The Worker entrypoint is not lost, it is in git history.** `apps/server/src/entrypoints/http/`
  `cloudflare-worker.ts`, its unit test, and the tsup `cloudflare` target are recoverable with
  `git log --diff-filter=D -- apps/server/src/entrypoints/http/cloudflare-worker.ts` and a
  `git show <sha>^:<path>`. Version control is the archive; a checked-in unused file is not.
- **Readopting an edge runtime is a new ADR, not a revert.** It would have to re-argue the S1–S10
  compatibility questions ADR-0001 raised — against product code that will by then assume Node — and
  record the answers. Resurrecting the deleted file is the cheap part; that ADR is the expensive part,
  and it should be written rather than skipped.

**Follow-on, not done here.** Four documents keep `workerd`-era reasoning that is now stale, and none is
edited in this PR — each records a decision that stands on its own, and rewriting other people's
rationale is a wider blast radius than the owner ratified:

| Document | Stale passage | Why it can wait |
|---|---|---|
| ADR-0006 | the "Cloudflare target" delivery path and the `workerd` arguments against `pg-boss`/`LISTEN NOTIFY` | Its decision — the outbox table is the authoritative ledger — holds under either shape. The Node-poller branch is simply the one that ships. |
| ADR-0003 | "the runtime target (ADR-0001) may be `workerd`" as a driver for explicit factory DI | Explicit factories remain the right call on their own merits (no decorators, no metadata shim); only one of several reasons evaporated. |
| ADR-0007 | "faster in `workerd`" as one argument against a parser generator | Same shape: a supporting clause, not the decision. |

Fix each opportunistically the next time its file is touched for a real reason.

Two further items were raised in review, judged real, and **deliberately deferred** — recorded here
because a deferral that lives only in a review thread is a deferral nobody finds again:

| Deferred | Why not in this PR | When |
|---|---|---|
| **Rename `build:server:node` → `build:server`, `dist/node/` → `dist/`.** The `:node` qualifier implies a sibling target exists — exactly the false optionality this ADR removes. | The rename sweeps `.github/workflows/ci.yml`, and the CI **job name** `build:server:node` is one of the nine that branch protection will require (M1b.5). Renaming a required check while that protection is being set up (issue [#10](https://github.com/drewdrewthis/playa-post/issues/10) already tracks a workflow conflict with PR #9) risks a check that can never go green. | With M1b.5, when the job list is edited deliberately and branch protection updated in the same change. |
| **A CI smoke step executing the built bundle** — start it, `curl /healthz`, assert the payload. Nothing currently *runs* `dist/node/main.js`; the deploy is its first execution with externals resolved, and this is the honest replacement for the deleted dual-runtime assertion. | Same file freeze: it is a `.github/workflows/ci.yml` edit. | With M1b.5. Until then the smoke was run **by hand** on this branch — the bundle serves `/healthz` → `200 {"status":"ok"}`, 404s a POST, and exits 0 on `SIGTERM`; transcript in the PR. |

**Addendum §22 is amended in this PR, not deferred.** An earlier draft listed it above as a follow-on.
That was wrong and would have been actively harmful: the addendum **outranks every ADR** (`docs/adr/README.md`
precedence order; CLAUDE.md "wins every argument"), so leaving §22 saying the Node shape is conditional on
a spike would leave the top-precedence document contradicting this one — and a future agent applying
precedence *correctly* would resolve **against** ADR-0009. The owner ratified the target change, so
writing it into §22 is execution of that decision, not a new one. The amendment is marked
ratified-by-owner, states that only the shape choice closed (module-boundary independence is unchanged),
and preserves the original text below it.

## Verification

Two tiers, because this ADR is `accepted` on owner authority rather than on running code. The
`docs/adr/README.md` ladder (`proposed` → `accepted` when the evidence exists) measures *technical*
proof of a decision the team made; here the decision is the owner's, and what remains to prove is the
deploy, not the choice. Tier 1 is what this PR carries; tier 2 is M3.

**Tier 1 — satisfied by the PR that introduces this ADR:**

1. The second target is absent, asserted as a **property** rather than as a file inventory that M2.14's
   drainer entrypoint would immediately make stale: `git ls-files | grep -i cloudflare` returns nothing
   (no Worker entrypoint or fixture survives under any name), `git grep -n build:server:cloudflare --
   package.json apps .github/workflows` returns no match (no script, no CI step), and
   `apps/server/tsup.config.ts` exports exactly one build target.
2. `pnpm typecheck && pnpm lint && pnpm boundaries && pnpm build && pnpm test:unit` exits 0, with
   `pnpm build` producing `apps/web/dist` and `apps/server/dist/node/main.js` and nothing else.
3. `render.yaml` exists at the repository root, declares `plan: free`, `runtime: node`,
   `healthCheckPath: /healthz`, and carries no secret value.

**Tier 2 — M3 (see the implementation plan's M3 section):** the service is live on Render, `/healthz`
answers 200 over TLS from the public URL, and the deployed process reports `current_user =
session_user = 'app_rw'` (ADR-0002's S3a check, which outlived the spike that introduced it).
