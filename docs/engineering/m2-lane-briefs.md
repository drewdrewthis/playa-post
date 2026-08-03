# M2 — Implementation lane briefs

> **Status:** proposed, 2026-08-03. **Revised 2026-08-03** after a devil's-advocate stress
> test returned "proceed with modifications" — five blocking findings, several advisories,
> and a recommendation on each of the four questions the first draft left open. All four
> are now **decided and recorded with rationale** (§"Ratified decisions"); the open-question
> list is gone. What changed and why is in the revision log at the end of this file.
>
> Decomposes `docs/engineering/implementation-plan.md` §"M2 — First production vertical
> slice" (work items M2.1–M2.20, acceptance criteria M2-AC1–AC26) into seven sequenced
> lanes that agents can be dispatched against.
>
> **This document is subordinate.** Precedence, highest first:
> `docs/engineering/architecture-addendum.md` (normative) →
> `docs/engineering/implementation-plan.md` → `docs/adr/` → this file. Where this file
> and any of those disagree, they win and this file is the bug.
>
> This file adds no scope and defines no new acceptance criteria. It says **who does what,
> in what order, and what they must not touch.**

## How to use this document

1. Find the lane. Read its brief top to bottom.
2. Dispatch `test-expert` with the lane's **named scenarios** (`specs/README.md` requires
   an implementation brief to cite scenario *names*, not feature files). It writes
   failing tests only.
3. Dispatch `coder` with the same brief plus the now-failing tests. It makes them pass.
4. The orchestrator runs the lane's gate commands. Nobody self-reports green.
5. One PR per work item, with the migration carve-out in **C1a** below.

---

## Lane map

| Lane | Name | Work items | Feature files | Scenarios | Starts after |
|---|---|---|---|---|---|
| **L0** | Platform prerequisites | M1b.1/.3/.4/.5/.6/.7, M2.2, M2.3 | — | 0 | now |
| **L1** | Identity + migration spine | M2.1 (first migration), M2.4 | `identity-magic-link` | 9 | L0 complete |
| **L2** | Invitations, connections, trust, graph | M2.5, M2.6, M2.7 | `invitations`, `connections`, `directional-trust`, `graph-visibility` | 21 | L1 complete |
| **L3a** | Bulletins + board | M2.8, M2.9 | `bulletin-request-lifecycle`, `board-visibility-query` | 14 | L2 complete |
| **L3b-infra** | Outbox drainer + audit | M2.14, M2.15 | `notify-me` (2 scenarios) | 2 | **L2's migration lands** |
| **L3b-notify** | Notify Me + push | M2.10, M2.11 | `notify-me` (8 scenarios) | 8 | L3a complete |
| **L4** | Moderation + offline sync | M2.12, M2.13 | `moderation-report-dismiss`, `offline-replay` | 10 | L3a complete; **B13 gate joins on L3b-notify** |
| **L5** | Web, e2e, security suite | M2.16–M2.20 | `vertical-slice-e2e` | 2 | L3a, L3b-*, L4 complete |

**66 scenarios total**, reconciling to `specs/README.md`: 12 `@e2e`, 44 `@integration`,
10 `@unit`.

```text
L0 ─▶ L1 ─▶ L2 ─┬─▶ L3b-infra ─────────────────────┐
                │                                   │
                └─▶ L3a ─┬─▶ L3b-notify ─┬──────────┤
                         │               ⋮ (B13)    │
                         └─▶ L4 ─────────┴──────────┴─▶ L5
```

`⋮ (B13)` is a **join, not a dependency**: L4 builds and merges independently of
L3b-notify, but cannot flip its B13 row until `notifyMe.update` exists. See **C13**.

**L3b splits because its two halves have different upstreams.** The drainer and audit
handler need `app.outbox_events` and `app.consumer_receipts` — which are L2's tables (see
§"Ratified decisions" (a)) — and nothing else. Notify Me and push need bulletins. Keeping
them fused would have blocked M2-AC23/AC24, which are pure infrastructure assertions,
behind the entire bulletins lane for no reason.

This is the only meaningful parallelism in M2 and it is deliberately narrow: the slice is
a chain, and pretending otherwise is how integration risk gets deferred to the end (plan
§"Alternatives considered": *"Build modules horizontally, then integrate — forbidden"*).

### Module ownership — one module, one lane, no exceptions

| Module (`apps/server/src/modules/`) | Owning lane |
|---|---|
| `identity` | L1 |
| `connections` | L2 |
| `graph` | L2 |
| `bulletins` | L3a |
| `views` | L3a (grammar), L3b-notify (Notify Me) |
| `notifications` | L3b-notify |
| `audit` | L3b-infra |
| `moderation` | L4 |
| `sync` | L4 |
| `storage` | **not built in M2** (plan: "nothing in the slice uploads a file") |

Nine modules. M2-AC26 requires `pnpm boundaries` and `pnpm test:security` green with
exactly these nine present and no cross-module persistence import.

The outbox drainer (M2.14) is an **entrypoint**, not a module —
`apps/server/src/entrypoints/` — running in-process with the API (ADR-0006, ADR-0009).

Every module follows the addendum §4 shape:

```text
modules/<name>/
├── transport/        <name>.router.ts · <thing>.input.ts · <thing>.presenter.ts
├── application/      <verb>-<thing>.service.ts · list-<things>.query.ts
├── domain/           <thing>.ts · <thing>.policy.ts · <thing>.events.ts
│                     <thing>.errors.ts · <thing>.repository.ts (the interface)
├── persistence/      postgres-<thing>.repository.ts · <thing>.mapper.ts · sql/*.sql
├── tests/            domain/ · application/ · integration/
└── <name>.module.ts  the single exported factory (ADR-0003:37-39)
```

**Do not create a layer you have no file for.** Addendum §4 forbids placeholder layers
and M1b.7's fitness test (issue [#5](https://github.com/drewdrewthis/playa-post/issues/5))
fails the build on one — it is vacuous today and load-bearing the moment L1 creates
`modules/`.

### What `@e2e` means in a lane, and what it does not

**Blocking finding B-1 from the stress test: the first draft told L2 to run browser e2e
against a frontend that does not exist until L5.** That was unexecutable. The rule now:

| Tag | Level | Who runs it |
|---|---|---|
| `@unit` | Pure logic, no I/O, collaborators may be faked | the owning lane |
| `@integration` | Authorization, transactions, events, SQL correctness, boundaries; external services mocked only | the owning lane |
| `@e2e` **in L1–L4** | **API-level full-stack** — real database, real tRPC router, real auth context, real outbox. **No browser.** Nothing mocked except the Web Push transport and the JWT issuer. | the owning lane |
| `@e2e` **in L5** | **Browser.** Playwright, two contexts. Exclusive to `vertical-slice-e2e.feature`. | L5 |

Eleven of the twelve `@e2e` scenarios are API-level and belong to L1–L4. **One** —
`vertical-slice-e2e.feature` › "The full addendum §23 flow passes as eleven named steps" —
is the browser proof, and it is M2-AC1, the milestone exit signal. Tag accounting is
unchanged (12/44/10); only the *execution substrate* of the eleven is pinned.

This preserves what C12 was actually for. `specs/README.md` calls the per-module `@e2e`
scenarios "deliberate duplication of *flow lines*, not of *invariants*" — each proves a
different module's contract end to end. That works at the API level. It does not require a
browser, and requiring one would have forced every module lane to wait for L5.

### Migration ownership

Derived per-lane; **each lane reconciles the inventory in its own migration PR** (ratified
decision (a)). The plan says "the thirteen slice tables" and names none, so this table is
the working inventory, not a quotation.

| # | Table | Owning lane | Source |
|---|---|---|---|
| 1 | `app.users` | L1 | ADR-0008:22-34 |
| 2 | `app.invitations` | L2 | plan M2.5 |
| 3 | `app.connections` | L2 | plan M2.5 |
| 4 | `app.connection_trust` | L2 | ratified (b) — separate table, `(owner_id, subject_id)` |
| 5 | `app.outbox_events` | **L2** | ADR-0006 — moved earlier, see (a) |
| 6 | `app.consumer_receipts` | **L2** | ADR-0006 — moved earlier, see (a) |
| 7 | `app.bulletins` | L3a | plan M2.8 — `version` column (ADR-0005) |
| 8 | `app.audit_entries` | L3b-infra | plan M2.15 |
| 9 | `app.notify_me_queries` | L3b-notify | ADR-0007:77-79 — **PK on `owner_id`** (D1 as a constraint) |
| 10 | `app.push_subscriptions` | L3b-notify | plan M2.11 |
| 11 | `app.bulletin_reports` | L4 | plan M2.12 |
| 12 | `app.bulletin_dismissals` | L4 | plan M2.12 |
| 13 | `app.mutation_results` | L4 | ADR-0005:39-47 |

Plus one SQL function beyond `app.visible_people`: **`app.visible_bulletins` is L3a's**
(blocking finding B-3), living in `modules/bulletins/persistence/sql/`.

Not M2 tables: `app.saved_views` (ADR-0007:77 — saved views cut to M5),
`app.user_contact_fields` and `app.handle_tombstones` (ADR-0008:35-36 — contact fields and
erasure cut to M5).

**L5 exit assertion (ratified (a)):** a test asserts
`SELECT count(*) FROM pg_tables WHERE schemaname='app'` equals the inventory above, and
any delta is explained in the L5 PR rather than discovered. A table that appeared without
a lane owning it is the failure this catches.

**Every migration in every lane obeys the same five rules**
(`supabase/migrations/README.md`, and the baseline migration's own instructions at
`supabase/migrations/20260730195954_create_security_baseline.sql:193-196`):

1. Generate the filename with `supabase migration new <verb>_<subject>` — never
   hand-author, rename, or **pre-allocate** a timestamp.
2. `set role app_migrator;` before the first `create table`.
3. Per table, in this order:
   ```sql
   create table app.<t> ( ... );
   select app.apply_rls_backstop('app.<t>');
   grant select, insert, update, delete on table app.<t> to app_rw;
   -- and, if it has a bigserial/identity column:
   grant usage, select on sequence app.<t>_id_seq to app_rw;
   ```
   Never hand-write the four ADR-0002 §4 statements — the backstop function
   (`…create_security_baseline.sql:207-249`) is the only sanctioned way to apply them,
   and B3 fails any table whose shape drifts.
4. Never edit a merged migration. Forward-only; there are no down-migrations.
5. Ship the schema change's integration test in the same PR, run via
   `startPostgresTestDatabase({ migrationsDirectory })`.

**The canary drop belongs to whichever migration creates the first product table**, which
is L1's `app.users` by construction. `app.security_baseline_canary` and
`app.security_baseline_canary_seq` exist so B1/B3/B4 do not quantify over an empty set
(`…create_security_baseline.sql:265-266`). Dropped earlier, those rows go vacuous; dropped
later, two tables claim to be the canary. The rule is phrased as a property, not as "L1",
so it stays correct if lane order moves.

---

## L0 — Platform prerequisites

**Scope.** Everything M2 code sits on that does not exist yet. No feature file, no
scenario. L0 is the reason M2 does not start today.

> **Blocking finding B-5: the first draft under-scoped this lane badly.** Measured against
> the tree at `09d0679`, **none** of `kysely`, `@trpc/server`, `@trpc/client`,
> `@supabase/supabase-js`, `jose`, `pino`, `dexie`, or `web-push` is a dependency anywhere
> in the workspace — the only runtime dependency in any `package.json` is `zod`, in
> `packages/configuration`. `packages/database` and `packages/observability` **do not
> exist**; they are from-zero packages, not "remainders". `db:migrate` and `db:types` are
> not scripts. L0 is the largest lane in M2 by unfamiliar surface, and it was written as
> the smallest.

| Item | What ships | Plan gate |
|---|---|---|
| **M1b.5** | Nine **named** CI jobs (`typecheck`, `lint`, `lint:boundaries`, `test:unit`, `test:integration`, `test:security`, `build:web`, `build:server:node`, `secret-scan`) + branch protection. Issue [#4](https://github.com/drewdrewthis/playa-post/issues/4). | **any M2 merge** |
| **M1b.1** | `packages/database` from zero: `kysely`, `db:migrate`, `db:types`, `seed/`, `sql/`, checked-in types at `packages/database/src/schema.ts` + a CI drift check (M1-AC3). | any M2 repository or migration |
| **M1b.3** | B2 — **its own work item, see below.** | M2's first viewer-scoped query |
| **M1b.4** | `packages/observability` from zero: logger + redaction allowlist, correlation IDs, OTel span-attribute redaction (M1-AC11, ADR-0002 Q3). | M2 logging anything request-shaped |
| **M1b.6** | PR template (AC + evidence + boundary checkbox), `.env.example`, secret-scan pre-commit hook mirroring the CI job (M1-AC12). | M2's first PR |
| **M1b.7** | The M1-AC13 no-placeholder-layers fitness test. Issue [#5](https://github.com/drewdrewthis/playa-post/issues/5). | M2 creating `modules/` |
| **M2.2** | `@trpc/server` + `@supabase/supabase-js` + JWT verification adopted; `packages/contracts` first entries; tRPC root + router registry; auth context → `Actor` → branded `ViewerId`. | — |
| **M2.3** | Composition root per ADR-0003 + the `no-container-outside-composition` boundary rule with its fixture (M1b.9, first half). | — |

**M1b.8** (`ac-index.md`, issue [#6](https://github.com/drewdrewthis/playa-post/issues/6))
is gated at *M2 exit*, not M2 entry. It runs alongside L5.

### M1b.5 — name the actor, because it is not a code change

Adding nine named jobs to `.github/workflows/ci.yml` is a PR. **Requiring them is a
repository-settings change**, and it needs the repository **owner** or a token with admin
scope. An agent with ordinary push access cannot do it and will report the lane green
having shipped only half of it.

**Split it explicitly:** (i) the workflow PR, done by the lane; (ii) the branch-protection
ruleset, done by the owner or with an admin token, evidenced by
`gh api repos/:owner/:repo/rulesets` output plus the M1-AC9 blocked-merge screenshot.
**(ii) is a hand-off, not a task.** Until it lands, every rule in the implementation plan
is advisory and every lane's "green" is the author's word.

*Boy-scout, same PR:* `vitest.config.ts:14` still reads "ten named jobs" — stale since
ADR-0009 cut the list to nine. One line, in the file L0 is already editing.

### M1b.3 / B2 — its own work item, and the biggest hidden cost in M2

B2 asserts that a request to the **Supabase REST endpoint** for every table in `app`
returns 404 / `PGRST106` with a valid user JWT. The existing Testcontainers harness starts
**bare `postgres:17`**. It cannot serve this assertion at all: there is no PostgREST, no
GoTrue, and no JWT issuer in it.

B2 therefore needs a **second test harness** — either the `supabase` CLI stack in CI, or a
PostgREST + GoTrue compose stack with a signing key the tests can mint JWTs against. That
is infrastructure work with its own runtime cost and its own CI job shape, and burying it
as a sub-bullet of "M1b remainder" is how it silently becomes M3's problem. **Give it a
work item, a PR, and a decision on which of the two stacks before L1 starts.**

> **Decided and shipped — [ADR-0010](../adr/ADR-0010-supabase-rest-security-harness.md).**
> Neither of the two, in the end: a purpose-built **PostgREST-only** pair
> (`startSupabaseRestTestStack()` in `@playa-post/testing`), started with the `[api] schemas`
> list read from `supabase/config.toml`, with JWTs minted in-process. GoTrue was rejected
> because PostgREST cannot distinguish its token from a locally-signed one, so it would cost
> a container, the `auth` schema, and a sign-up flow to buy nothing the control asserts; the
> CLI stack was rejected on PR #13's precedent ("eight containers and a new job"). **No CI
> change at all** — it runs inside the existing `test:security` job. B2 is `live` in
> `b-rows.manifest.json`. B16 (storage) is the next row on this surface and should extend
> this stack rather than introduce a third.

### M2.2 — contracts, tRPC, `Actor`, `ViewerId`

- `packages/contracts/src/index.ts` is currently a deliberately empty barrel and is the
  **only** legal import surface from `apps/web` into the server side
  (`no-web-to-server-internals`). Read `packages/contracts/README.md` before adding.
- `Actor` is resolved **once**, at the tRPC context boundary (ADR-0008:63-64). No
  application service ever sees a JWT or a Supabase client.
- `ViewerId` is branded with **exactly one constructor, taking an `Actor`**
  (ADR-0002:177-179). This is R14's only mitigation: a `viewerId` accepted from request
  input is total silent impersonation.
- **No procedure input schema anywhere may carry a `viewerId`, `userId`, `actorId`, or
  `ownerId` field** (ADR-0002:180-181). M2-AC20/B14 proves this by walking the router
  **type tree**, not by grep. Build that walker here, while the tree is one procedure
  wide — retrofitting it across nine modules in L5 is the expensive order.
- Auth boundary contract: no token → 401; tampered token → 401; valid token with
  incomplete onboarding → 403 `ONBOARDING_REQUIRED` (M2-AC2). The three scenarios live
  in `identity-magic-link.feature` and are **L1's** to make pass; L0 ships the mechanism.

### M2.3 — composition root

ADR-0003:20-30 mandates exactly four files under `apps/server/src/composition/`:

```text
composition/config.ts          Zod-validated env -> typed Config
composition/container.ts       buildAppContainer(config): AppContainer
composition/request-scope.ts   buildRequestScope(app, ctx): RequestScope
composition/registrations.ts   per-module factories, one export per module
```

- **No DI library.** Awilix, tsyringe, and Nest are all explicitly rejected
  (ADR-0003:49-51). Building one instead requires an ADR (addendum §18).
- Each module exports one factory: `create<Name>Module(deps): <Name>Module`, where the
  deps interface is the module's declared dependency contract (ADR-0003:37-40).
- Unit tests instantiate classes directly with hand-built fakes, never through the
  composition root (ADR-0003:42-43).
- Watch `registrations.ts` — passing ~300 lines is ADR-0003's own revisit trigger.

### The three fitness rules L0 and L1 own

Each ships **with the code it binds to**, each with a deliberately-violating fixture under
`tests/fitness/__fixtures__/<rule-name>/`, and `tests/fitness/boundaries.fitness.test.ts`
asserts each fixture trips its own rule **and no other**.

| Rule | Ships in | Binds to |
|---|---|---|
| `no-container-outside-composition` | **L0** (M2.3) | only `entrypoints/**` and `composition/**` may import `container.ts` (ADR-0003:41) |
| `no-sql-outside-persistence` | **L1** (first repository) | M2-AC15's secondary rule. **Not a bare `SELECT` grep** — a named AST/`sql`-tag-aware detection rule with its own fixture. M1-AC2 records that dependency-cruiser is the wrong tool for it, because it is a rule about string literals, not import edges. |
| **`sql-table-ownership`** (new — blocking finding B-3) | **L1** (first checked-in `.sql`), extended per lane | Each module's checked-in SQL under `modules/<m>/persistence/sql/` references **only that module's own tables** plus the sanctioned `app.visible_*` functions. |

**Why the third rule exists.** dependency-cruiser and B12 both operate on the *import*
graph. A `.sql` file is opaque to them: `modules/bulletins/persistence/sql/board.sql` can
join `app.connections` directly, re-deriving reachability instead of composing L2's CTE,
and **every** existing gate stays green. That is R2 — the plan's only Critical-severity
risk — with the enforcement blind exactly where the leak would live. The rule is a parse
of the checked-in SQL against a per-module table allowlist; it is the only thing standing
between C8 and a silent second definition of "who can this viewer reach".

**Do not "fix" a fixture.** Adding a rule without adding its fixture fails
`boundaries.fitness.test.ts` on purpose.

**Must not touch:** `apps/server/src/modules/` (does not exist yet — L1 creates it),
any `supabase/migrations/*.sql`, any feature file.

**Gate.**

```bash
pnpm typecheck && pnpm lint && pnpm boundaries && pnpm test:unit
pnpm test:integration          # Docker daemon required
pnpm test:security             # must list all eighteen B-row IDs
pnpm db:reset && pnpm db:types && git diff --exit-code packages/database/src/schema.ts
```

Plus: **B2 flipped to `"status": "live"` with `"provenBy"` naming its test file** in
`tests/security/b-rows.manifest.json`, a PR showing **nine named checks**, and a
screenshot of a blocked merge on a deliberately-failing `lint:boundaries` (M1-AC9).

---

## L1 — Identity + migration spine

**Scope.** `modules/identity`, the first product migration, and the first repository.
Work items **M2.4** and the first slice of **M2.1**.

**Feature file:** `specs/features/identity-magic-link.feature` — **9 scenarios**
(3 `@unit`, 6 `@integration`, no `@e2e`).

| Tag | Scenario |
|---|---|
| `@integration` | Request with no bearer token is unauthorized |
| `@integration` | Request with a tampered token is unauthorized |
| `@integration` | Valid token with incomplete onboarding is blocked from the slice |
| `@unit` | Reserved handle is rejected at onboarding |
| `@unit` | Out-of-charset handle is rejected |
| `@unit` | Over-length handle is rejected |
| `@integration` | Handle differing only by case from an existing handle is rejected |
| `@integration` | Confusable of an existing handle is rejected |
| `@integration` | Changing an already-chosen handle is rejected |

**ACs:** M2-AC2 (auth boundary), M2-AC25 (handle rules — six structured codes).
**M1-AC10 becomes load-bearing here**: `DATABASE_URL` is M2's first genuinely required env
var, and M1-AC10 is documented as vacuous-for-absence until one exists. L1 proves it —
boot with the key absent, exit non-zero within 2 s naming the key and its type, printing
no other secret's value.

**B-rows:** none flipped, but `app.users` is what makes B1, B3, and B4 non-vacuous against
real data for the first time — and the same migration deletes the canary standing in for it.

**Migration.** One migration doing three things:

1. `create table app.users (...)` — **verbatim from ADR-0008:22-34**, not paraphrased.
   The first draft of this document silently dropped four `not null` constraints:
   ```sql
   app.users (
     id             uuid primary key default gen_random_uuid(),
     auth_user_id   uuid unique not null,
     handle         citext unique not null,
     display_name   text not null,
     avatar_path    text,
     status         text not null default 'active',
     created_at     timestamptz not null,
     deactivated_at timestamptz,
     erased_at      timestamptz,
     version        int not null default 1
   )
   ```
2. `select app.apply_rls_backstop('app.users');` then the explicit per-table grants.
3. `drop table app.security_baseline_canary;` and
   `drop sequence app.security_baseline_canary_seq;`

**No `email` column, anywhere in schema `app`** (ADR-0008:20). `auth_user_id` is the only
bridge to `auth.users` and deliberately **not** a cross-schema foreign key. Ship the
fitness test asserting the absence of an email column in this lane — one line, and it
never gets written later.

**Module layout.**

```text
modules/identity/
├── transport/    identity.router.ts · complete-onboarding.input.ts · user.presenter.ts
├── application/  complete-onboarding.service.ts · resolve-actor.query.ts
├── domain/       user.ts · handle.ts · handle.policy.ts · user.events.ts
│                 user.errors.ts · user.repository.ts
├── persistence/  postgres-user.repository.ts · user.mapper.ts
├── tests/        domain/ · application/ · integration/
└── identity.module.ts
```

Handle rules live in `domain/handle.policy.ts` as pure logic — that is what makes the
charset/reserved/length scenarios `@unit` with no I/O. Case-collision and confusable
checks need the database (`citext unique`), hence `@integration`.

**Handle rules, all five** (ADR-0008:50-57): `citext` unique, `[a-z0-9_]{3,24}`, a
reserved-word blocklist, a confusable-normalization check, and immutability
(`HANDLE_IMMUTABLE`). Per escalation E5, **there is no handle-availability endpoint** — a
taken handle returns a generic "not available" on submit, because an availability check is
a people-existence oracle in a product whose PDF §4 promises there is no people search.

**Must not touch:** any other `modules/` directory, `composition/` beyond the `identity`
registration line, `packages/contracts` beyond the identity entries, the merged baseline
migration.

**Gate.** All 9 scenarios by name; `pnpm test:unit`; `pnpm test:integration`;
`pnpm boundaries`; `pnpm test:security`; the nine named CI jobs green.

---

## L2 — Invitations, connections, trust, graph

**Scope.** `modules/connections` and `modules/graph`. Work items **M2.5**, **M2.6**,
**M2.7**, and the migration for tables 2–6.

**Feature files — 21 scenarios:**

| File | Scenarios | Split |
|---|---|---|
| `invitations.feature` | 6 | 3 `@unit`, 3 `@integration` |
| `connections.feature` | 5 | 1 `@e2e` (API-level), 4 `@integration` |
| `directional-trust.feature` | 7 | 1 `@e2e` (API-level), 6 `@integration` |
| `graph-visibility.feature` | 3 | 1 `@e2e` (API-level), 2 `@integration` |

**ACs:** M2-AC17 (invite token), M2-AC3 (trust privacy, B6), M2-AC4 (unset ≠ zero),
M2-AC5 (visibility, B5 — the graph half), and the connections/trust rows of M2-AC18 and
M2-AC19.

**B-rows flipped live:** **B5** (visibility matrix, graph half incl. the §6a
person-projection sub-case), **B6** (directional trust never leaves the holder), **B8**
partial (hidden-people payload shape), **B13** partial (`connection.accept`, `trust.set`).

**Migrations.** `app.invitations`, `app.connections`, `app.connection_trust`,
**`app.outbox_events`**, **`app.consumer_receipts`** — backstop + grants each.

The two outbox tables are here, not in L3b, because **M2-AC19 already requires
`connection.accept` and `trust.set` to demonstrate zero `outbox_events` rows on an
unauthorized write.** An AC that counts rows in a table needs the table. This is a flat
statement of ownership, not a contingency (ratified (a)).

### M2.5 — invite create / open / accept

- Opaque revocable token from a **CSPRNG, ≥ 16 bytes**, not derived from any user ID or
  handle. M2-AC17 requires a fitness rule failing a non-CSPRNG source **in that module**,
  10 000 distinct generated tokens, and a direct assertion that a token is not a prefix,
  suffix, or encoding of the inviter's ID or handle.
- Acceptance is transactional and emits `ConnectionAccepted` to `app.outbox_events` in the
  same transaction.
- Spent or revoked token → `INVITATION_UNAVAILABLE`.

### M2.6 — `SetConnectionTrust`

**`app.connection_trust` is a separate table keyed `(owner_id, subject_id)`** — ratified
decision (b), not an open call. Two reasons, both mechanical:

- **Fail-closed reads.** Trust as columns on `app.connections` means every query touching a
  connection must remember to project the trust columns away. Trust in its own table means
  a query that forgets to join simply does not have it. M2-AC3 asserts absence across six
  surfaces — success bodies, error envelopes, **and conflict envelopes** — and absence is
  cheaper to guarantee than removal.
- **Operator exclusion at table granularity.** ADR-0002:218-219 lists trust among what
  `app_operator_ro` must never read. A table-level `REVOKE` matches B3's assertion shape
  exactly; a column-level exclusion does not.

Model `unset` as `NULL` on a column with **no `NOT NULL` and no default** — ADR-0004:70-71
is explicit that `unset` is a first-class value distinct from `0` and "must be modelled as
`NULL` … never defaulted to zero".

> **Open sub-decision for L2's first PR, then record it as an ADR-0002 amendment:** does
> accepting a connection insert a `connection_trust` row with `trust = NULL`, or is
> "unset" the absence of a row surfaced by a `LEFT JOIN`? Both satisfy M2-AC4's
> `trust: null` vs `0` serialization. They differ in what `SELECT trust` returns for a
> never-touched connection — M2-AC4's evidence clause is a literal `SELECT trust`, so the
> lane must pick one and the AC's evidence must match it.

M2-AC3's conflict-envelope case is the one that gets missed: a `trust.set` conflict must
not carry `currentState` for a connection the caller is not party to. ADR-0005:69-75 is
the reason — actorship is checked **before** version comparison, so an unrelated actor
never receives a conflict envelope at all.

### M2.7 — `app.visible_people` + read model + §6a projection

- `app.visible_people(viewer_id uuid, max_depth int, node_budget int)` — recursive CTE,
  **`SECURITY INVOKER`** (ADR-0004:25), with **`SET search_path = ''`**
  (ADR-0002:164 — that rule's home is ADR-0002's pooler-safety section, not ADR-0004).
- Checked in at `modules/graph/persistence/sql/visible-people.sql`, consumed by
  `ListVisibleGraphQuery` (ADR-0004:73-74).
- M2 restricts it to **the viewer plus accepted 1st-degree connections**. Degrees ≥ 2,
  ghost nodes, `path_via`, and truncation UI are M5. `max_depth` (default 4) and
  `node_budget` (default 1500) are operational bounds, **never a product depth cap**
  (ADR-0004:29-31).
- Blocked edges are pruned **inside the recursive term**, not post-filtered
  (ADR-0004:27-29). Blocking is M5, but build the seam now — retrofitting a prune into a
  post-filter is how B7 fails later.
- **ADR-0002 §6a is the load-bearing rule of this lane**: every person representation in
  every payload is projected through this function's `disclosure` level. No direct join to
  `app.users` for an author card, ever.
- **L2 owns the projection and exports it** (ratified (c)) — see C8 for the export shape.
- Edges incident to the viewer carry the viewer's own trust. Edges between two other people
  carry **no weight** — escalation E1, a pre-recorded visual deviation from the prototype.
- ADR-0004:83-85 asks for a p95 < 300 ms benchmark at a 5000-person synthetic network
  **from M2**, run in CI as a non-blocking report, blocking in M5. Ship the benchmark; do
  not gate on it.

**Must not touch:** `modules/identity` internals — import its public application interface
or a `packages/contracts` entry, never its `persistence/` or a domain entity.
`modules/bulletins` does not exist yet.

**Gate.** All 21 scenarios by name; `pnpm boundaries`; the new `sql-table-ownership` rule
green over `modules/graph/persistence/sql/`; `pnpm test:security` with **B5 and B6 flipped
to `"status": "live"` with `"provenBy"` naming their test files**.
**A B-row's manifest state is part of the diff, not a follow-up.**

---

## L3a — Bulletins + board

**Scope.** `modules/bulletins`, `modules/views` (grammar half). Work items **M2.8**, **M2.9**.

**Feature files — 14 scenarios:**

| File | Scenarios | Split |
|---|---|---|
| `bulletin-request-lifecycle.feature` | 6 | 1 `@e2e` (API-level), 5 `@integration` |
| `board-visibility-query.feature` | 8 | 2 `@e2e` (API-level), 2 `@integration`, 4 `@unit` |

**ACs:** M2-AC6 (transaction atomicity), M2-AC12 (archive lifecycle), M2-AC13 (grammar
boundaries — six responses, both sides of each boundary), M2-AC14 (narrow-only +
indistinguishability, B10/B17), M2-AC5 (board half + §6a author projection), plus the
bulletin rows of M2-AC18 and M2-AC19.

**B-rows flipped live:** **B10** (a filter narrows, never widens), **B17** (unauthorized
indistinguishable from non-existent), **B13** rows for `bulletin.create`, `bulletin.archive`.

**Migration:** `app.bulletins` with lifecycle timestamps and a `version` column
(ADR-0005 requires it for conflict handling).

### `app.visible_bulletins` — L3a's, and it composes rather than re-derives

Blocking finding B-3: the first draft referenced this function without assigning it an
owner, which is how two lanes end up writing it.

- **Owner: L3a.** Lives at `modules/bulletins/persistence/sql/visible-bulletins.sql`.
- **`SECURITY INVOKER`** (ADR-0004:25) with **`SET search_path = ''`** (ADR-0002:164).
- **It MUST compose `app.visible_people` as a subquery. It must never re-derive
  reachability by joining `app.connections` itself.** ADR-0004:75-77 is explicit: bulletin
  visibility uses *the same* authorized-people CTE — "one definition of 'who can this
  viewer reach', used by graph, board, search, Notify Me, and intro eligibility".
- Enforced by the new `sql-table-ownership` fitness rule: `modules/bulletins`' SQL may
  reference `app.bulletins` and the sanctioned `app.visible_*` functions, and nothing else.
  Without that rule this is a code-review promise, and R2 is what happens when it lapses.

### Bulletins and grammar

- `CreateBulletinService` and `ArchiveBulletinService`. **Request type only.** The
  `BulletinCreated` / `BulletinArchived` outbox events are written **in the same
  transaction as the insert** (M2-AC6: a fault after insert and before commit leaves 0 new
  rows in *both* `app.bulletins` and `app.outbox_events`).
- Archive is idempotent: a second archive returns HTTP 200 leaving `archivedAt` unchanged.
  Non-author `bulletins.getById` on an archived bulletin returns **404 `BULLETIN_GONE`**;
  the author's `bulletins.listMine` still returns it with `archivedAt` set.
- **Grammar restricted to `type:` and bare text.** ADR-0007's full grammar (`from:`, `tag:`,
  `loc:`, `deg:`, `trust:`, `is:`) is M5. Limits still apply: 16 terms, 256 characters.
  `type:note` rejected naming the token (D2); unknown field `foo:bar` **rejected, not
  ignored**.
- Compiles to **parameterized** SQL over the authorized set (ADR-0007:88-94) — bound params
  only, no string interpolation:
  ```sql
  WITH authorized AS (SELECT * FROM app.visible_bulletins(:viewer_id))
  SELECT … FROM authorized WHERE <compiled filter> ORDER BY <validated sort> LIMIT …
  ```
  The compiled filter can only **narrow** `authorized`. There is no widening seam. That is
  B10; M2-AC15's composition assertion (B12) proves the shape holds structurally.
- M2-AC14: a board query referencing an unauthorized bulletin ID and one referencing a
  never-existent UUID return **byte-identical bodies and identical status codes**. Evidence
  is an empty `diff`.

**Must not touch:** `modules/graph/persistence/` (consume the exported read model),
`modules/moderation`, `modules/sync`, `modules/notifications`.

**Gate.** All 14 scenarios by name; `pnpm boundaries`; `sql-table-ownership` green;
`pnpm test:security` with **B10 and B17 flipped to `"status": "live"` + `"provenBy"`**.

---

## L3b-infra — Outbox drainer + audit

**Scope.** The drainer entrypoint and `modules/audit`. Work items **M2.14**, **M2.15**.
**Starts when L2's migration lands** — it needs `app.outbox_events` and
`app.consumer_receipts` and nothing else.

**Scenarios — 2, both `@integration`, both from `notify-me.feature`:**

- "A throwing consumer is retried with growing backoff and eventually dead-lettered" (M2-AC23)
- "Two concurrent drainers claim disjoint events" (M2-AC24)

Both are pure infrastructure assertions over the outbox. Neither needs a bulletin, a push
subscription, or a Notify Me query — which is the whole reason this sub-lane exists.

**Migration:** `app.audit_entries`.

- Drainer: `FOR UPDATE SKIP LOCKED` claiming, backoff `least(15 min, 5s * attempts^2)`,
  dead-lettering after the 8th attempt, `consumer_receipts` for idempotent consumers.
  **In-process on the Node server** (ADR-0006, ADR-0009) — no cron variant, no second
  service. It is an **entrypoint**, not a module.
- Audit: `RecordAuditEntryHandler` consuming the slice's events, covering the ADR-0002 Q4
  list. Entries carry **internal IDs only** — no bulletin content, no contact data.

> **Two notes that belong to M3+, recorded so they are not discovered there.**
>
> **ADR-0006:87 names five scheduled jobs**: outbox drain (1 min), bulletin expiry sweep,
> notification grouping window flush, `mutation_results` prune (daily), and dead-event
> alert. **M2 owns only the drain**, and the grouping-window flush is folded into
> L3b-notify's 60 s window handler. The expiry sweep is M5-A3; the prune and the alert are
> unowned by M2 and need a home in M3 or M4. This document does not assign them; it records
> that they are unassigned.
>
> **M2-AC24's two-drainer topology cannot occur in the M3 deployment.** `render.yaml:15`
> is `plan: free` — a single instance, and ADR-0009 puts the drainer in-process with the
> API. Two concurrent drainers is a **local correctness proof** for the day the plan
> changes or a second instance appears, not a property of the deployed system. Prove it in
> Testcontainers; do not expect to observe it on Render.

**Must not touch:** `modules/notifications`, `modules/views`, `modules/bulletins`.

**Gate.** Both scenarios by name; `pnpm boundaries`; `pnpm test:integration`.

---

## L3b-notify — Notify Me + push

**Scope.** `modules/views` (Notify Me half), `modules/notifications`. Work items **M2.10**,
**M2.11**. **Starts after L3a** — it evaluates queries against bulletins.

**Scenarios — 8 from `notify-me.feature`** (2 `@e2e` API-level, 6 `@integration`):

| Tag | Scenario | AC |
|---|---|---|
| `@e2e` | A matching Request bulletin produces a grouped push notification | M2-AC7 |
| `@integration` | A second matching bulletin at 59 seconds joins the same group | M2-AC7 |
| `@integration` | A matching bulletin at 61 seconds starts a new group | M2-AC7 |
| `@e2e` | Delivering the same event twice produces one notification | M2-AC8 |
| `@integration` | Push payload carries only identifiers and a generic string | M2-AC21 |
| `@integration` | A recipient made unauthorized before flush does not receive the push | M2-AC22 |
| `@integration` | Subscribing to push twice is rejected | M2-AC18 |
| `@integration` | notifyMe.update fails closed for an actor unrelated to the query | M2-AC19 |

**Migrations:** `app.notify_me_queries` (**PK on `owner_id`** — D1 becomes a database
constraint, not a code check), `app.push_subscriptions`.

- Stores source text **plus** the validated AST with an `ast_version` (ADR-0007:77-79).
  `UpdateNotifyMeQuery` emits `NotifyMeQueryChanged`.
- `EvaluateNotifyMeHandler` on `BulletinCreated`; `SendGroupedPushHandler` with a **60 s
  window**. Both sides tested: a second bulletin at t = 59 s joins the group (one
  notification total); one at t = 61 s starts a second.
- **Delivery-time re-check** (ADR-0002:274-279): recipient authorization is re-evaluated in
  the send handler, **inside the receipt transaction**, immediately before dispatch. A
  recipient deactivated or disconnected between computation and flush is not delivered to,
  and the receipt records the suppression.
- **Push payloads carry identifiers and a generic string only** — no headline, body, author
  name, or contact data. M2-AC21's evidence is the payload quoted in full.
- Notification recipient resolution goes through **L2's exported §6a projection**, not a
  direct read of `app.users`.

**Must not touch:** the drainer (L3b-infra's), `modules/bulletins/persistence/`,
`modules/moderation`, `modules/sync`.

**Gate.** All 8 scenarios by name; `pnpm boundaries`; `sql-table-ownership` green;
`pnpm test:security` with the **`notifyMe.update` B13 row live**, which is what unblocks
L4's B13 flip (C13).

---

## L4 — Moderation + offline sync

**Scope.** `modules/moderation`, `modules/sync`. Work items **M2.12**, **M2.13**.
**Starts after L3a**, builds in parallel with L3b-*. **Its B13 gate joins on L3b-notify.**

**Feature files — 10 scenarios:**

| File | Scenarios | Split |
|---|---|---|
| `moderation-report-dismiss.feature` | 7 | 2 `@e2e` (API-level), 5 `@integration` |
| `offline-replay.feature` | 3 | 1 `@e2e` (API-level), 2 `@integration` |

**ACs:** M2-AC10 (report privacy, B9), M2-AC11 (dismissal is viewer-local), M2-AC9 (offline
replay), M2-AC14 (moderation half), M2-AC18/AC19 rows for `bulletin.report`,
`bulletin.dismiss`, and the sync envelope.

**Migrations:** `app.bulletin_reports`, `app.bulletin_dismissals`, `app.mutation_results`
(`mutation_id uuid PK, actor_id, mutation_type, request_hash, outcome, result jsonb,
created_at` — ADR-0005:39-47).

### M2.12 — report and dismiss

Reporting hides the bulletin **for the reporter, immediately**, and leaves it visible to
every other eligible viewer. **The reporter is never disclosed to the author** — M2-AC10
asserts no response reachable by the author contains the reporter's ID, handle, or display
name, across bulletin read, notifications, and the author's own bulletin list. Dismissal is
viewer-local and nothing else. No strike counts, no aggregation, no reason taxonomy (M5).

### M2.13 — sync envelope, idempotency, actorship

- `sync.submitMutations`, max batch 50, in `modules/sync` (ADR-0005:23-24). A handler
  registry maps `MutationType → handler` and dispatches to the **owning module's public
  application interface** — never into another module's persistence.
- M2 implements exactly one **replayable** mutation handler: `bulletin.create`. The
  **actorship precedence rule applies to every M2 mutation regardless**.
- `app.mutation_results` is written **in the same transaction as the effect and the outbox
  event**. Same `mutation_id` + matching `request_hash` → `replayed` with an identical
  `result`; same id + different hash → `rejected` / `IDEMPOTENCY_KEY_REUSE`. `mutation_id`
  is namespaced by `actor_id` in **every** lookup.
- Precedence, evaluated **before any handler** (ADR-0005:68-82): **(1) actorship before
  version comparison** — an unrelated actor never receives `currentVersion` or
  `currentState`; (2) erasure wins; (3) blocking wins; (4) revoked authorization re-checked
  at apply time, not enqueue time; (5) a stale mutation cannot resurrect archived data.

### The sync half of B13 is not vacuously green — and here is the ordering that makes it so

Blocking finding B-2. M2-AC19 requires **every** one of the seven mutation types to fail
closed for an unrelated actor "whether submitted via tRPC **or** via
`sync.submitMutations`". But M2 implements only **one** replayable sync handler. The
question the first draft did not answer: what does `sync.submitMutations` do with the other
six?

**If an unsupported-type rejection fires first, the sync column of B13 is green for the
wrong reason** — the test would prove "M2 doesn't implement this type", not "an unrelated
actor is refused". That is a passing test asserting nothing, which is the exact failure the
B-suite exists to prevent.

**The resolution is ordering, and ADR-0005 already mandates it.** Precedence is *"evaluated
before any handler"* (ADR-0005:68) and covers *"every identifier in a mutation payload …
verified to belong to, or be reachable by, the authenticated actor **before the handler
runs**"* (ADR-0005:69-72). So:

1. Parse and validate the envelope.
2. **Actorship precedence gate — type-agnostic, pre-dispatch.**
3. Type dispatch. An in-matrix type with no M2 handler → `rejected` with an
   `UNSUPPORTED_MUTATION_TYPE` code. (`outcome` must be one of
   `applied | replayed | conflict | rejected | expired` — ADR-0005:32 fixes the vocabulary;
   there is no `unsupported` outcome, so it is a `rejected` with a code.)

**The B13 test asserts the error *code* is the actorship failure, not
`UNSUPPORTED_MUTATION_TYPE`.** Asserting only "it failed" would pass under either ordering
and prove nothing. All six non-replayable types are in ADR-0005's v1 conflict matrix
(ADR-0005:88-98), so the gate has real identifiers to check in every case.

**Must not touch:** `modules/bulletins/persistence/` (call the public application
interface), `modules/notifications`, the drainer.

**Gate.** All 10 scenarios by name; `pnpm boundaries`; `pnpm test:security` with **B9
flipped to `"status": "live"` + `"provenBy"`** and the B13 matrix complete for all seven
mutation types **on both submission paths** — the last of which is the C13 join.

---

## L5 — Web, e2e, and the security suite

**Scope.** The frontend, the browser proof, and the B-suite rows that can only be asserted
once every module exists. Work items **M2.16–M2.20**.

**Feature file:** `specs/features/vertical-slice-e2e.feature` — **2 scenarios**
(1 `@e2e` **browser** "The full addendum §23 flow passes as eleven named steps", 1
`@integration` "The captured logs from a full slice run contain no sensitive data").

**ACs:** M2-AC1 (the exit signal), M2-AC16 (log hygiene), M2-AC15 (composition assertion,
B12), M2-AC20 (viewerId provenance, B14), M2-AC26 (regression across all nine modules).
Plus M1b.8 (`ac-index.md`) and the table-inventory exit assertion.

**B-rows:** **B12**, **B14** flipped live, and B5–B9/B13/B17 confirmed as a suite (M2.19).
**No row may remain `"status": "pending"` with `"pendingUntil": "M2"`.**

**Frontend, exactly as scoped:** sign-in, onboarding, graph home (1st degree), board list,
compose Request, person sheet with trust slider, report/dismiss, offline pending badge.
**Light theme only. No service worker yet.** Adopts `dexie` (from zero — see L0's
dependency note). Stores per ADR-0005:105-107 — `pendingMutations`
(`pending|inflight|failed|conflicted|synced` + attempts + lastError), `cachedGraph`,
`cachedBoard`, `syncMeta` — with visible pending/failed/conflicted/synchronized badges.

`apps/web` imports **only** from `packages/contracts`. That is the
`no-web-to-server-internals` rule and it is not negotiable.

**M2-AC1 is the exit signal and its shape is prescribed:** one Playwright run, **two
browser contexts**, structured as **eleven named `test.step()`s** matching the eleven lines
of the addendum §23 flow. A skipped step must be visible as a missing step in the report.
This is the **only** browser-driven test in M2.

**M2-AC16:** run the full flow with log capture and grep for four canaries — the bulletin
body, the invite token, a JWT, and an email address. Zero matches.

**Must not touch:** any module's `domain/` or `application/`. If L5 needs a behavior change
there, it is a defect in the owning lane and goes back to that lane. This is the same
property M3-AC8 later asserts with `git diff --stat`.

**Gate.** M2-AC1 green **on a machine that is not the author's**, with AC2–AC26 green in
CI, all nine named jobs, `pnpm boundaries` showing the **nine module names** in the
dependency-cruiser summary (M2-AC26), the `app.*` table-count assertion matching the
inventory, and `tests/security/b-rows.manifest.json` carrying no `"pendingUntil": "M2"`.

---

## TDD hand-off shape — every lane, no exceptions

**Step 1 — `test-expert`.** Brief it with:

- the lane's feature file paths **and the scenario names verbatim** (`specs/README.md`
  §"Rule for implementation briefs" requires names, not files);
- the lane's AC IDs quoted in full from the implementation plan, **including the evidence
  clause** — the AC is not the assertion, it is the assertion *plus* what proves it;
- the tag → level mapping from §"What `@e2e` means in a lane" above. **`@e2e` in L1–L4 is
  API-level: real DB, real router, real auth context, no browser.**
- the module's `tests/` layout and the filename-as-price convention: `*.unit.test.ts`,
  `*.integration.test.ts`.

It returns **failing tests only**. Run them and confirm they fail for the *right reason* —
a test that fails on a missing import proves nothing.

**Step 2 — `coder`.** Same lane brief plus the failing tests. It makes them pass and does
**not** run them; the orchestrator validates. Per
`~/.claude/references/model-selection.md`, use `advanced-coder` where the lane co-designs a
contract across modules — L0's `ViewerId`/context boundary, L2's §6a projection and its
export shape, L4's actorship precedence ordering — and `coder` elsewhere.

**Step 3 — orchestrator.** Runs the gate, flips the lane's B-rows **in the same PR**, opens
the draft PR with real command output.

**Test-double rule** (`~/.claude/references/principles/coding.md`): don't mock what you own.
Prefer a fake — in-memory repository, fake clock — over a mock. **The 60 s grouping window
needs a fake clock, not a `sleep`**; `notify-me.feature`'s 59 s / 61 s pair is unrunnable
otherwise. Assert on emitted behavior and state, never call sequences. Mock only at a
boundary you cannot cheaply or deterministically call: the Web Push transport and the
Supabase Auth JWT issuer.

**B-row manifest schema** — `tests/security/b-rows.ts:120-145` accepts exactly two shapes
and **throws on anything else, including the word `implemented`**:

```jsonc
{ "id": "B5", "title": "…", "assertion": "…",
  "status": "live",    "provenBy": "tests/security/<file>.security.test.ts" }

{ "id": "B2", "title": "…", "assertion": "…",
  "status": "pending", "pendingUntil": "M1b.3", "reason": "…" }
```

Flipping a row means `status: "pending"` → `"live"`, **deleting `pendingUntil` and
`reason`**, and **adding `provenBy`** pointing at the test that executes the assertion.

**Scenario counts per lane:**

| Lane | `@unit` | `@integration` | `@e2e` | Total |
|---|---|---|---|---|
| L1 | 3 | 6 | 0 | 9 |
| L2 | 3 | 15 | 3 | 21 |
| L3a | 4 | 7 | 3 | 14 |
| L3b-infra | 0 | 2 | 0 | 2 |
| L3b-notify | 0 | 6 | 2 | 8 |
| L4 | 0 | 7 | 3 | 10 |
| L5 | 0 | 1 | 1 | 2 |
| **Total** | **10** | **44** | **12** | **66** |

Of the twelve `@e2e`, **eleven are API-level** (L1–L4) and **one is browser-driven** (L5).

---

## Ratified decisions

The first draft left four questions open. All four are decided. Recorded here with
rationale so a later lane does not reopen them by accident.

**(a) The thirteen-table inventory is derived per-lane and reconciled at the door.** The
plan names none, so a single up-front authoritative list would be a guess dressed as a
spec. Instead each lane's migration PR reconciles its own rows against the table in
§"Migration ownership", and **L5 asserts the total** — `count(*)` over `pg_tables` in
schema `app` equals the inventory, with any delta explained in the PR. A wrong guess now
surfaces as a reconciliation diff in one lane rather than as five lanes inheriting it.

Consequently **`app.outbox_events` and `app.consumer_receipts` are L2's**, stated flatly
rather than as C3's "move them if a lane needs them". M2-AC19 already requires zero
`outbox_events` rows to be demonstrable for `connection.accept` and `trust.set`, both L2
mutations. The contingency was never contingent.

**(b) `app.connection_trust` is a separate table keyed `(owner_id, subject_id)`.** Reasons
in L2's brief: fail-closed reads (a query that forgets to join has no trust to leak, versus
a query that forgets to project it away), and table-granularity operator exclusion matching
B3's assertion shape (ADR-0002:218-219). One sub-decision stays open **for L2's first PR
only** — row-at-accept-with-`NULL` versus `LEFT JOIN`-absence — and it is recorded as an
ADR-0002 amendment when made, because M2-AC4's evidence clause is a literal `SELECT trust`
and the two shapes return different things.

**(c) C8 stands: L2 owns the §6a person projection; L3a and L3b-notify consume it.**
ADR-0004:73-74 already places the read model in `modules/graph`, and ADR-0004:75-77 already
says bulletin visibility composes the same CTE. Two amendments:

- **Export a read-model / DTO, not a domain entity.** Addendum §19 forbids importing
  another module's internal domain entity; exporting one would make every consumer a
  boundary violation and defeat the point.
- **The interface is not frozen.** L2 designs it with one consumer in mind and will get it
  slightly wrong. **L3a's first consuming PR is explicitly allowed to change the
  signature** — that is cheaper than L3a working around a bad fit and re-deriving what it
  needs.
- **Named residual:** the SQL layer. The projection can be bypassed inside a `.sql` file
  with no import edge to catch it. Closed by the new `sql-table-ownership` fitness rule
  (L0/L1). Without that rule, (c) is a convention, not a control.

**(d) L3b splits into L3b-infra and L3b-notify.** Different upstreams: the drainer and
audit need only L2's outbox tables; Notify Me and push need L3a's bulletins. Fusing them
put M2-AC23/AC24 — pure outbox infrastructure — behind the entire bulletins lane for no
reason. Reflected in the lane map, the dependency diagram, and the module ownership table.

---

## Risks — where lanes collide, and the serialization rule for each

| # | Collision | Why it happens | Serialization rule |
|---|---|---|---|
| **C1** | **`supabase/migrations/`** — two lanes generate migrations concurrently | Filenames are timestamps from `supabase migration new`. Two branches produce two files that both apply, in an order neither author chose. Nothing merges cleanly *and* nothing conflicts, which is worse. | **One open migration PR per dependency chain**, not repo-wide. Repo-wide serialization would forbid exactly the parallelism (d) creates. L3b-infra's `app.audit_entries` and L4's report tables cannot interact — they touch disjoint tables — and CI already catches the dangerous case: the Testcontainers harness replays every migration from scratch against the **merge ref**, so an order-dependent pair fails there. **Do not pre-allocate timestamps** to dodge this; `supabase/migrations/README.md` forbids hand-authoring them, and a reserved-but-unmerged timestamp is a worse lie than a conflict. |
| **C1a** | **C1 versus "one PR per work item"** | A lane with three tables and four work items cannot both serialize its migrations and keep one PR per item. | **The lane-opening migration PR carries all of that lane's tables at once**, with shape tests only — backstop applied, grants correct, columns present. Behavior tests land with the work-item PRs that follow. One migration PR per lane, then N feature PRs. |
| **C2** | **The canary drop** | Must be in the same migration as the first product table; a lane opening a migration first will be tempted to drop it. | Belongs to **whichever migration creates the first product table** — L1's `app.users` by construction. Phrased as a property, not as "L1", so it survives a reordering. |
| **C3** | ~~`app.outbox_events` needed before L3b owns it~~ | — | **Closed by ratified decision (a).** The tables are L2's. Not a contingency. |
| **C4** | **`packages/contracts/src/index.ts`** — the barrel every lane appends to | Single export list, only legal web↔server surface, every lane touches it. | Each lane exports from **its own file** (`contracts/src/<module>.ts`); the barrel gains **one re-export line per lane**, appended at the end. A one-line append conflicts trivially; a shared inline type block does not. |
| **C5** | **tRPC router registration** | Same shape as C4: one root router, N lanes. | One `<module>.router.ts` per module, one registration line appended. **The registration line and the module's first procedure land in the same PR** — a registered-but-empty router is the placeholder addendum §4 forbids. |
| **C6** | **`composition/registrations.ts`** | Every lane adds a factory call. | One line per module, appended, in the same PR as the module. Watch ADR-0003's ~300-line revisit trigger. |
| **C7** | **`tests/security/b-rows.manifest.json`** | Seven lanes flip rows in one JSON file. | Flip **only your own lane's rows**, in the PR that implements them, using the `live`/`provenBy` schema. Never batch flips into a "manifest update" PR — that severs the row from its proof, which is the exact failure the manifest exists to prevent. |
| **C8** | **The §6a person projection, implemented three times** | Graph (L2), board author cards (L3a), notification recipients (L3b-notify) each need a projected person. Three lanes, three plausible implementations, one subtly wider. **This is R2, the plan's only Critical-severity risk.** | **L2 owns it and exports a read-model DTO**; L3a and L3b-notify consume it. Signature not frozen — L3a's first consumer may change it. B12 catches import-layer violations; **`sql-table-ownership` catches the SQL-layer ones**, which B12 cannot see. |
| **C9** | **`.dependency-cruiser.cjs` + `boundaries.fitness.test.ts`** | Three rules land across L0 and L1 touching one config and one test. | Serialized by the L0→L1 dependency. Each rule lands **with its own fixture directory**; the fitness test asserts each fixture trips its own rule and no other. |
| **C10** | **L3b-notify and L4 run in parallel and both need a bulletin** | The concurrent pair. | Both branch from the **merged L3a**, not from each other. L4 consumes `modules/bulletins`' public application interface; L3b-notify consumes its events. Neither imports the other's anything. |
| **C11** | **M1b.5 lands late** | Branch protection is a repo-settings change needing owner/admin rights — easy to defer, and everything appears to work without it. | **L0's first merge, not its last**, split into workflow-PR and owner-hand-off (see L0). Until nine named jobs are *required*, every rule in the plan is advisory. |
| **C12** | **`@e2e` means two different things** | Eleven `@e2e` scenarios sit in lanes that ship before any frontend exists. Reading them as browser tests makes those lanes unexecutable. | **`@e2e` in L1–L4 is API-level full-stack; Playwright and two browser contexts are exclusive to L5's `vertical-slice-e2e`.** Tag accounting unchanged (12/44/10). The per-module `@e2e` scenarios still prove each module's contract end to end, at the API. |
| **C13** | **L4's B13 gate joins on L3b-notify** | M2-AC19 needs all seven mutation types; `notifyMe.update` is L3b-notify's. | **A join, not a dependency.** L4 builds, tests, and merges everything else in parallel. Only the **final B13 flip** waits on `notifyMe.update` existing. Whichever of L3b-notify / L4 merges second owns the flip. The parallel window is real but ends before the B13 row goes live — do not schedule L4 as if it were fully independent. |

### Honest weaknesses of this decomposition

- **It is still mostly serial.** (d) buys one extra parallel sub-lane; the chain L0→L1→L2→L3a
  is four lanes deep and unavoidable. M2's wall-clock is close to the sum of its lanes, and
  pressure to parallelize will land on C1, C8, and C13 — the three places where it is least
  safe.
- **L0 is the largest and least-estimated lane.** It adopts eight absent dependencies,
  builds two packages from zero, and needs a second test harness for B2. It was written as
  the smallest lane in the first draft; treat any L0 estimate with suspicion.
- **L3a is the largest feature lane** (14 scenarios, 2 work items, 1 table, 1 SQL function)
  and carries B10, B17, and the `visible_bulletins` composition rule.
- **The `sql-table-ownership` rule is new and unproven.** It is proposed here, not carried
  from an ADR. If it turns out to be unbuildable at reasonable cost, C8's SQL residual
  reopens and (c) degrades to a convention — say so rather than quietly shipping without it.
- **No lane owns the M3 deploy**, and ADR-0006's other four scheduled jobs are unowned by
  M2. Both are recorded, neither is assigned.

---

## Revision log

**2026-08-03 — devil's-advocate stress test, verdict "proceed with modifications".** Five
blocking findings, all fixed:

| # | Finding | Fix |
|---|---|---|
| B-1 | C12 was unexecutable — browser e2e assigned to lanes shipping before any frontend | New §"What `@e2e` means in a lane": API-level for L1–L4, browser exclusive to L5. Tag accounting preserved. |
| B-2 | L4's B13 gate silently depended on L3b; sync's six non-replayable types would have made B13's sync column vacuously green | C13 states the join explicitly; L4's brief pins the pre-dispatch actorship ordering and requires the test to assert the actorship *code*, not merely a failure. |
| B-3 | `app.visible_bulletins` had no owner, and no gate can see a `.sql` file re-deriving reachability | Assigned to L3a with composition mandated; new `sql-table-ownership` fitness rule added to L0/L1. |
| B-4 | All four lane gates said "flip to `implemented`" — a value `b-rows.ts:145` throws on | Every gate now uses `status: "live"` + `provenBy`; the schema is quoted in the TDD section. |
| B-5 | L0 was scoped as "M1b remainders"; the tree has none of kysely/tRPC/supabase-js/jose/pino/dexie, no `packages/database`, no `packages/observability`, and B2 needs a second harness | L0 rewritten: from-zero framing, B2 given its own work item, M1b.5 split into workflow-PR + owner hand-off, `vitest.config.ts:14` boy-scout noted. |

Advisories folded in: C1 narrowed to per-dependency-chain with C1a resolving the
one-PR-per-item tension; ADR-0008:22-34 now quoted verbatim (four `not null` constraints
had been softened); `SECURITY INVOKER` recited to ADR-0004:25 and `SET search_path = ''` to
ADR-0002:164; ADR-0006's four unowned scheduled jobs recorded; M2-AC24's two-drainer
topology flagged as unobservable on `render.yaml:15`'s free plan.

The same citation bug is fixed in `docs/engineering/implementation-plan.md:954`, which
attributed `SET search_path = ''` to ADR-0004.

---

## Handoff

- **ACs:** this document defines no new acceptance criteria. Every gate quoted is an
  existing M1-ACn or M2-ACn. Nothing to send to `ac-reviewer`.
- **Next action:** dispatch **L0**, M1b.5 first, and decide the B2 harness before L1 starts.
- **Then:** for L1 onward, `test-expert` (scenarios by name) → `coder` → orchestrator runs
  the gate → draft PR with real command output.
