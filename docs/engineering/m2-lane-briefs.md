# M2 — Implementation lane briefs

> **Status:** proposed, 2026-08-03. Decomposes `docs/engineering/implementation-plan.md`
> §"M2 — First production vertical slice" (work items M2.1–M2.20, acceptance criteria
> M2-AC1–AC26) into six sequenced lanes that agents can be dispatched against.
>
> **This document is subordinate.** Precedence, highest first:
> `docs/engineering/architecture-addendum.md` (normative) →
> `docs/engineering/implementation-plan.md` → `docs/adr/` → this file. Where this file
> and any of those disagree, they win and this file is the bug.
>
> This file adds no scope. It only says **who does what, in what order, and what they
> must not touch.** Every AC, table, rule, and constraint quoted here already exists in
> the sources above.

## How to use this document

1. Find the lane. Read its brief top to bottom.
2. Dispatch `test-expert` with the lane's **named scenarios** (`specs/README.md` requires
   an implementation brief to cite scenario *names*, not feature files). It writes
   failing tests only.
3. Dispatch `coder` with the same brief plus the now-failing tests. It makes them pass.
4. The orchestrator runs the lane's gate commands. Nobody self-reports green.
5. One PR per work item (the plan is explicit: "One big M2 PR — unreviewable, and it
   hides boundary erosion. M2 is 20 PRs for that reason").

---

## Lane map

| Lane | Name | Work items | Feature files | Scenarios | Starts after |
|---|---|---|---|---|---|
| **L0** | Platform prerequisites | M1b.1/.3/.4/.5/.6/.7, M2.2, M2.3 | — | 0 | now |
| **L1** | Identity + migration spine | M2.1 (first migration), M2.4 | `identity-magic-link` | 9 | L0 complete |
| **L2** | Invitations, connections, trust, graph | M2.5, M2.6, M2.7 | `invitations`, `connections`, `directional-trust`, `graph-visibility` | 21 | L1 complete |
| **L3** | Bulletins, board, Notify Me, outbox | M2.8, M2.9, M2.10, M2.11, M2.14, M2.15 | `bulletin-request-lifecycle`, `board-visibility-query`, `notify-me` | 24 | L2 complete |
| **L4** | Moderation + offline sync | M2.12, M2.13 | `moderation-report-dismiss`, `offline-replay` | 10 | **L3a** (see below) |
| **L5** | Web, e2e, security suite | M2.16–M2.20 | `vertical-slice-e2e` | 2 | L3 + L4 complete |

**66 scenarios total** — 9 + 21 + 24 + 10 + 2 = 66, matching `specs/README.md`
(12 `@e2e`, 44 `@integration`, 10 `@unit`).

L3 splits internally so L4 is not needlessly blocked:

- **L3a** = M2.8 (bulletins create/archive) + M2.9 (grammar/board query). Ships the
  `bulletins` module and the authorized board query.
- **L3b** = M2.10, M2.11, M2.14, M2.15 (Notify Me, notifications, outbox drainer, audit).

L4 depends on **L3a only** — reporting and dismissal need a bulletin and a board query,
not a push pipeline. L3b and L4 run in parallel. This is the only parallelism in M2 and
it is deliberately narrow: the slice is a chain, and pretending otherwise is how
integration risk gets deferred to the end (plan §"Alternatives considered": *"Build
modules horizontally, then integrate — forbidden"*).

```text
L0 ──▶ L1 ──▶ L2 ──▶ L3a ──┬──▶ L3b ──┐
                            └──▶ L4  ──┴──▶ L5
```

### Module ownership — one module, one lane, no exceptions

| Module (`apps/server/src/modules/`) | Owning lane |
|---|---|
| `identity` | L1 |
| `connections` | L2 |
| `graph` | L2 |
| `bulletins` | L3a |
| `views` | L3a (grammar), L3b (Notify Me) |
| `notifications` | L3b |
| `audit` | L3b |
| `moderation` | L4 |
| `sync` | L4 |
| `storage` | **not built in M2** (plan: "nothing in the slice uploads a file") |

Nine modules. M2-AC26 requires `pnpm boundaries` and `pnpm test:security` green with
exactly these nine present and no cross-module persistence import.

Every module follows the addendum §4 shape
(`docs/engineering/architecture-addendum.md:161-203`):

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

### Migration ownership

The plan says M2.1 covers "the thirteen slice tables … one migration per logical group."
It does not name them. **The thirteen below are the set the ADRs mandate**; ratify the
list in the L1 PR that opens the migration series and correct this table if it moves.

| # | Table | Owning lane | Source |
|---|---|---|---|
| 1 | `app.users` | L1 | ADR-0008:22-34 |
| 2 | `app.invitations` | L2 | plan M2.5 |
| 3 | `app.connections` | L2 | plan M2.5 |
| 4 | `app.connection_trust` | L2 | plan M2.6 — directional, `NULL` ≠ `0` |
| 5 | `app.bulletins` | L3a | plan M2.8 — `version` column (ADR-0005) |
| 6 | `app.notify_me_queries` | L3b | ADR-0007:77-79 — **PK on `owner_id`** (D1 as a constraint) |
| 7 | `app.push_subscriptions` | L3b | plan M2.11 |
| 8 | `app.outbox_events` | L3b | ADR-0006 |
| 9 | `app.consumer_receipts` | L3b | ADR-0006 |
| 10 | `app.audit_entries` | L3b | plan M2.15 |
| 11 | `app.bulletin_reports` | L4 | plan M2.12 |
| 12 | `app.bulletin_dismissals` | L4 | plan M2.12 |
| 13 | `app.mutation_results` | L4 | ADR-0005:39-47 |

`app.saved_views` (ADR-0007:77) is **not** an M2 table — the plan cuts saved views to M5.
`app.user_contact_fields` and `app.handle_tombstones` (ADR-0008:35-36) are **not** M2
tables — contact fields and erasure are cut to M5.

**Every migration in every lane obeys the same five rules**
(`supabase/migrations/README.md`, and the baseline migration's own instructions at
`supabase/migrations/20260730195954_create_security_baseline.sql:193-196`):

1. Generate the filename with `supabase migration new <verb>_<subject>` — never
   hand-author or rename a timestamp.
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

**The canary drop belongs to L1 and only to L1.** `app.security_baseline_canary` and
`app.security_baseline_canary_seq` exist so B1/B3/B4 do not quantify over an empty set
before real tables exist (`…create_security_baseline.sql:265-266`). They are dropped in
**the same migration that creates `app.users`** — not earlier (B1/B3/B4 go vacuous) and
not later (two tables claiming to be "the canary" is a lie in the catalog).

---

## L0 — Platform prerequisites

**Scope.** Everything M2 code sits on that does not exist yet. No product behavior, no
feature file, no scenario. L0 is the reason M2 does not start today.

**Work items:** M2.2, M2.3, and the outstanding M1b rows whose gate column reads
"any M2 …".

| Item | What ships | Plan gate |
|---|---|---|
| **M1b.5** | Nine **named** CI jobs (`typecheck`, `lint`, `lint:boundaries`, `test:unit`, `test:integration`, `test:security`, `build:web`, `build:server:node`, `secret-scan`) + branch protection requiring all nine. Issue [#4](https://github.com/drewdrewthis/playa-post/issues/4). | **any M2 merge** |
| **M1b.1** | `db:migrate`, `db:types`, `seed/`, `sql/`, checked-in Kysely types at `packages/database/src/schema.ts` + a CI drift check (M1-AC3). `db:start`/`db:stop`/`db:reset` already shipped. | any M2 repository or migration |
| **M1b.3** | B2 (PostgREST 404 / `PGRST106` over every table in `app`) — still `pending: M1b.3` in `tests/security/b-rows.manifest.json`. B1/B3/B4 are implemented. | M2's first viewer-scoped query |
| **M1b.4** | `packages/observability` — redaction allowlist, correlation IDs, OTel span-attribute redaction (M1-AC11, ADR-0002 Q3). | M2 logging anything request-shaped |
| **M1b.6** | PR template (AC + evidence + boundary checkbox), `.env.example`, secret-scan pre-commit hook mirroring the CI job (M1-AC12). | M2's first PR |
| **M1b.7** | The M1-AC13 no-placeholder-layers fitness test. Issue [#5](https://github.com/drewdrewthis/playa-post/issues/5). | M2 creating `modules/` |
| **M2.2** | `packages/contracts` first entries; tRPC root + router registry; auth context verifying the Supabase JWT → `Actor { userId, handle }` → branded `ViewerId`. | — |
| **M2.3** | Composition root per ADR-0003 + the `no-container-outside-composition` boundary rule with its fixture (M1b.9, first half). | — |

**M1b.8** (`ac-index.md`, issue [#6](https://github.com/drewdrewthis/playa-post/issues/6))
is gated at *M2 exit*, not M2 entry. It runs alongside L5.

### M2.2 — contracts, tRPC, `Actor`, `ViewerId`

- `packages/contracts/src/index.ts` is currently a deliberately empty barrel and is the
  **only** legal import surface from `apps/web` into the server side
  (`no-web-to-server-internals`). L0 promotes the first entries; read
  `packages/contracts/README.md` before adding anything.
- `Actor` is resolved **once**, at the tRPC context boundary (ADR-0008:63-64). No
  application service ever sees a JWT or a Supabase client.
- `ViewerId` is branded with **exactly one constructor, taking an `Actor`**
  (ADR-0002:177-179). This is R14's only mitigation: a `viewerId` accepted from request
  input is total silent impersonation.
- **No procedure input schema anywhere may carry a `viewerId`, `userId`, `actorId`, or
  `ownerId` field** (ADR-0002:180-181). M2-AC20/B14 proves this by walking the router
  **type tree**, not by grep. Build that walker here, in L0, while the tree is one
  procedure wide — retrofitting it across nine modules in L5 is the expensive order.
- Auth boundary contract: no token → 401; tampered token → 401; valid token with
  incomplete onboarding → 403 `ONBOARDING_REQUIRED` (M2-AC2). The three scenarios live
  in `identity-magic-link.feature` and are **L1's** to make pass; L0 ships the mechanism.

### M2.3 — composition root

ADR-0003:22-30 mandates exactly four files under `apps/server/src/composition/`:

```text
composition/config.ts          Zod-validated env -> Config
composition/container.ts       buildAppContainer(config): AppContainer
composition/request-scope.ts   buildRequestScope(app, ctx): RequestScope
composition/registrations.ts   per-module factories
```

- **No DI library.** Awilix, tsyringe, and Nest are all explicitly rejected
  (ADR-0003:20,49-51). Building one instead requires an ADR (addendum §18).
- Each module exports one factory: `create<Name>Module(deps): <Name>Module`.
- Unit tests instantiate classes directly, never through the composition root
  (ADR-0003:42-43).
- Watch `registrations.ts` — passing ~300 lines is ADR-0003's own revisit trigger.

### M1b.9 — the two deferred boundary rules

Both were deferred from M1-AC2 because a rule configured against nothing reports green
forever. They ship **with the code they bind to**, each with its own deliberately-violating
fixture under `tests/fitness/__fixtures__/<rule-name>/`, and
`tests/fitness/boundaries.fitness.test.ts` asserts each fixture trips its own rule **and
no other**.

| Rule | Ships in | Binds to |
|---|---|---|
| `no-container-outside-composition` | **L0** (M2.3) | only `entrypoints/**` and `composition/**` may import `container.ts` (ADR-0003:41,70) |
| `no-sql-outside-persistence` | **L1** (first repository) | M2-AC15's secondary rule. **Not a bare `SELECT` grep** — a named AST/`sql`-tag-aware detection rule, with its own fixture. M1-AC2 records that dependency-cruiser is the wrong tool for it, because it is a rule about string literals, not import edges. |

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

Plus: a PR showing **nine named checks** and a screenshot of a blocked merge on a
deliberately-failing `lint:boundaries` (M1-AC9). Until branch protection requires those
nine, every rule in the plan is advisory — which is why M1b.5 is the first thing L0 ships,
not the last.

---

## L1 — Identity + migration spine

**Scope.** `modules/identity`, the first product migration, and the first repository.
Work items **M2.4** and the first slice of **M2.1**.

**Feature file:** `specs/features/identity-magic-link.feature` — **9 scenarios**
(3 `@unit`, 6 `@integration`).

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
Also **M1-AC10 becomes load-bearing here**: `DATABASE_URL` is M2's first genuinely
required env var, and M1-AC10 is documented as vacuous-for-absence until it exists. L1
proves it: boot with the key absent, exit non-zero within 2 s naming the key and its
type, printing no other secret's value.

**B-rows flipped live:** none directly, but `app.users` is the table that makes B1, B3,
and B4 non-vacuous for the first time against real data — and the same migration deletes
the canary that was standing in for it.

**Migration.** One migration, and it does three things:

1. `create table app.users (...)` per ADR-0008:22-34 — `id uuid PK default
   gen_random_uuid()`, `auth_user_id uuid unique not null`, `handle citext unique not
   null`, `display_name text`, `avatar_path text`, `status text default 'active'`,
   `created_at`, `deactivated_at`, `erased_at`, `version int default 1`.
2. `select app.apply_rls_backstop('app.users');` then the explicit per-table grants.
3. `drop table app.security_baseline_canary;` and
   `drop sequence app.security_baseline_canary_seq;`

**No `email` column, anywhere in schema `app`** (ADR-0008:20,111). `auth_user_id` is the
only bridge to `auth.users`, and deliberately **not** a cross-schema foreign key
(ADR-0008:43-45). Ship the fitness test that asserts the absence of an email column in
this lane — it is one line and it never gets written later.

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

Handle rules belong in `domain/handle.policy.ts` as pure logic — that is what makes the
three charset/reserved/length scenarios `@unit` with no I/O. Case-collision and
confusable checks need the database (`citext unique`), hence `@integration`.

**Handle rules, all five** (ADR-0008:50-57): `citext` unique, `[a-z0-9_]{3,24}`, a
reserved-word blocklist, a confusable-normalization check, and immutability
(`HANDLE_IMMUTABLE`). Per escalation E5, **there is no handle-availability endpoint** —
a taken handle returns a generic "not available" on submit, because an availability
check is a people-existence oracle in a product whose §4 promises there is no people
search.

**Must not touch:** any other `modules/` directory (none exist yet), `composition/`
beyond adding the `identity` registration line, `packages/contracts` beyond the identity
entries, `supabase/migrations/20260730195954_create_security_baseline.sql` (merged;
forward-only).

**Gate.** `pnpm test:unit`, `pnpm test:integration`, `pnpm boundaries`, `pnpm
test:security` — plus the nine named CI jobs green. Every `@unit` and `@integration`
scenario above passes by name.

---

## L2 — Invitations, connections, trust, graph

**Scope.** `modules/connections` and `modules/graph`. Work items **M2.5**, **M2.6**,
**M2.7**, and the migration for tables 2–4.

**Feature files — 21 scenarios:**

| File | Scenarios | Split |
|---|---|---|
| `invitations.feature` | 6 | 3 `@unit`, 3 `@integration` |
| `connections.feature` | 5 | 1 `@e2e`, 4 `@integration` |
| `directional-trust.feature` | 7 | 1 `@e2e`, 6 `@integration` |
| `graph-visibility.feature` | 3 | 1 `@e2e`, 2 `@integration` |

**ACs:** M2-AC17 (invite token), M2-AC3 (trust privacy, B6), M2-AC4 (unset ≠ zero),
M2-AC5 (visibility, B5 — the graph half), and the connections/trust rows of M2-AC18
(failure surface) and M2-AC19 (write-path IDOR, B13).

**B-rows flipped live:** **B5** (visibility matrix, graph half incl. the §6a
person-projection sub-case), **B6** (directional trust never leaves the holder), **B8**
partial (hidden-people payload shape), **B13** partial (`connection.accept`, `trust.set`).

**Migrations.** `app.invitations`, `app.connections`, `app.connection_trust` — backstop +
grants each. Trust is **directional and viewer-owned**: model `unset` as `NULL` and a
deliberate zero as `0`, and prove the column distinguishes them (M2-AC4's evidence is a
literal `SELECT trust`).

### M2.5 — invite create / open / accept

- Opaque revocable token from a **CSPRNG, ≥ 16 bytes**, not derived from any user ID or
  handle. M2-AC17 requires a fitness rule that fails a non-CSPRNG source **in that
  module**, 10 000 distinct generated tokens, and a direct assertion that a token is not
  a prefix, suffix, or encoding of the inviter's ID or handle.
- Acceptance is transactional and emits `ConnectionAccepted` to the outbox in the same
  transaction. **The outbox table is L3b's.** If L2 reaches L3a/L3b, see the
  serialization rule in the risks table — the resolution is that `app.outbox_events`
  moves earlier, into L2's migration, and L3b owns only the drainer.
- Spent or revoked token → `INVITATION_UNAVAILABLE`.

### M2.6 — `SetConnectionTrust`

Trust is private, directional, and viewer-owned. M2-AC3 asserts `85` appears in **no**
payload reachable by the other party or a third party across six surfaces: graph read,
board read, person sheet, sync response, **error envelopes, and conflict envelopes**. The
conflict-envelope case is the one that gets missed: a `trust.set` conflict must not carry
`currentState` for a connection the caller is not party to. That is ADR-0005's precedence
rule 1 — **actorship is checked before version comparison**, so an unrelated actor never
receives a conflict envelope at all.

### M2.7 — `app.visible_people` + read model + §6a projection

- `app.visible_people(viewer_id uuid, max_depth int, node_budget int)` — recursive CTE,
  **`SECURITY INVOKER`**, **`SET search_path = ''`** (ADR-0004:28-38). A `SECURITY
  DEFINER` function here fails B4 unless it is on the checked-in allowlist with
  justification.
- Checked in at `modules/graph/persistence/sql/visible-people.sql`, consumed by
  `ListVisibleGraphQuery` (ADR-0004:73-74).
- M2 restricts it to **the viewer plus accepted 1st-degree connections**. Degrees ≥ 2,
  ghost nodes, `path_via`, and truncation UI are M5. `max_depth` (default 4) and
  `node_budget` (default 1500) are operational bounds, **never a product depth cap**.
- Blocked edges are pruned **inside the recursive term**, not post-filtered
  (ADR-0004:30). Blocking is M5, but build the seam now — retrofitting a prune into a
  post-filter is how B7 fails later.
- **ADR-0002 §6a is the load-bearing rule of this lane**: every person representation in
  every payload is projected through this function's `disclosure` level. No direct join
  to `app.users` for an author card, ever. `graph-visibility.feature` › "A connection
  below full disclosure renders with no identifying fields" is the scenario; the same
  rule reappears in L3a's board and L3b's notifications, and it must be **one** shared
  projection, not three.
- Edges incident to the viewer carry the viewer's own trust. Edges between two other
  people carry **no weight** — escalation E1, a pre-recorded visual deviation from the
  prototype.
- ADR-0004:83-85 asks for a p95 < 300 ms benchmark at a 5000-person synthetic network
  **from M2**, reported and non-blocking until M5. Ship the benchmark, do not gate on it.

**Must not touch:** `modules/identity` internals (import its public application interface
or a `packages/contracts` entry — never its `persistence/` or a domain entity),
`modules/bulletins` (does not exist yet).

**Gate.** All 21 scenarios by name; `pnpm boundaries`; `pnpm test:security` with B5/B6
flipped from `pending: M2` to `implemented` in `tests/security/b-rows.manifest.json`.
**A B-row's manifest state is part of the diff, not a follow-up.**

---

## L3 — Bulletins, board, Notify Me, outbox

**Scope.** `modules/bulletins`, `modules/views`, `modules/notifications`,
`modules/audit`. Work items **M2.8, M2.9** (L3a) and **M2.10, M2.11, M2.14, M2.15** (L3b).

**Feature files — 24 scenarios:**

| File | Scenarios | Sub-lane |
|---|---|---|
| `bulletin-request-lifecycle.feature` | 6 (1 `@e2e`, 5 `@integration`) | L3a |
| `board-visibility-query.feature` | 8 (2 `@e2e`, 2 `@integration`, 4 `@unit`) | L3a |
| `notify-me.feature` | 10 (2 `@e2e`, 8 `@integration`) | L3b |

**ACs:** M2-AC6 (transaction atomicity), M2-AC12 (archive lifecycle), M2-AC13 (grammar
boundaries — six responses, both sides of each boundary), M2-AC14 (narrow-only +
indistinguishability, B10/B17), M2-AC5 (board half + §6a author projection), M2-AC7
(60 s grouping window, both boundary cases), M2-AC8 (consumer idempotency), M2-AC21
(push payload minimization), M2-AC22 (delivery-time re-check), M2-AC23 (retry +
dead-lettering), M2-AC24 (concurrent drainers), plus bulletin/notifyMe rows of M2-AC18
and M2-AC19.

**B-rows flipped live:** **B10** (a filter narrows, never widens), **B17**
(unauthorized indistinguishable from non-existent), **B13** further rows
(`bulletin.create`, `bulletin.archive`, `notifyMe.update`).

### L3a — bulletins and board

**Migration:** `app.bulletins` with lifecycle timestamps and a `version` column
(ADR-0005 requires it for conflict handling).

- `CreateBulletinService` and `ArchiveBulletinService`. **Request type only** — the other
  six types are M5. The `BulletinCreated` / `BulletinArchived` outbox events are written
  **in the same transaction as the insert** (M2-AC6: a fault after insert and before
  commit leaves 0 rows in *both* `bulletins` and `outbox_events`).
- Archive is idempotent: a second archive returns HTTP 200 and leaves `archivedAt`
  unchanged. Non-author `bulletins.getById` on an archived bulletin returns **404
  `BULLETIN_GONE`**; the author's `bulletins.listMine` still returns it.
- **The grammar (M2.9) is restricted to `type:` and bare text.** ADR-0007's full grammar
  (`from:`, `tag:`, `loc:`, `deg:`, `trust:`, `is:`) is M5. Limits still apply: 16 terms,
  256 characters. `type:note` is rejected naming the token (D2); an unknown field
  `foo:bar` is **rejected, not ignored**.
- Compiles to **parameterized** SQL over the authorized CTE — bound params only, no
  string interpolation (ADR-0007:88-94):
  ```sql
  WITH authorized AS (SELECT * FROM app.visible_bulletins(:viewer_id))
  SELECT … FROM authorized WHERE <compiled filter> ORDER BY <validated sort> LIMIT …
  ```
  The compiled filter can only **narrow** `authorized`. There is no widening seam. That
  is B10, and M2-AC15's composition assertion (B12) is what proves the shape holds
  structurally rather than by review.
- M2-AC14: a board query referencing an unauthorized bulletin ID and one referencing a
  never-existent UUID return **byte-identical bodies and identical status codes**. The
  evidence is an empty `diff`.

### L3b — Notify Me, notifications, outbox, audit

**Migrations:** `app.notify_me_queries` (**PK on `owner_id`** — D1 becomes a database
constraint, not a code check), `app.push_subscriptions`, `app.outbox_events`,
`app.consumer_receipts`, `app.audit_entries`.

- Stores source text **plus** the validated AST with an `ast_version` (ADR-0007:77-79).
  `UpdateNotifyMeQuery` emits `NotifyMeQueryChanged`.
- `EvaluateNotifyMeHandler` on `BulletinCreated`; `SendGroupedPushHandler` with a **60 s
  window**. Window semantics are exact and both sides are tested: a second bulletin at
  t = 59 s joins the group (one notification total); one at t = 61 s starts a second.
- **Delivery-time re-check** (ADR-0002:274-279): recipient authorization is re-evaluated
  in the send handler, **inside the receipt transaction**, immediately before dispatch. A
  recipient deactivated or disconnected between computation and flush is not delivered
  to, and the receipt records the suppression.
- **Push payloads carry identifiers and a generic string only** — no headline, body,
  author name, or contact data. M2-AC21's evidence is the payload quoted in full.
- Drainer (M2.14): `FOR UPDATE SKIP LOCKED` claiming, backoff
  `least(15 min, 5s * attempts^2)`, dead-lettering after the 8th attempt, and
  `consumer_receipts` for idempotent consumers. **In-process on the Node server**
  (ADR-0006, ADR-0009) — there is no cron variant and no second service. Two concurrent
  drainers must claim disjoint sets.
- Audit (M2.15): `RecordAuditEntryHandler` consuming the slice's events. Entries carry
  **internal IDs only** — no bulletin content, no contact data.

**Must not touch:** `modules/moderation` and `modules/sync` (L4's), `modules/graph`
internals — the board query calls `app.visible_bulletins`, which composes the same
authorized-people CTE; it does not reach into `modules/graph/persistence/`.

**Gate.** All 24 scenarios by name; `pnpm boundaries`; `pnpm test:security` with B10 and
B17 flipped to `implemented`; the benchmark from L2 re-run and reported.

---

## L4 — Moderation + offline sync

**Scope.** `modules/moderation`, `modules/sync`. Work items **M2.12**, **M2.13**.
**Starts after L3a**, runs in parallel with L3b.

**Feature files — 10 scenarios:**

| File | Scenarios | Split |
|---|---|---|
| `moderation-report-dismiss.feature` | 7 | 2 `@e2e`, 5 `@integration` |
| `offline-replay.feature` | 3 | 1 `@e2e`, 2 `@integration` |

**ACs:** M2-AC10 (report privacy, B9 — five quoted responses), M2-AC11 (dismissal is
viewer-local), M2-AC9 (offline replay), M2-AC14 (the moderation half — reporting an
invisible bulletin fails like reporting a non-existent one), M2-AC18/AC19 rows for
`bulletin.report`, `bulletin.dismiss`, and the sync envelope.

**B-rows flipped live:** **B9** (reporter identity never leaks), the remaining **B13**
rows submitted **via `sync.submitMutations` as well as via tRPC** — M2-AC19 requires both
paths for every one of the seven mutation types.

**Migrations:** `app.bulletin_reports`, `app.bulletin_dismissals`, `app.mutation_results`
(`mutation_id uuid PK, actor_id, mutation_type, request_hash, outcome, result jsonb,
created_at` — ADR-0005:39-47).

### M2.12 — report and dismiss

Reporting hides the bulletin **for the reporter, immediately**, and leaves it visible to
every other eligible viewer. **The reporter is never disclosed to the author** — M2-AC10
asserts no response reachable by the author contains the reporter's ID, handle, or
display name, across bulletin read, notifications, and the author's own bulletin list.
Dismissal is viewer-local and nothing else. No strike counts, no aggregation, no reason
taxonomy (all M5).

### M2.13 — sync envelope, idempotency, actorship

- `sync.submitMutations`, max batch 50, in `modules/sync` (ADR-0005:23-24). A handler
  registry maps `MutationType → handler` and dispatches to the **owning module's public
  application interface** — never into another module's persistence.
- M2 implements exactly one replayable mutation: `bulletin.create`. The **actorship
  precedence rule applies to every M2 mutation** regardless.
- `app.mutation_results` is written **in the same transaction as the effect and the
  outbox event**. Same `mutation_id` + matching `request_hash` → `replayed` with an
  identical `result`; same id + different hash → `rejected` / `IDEMPOTENCY_KEY_REUSE`.
  `mutation_id` is namespaced by `actor_id` in **every** lookup.
- Precedence, checked pre-handler (ADR-0005:68-82): **(1) actorship before version
  comparison** — an unrelated actor never receives `currentVersion` or `currentState`;
  (2) erasure wins; (3) blocking wins; (4) revoked authorization re-checked at apply
  time, not enqueue time; (5) a stale mutation cannot resurrect archived data.
- Every mutation type in ADR-0005's conflict matrix must carry a B13 row. Adding a
  mutation type without adding its matrix row and its B13 row is a DoD failure
  (ADR-0005:101,136).

**Must not touch:** `modules/bulletins/persistence/` (call the public application
interface), `modules/notifications` (L3b's), the outbox drainer.

**Gate.** All 10 scenarios by name; `pnpm test:security` with B9 flipped and the B13
matrix complete for all seven mutation types **on both submission paths**;
`pnpm boundaries`.

---

## L5 — Web, e2e, and the security suite

**Scope.** The frontend, the Playwright proof, and the B-suite rows that can only be
asserted once every module exists. Work items **M2.16–M2.20**. Starts after L3 and L4.

**Feature file:** `specs/features/vertical-slice-e2e.feature` — **2 scenarios**
(1 `@e2e` "The full addendum §23 flow passes as eleven named steps", 1 `@integration`
"The captured logs from a full slice run contain no sensitive data").

**ACs:** M2-AC1 (the exit signal), M2-AC16 (log hygiene), M2-AC15 (composition
assertion, B12), M2-AC20 (viewerId provenance, B14), M2-AC26 (regression across all nine
modules). Plus M1b.8 (`ac-index.md`), gated at M2 exit.

**B-rows flipped live:** **B12**, **B14**, and the completion of B5–B9, B13, B17 as a
suite (M2.19).

**Frontend, exactly as scoped:** sign-in, onboarding, graph home (1st degree), board
list, compose Request, person sheet with trust slider, report/dismiss, offline pending
badge. **Light theme only. No service worker yet.** Dexie stores per ADR-0005:105-107 —
`pendingMutations` (`pending|inflight|failed|conflicted|synced` + attempts + lastError),
`cachedGraph`, `cachedBoard`, `syncMeta` — with visible pending/failed/conflicted/
synchronized badges.

`apps/web` imports **only** from `packages/contracts`. That is the
`no-web-to-server-internals` rule and it is not negotiable.

**M2-AC1 is the exit signal and its shape is prescribed:** one Playwright run, **two
browser contexts**, structured as **eleven named `test.step()`s** matching the eleven
lines of the addendum §23 flow. A skipped step must be visible as a missing step in the
report. Evidence is the HTML report showing eleven named steps plus the terminal summary.

**M2-AC16:** run the full flow with log capture and grep for four canaries — the bulletin
body, the invite token, a JWT, and an email address. Zero matches.

**Must not touch:** any module's `domain/` or `application/` — if L5 needs a behavior
change there, it is a defect in the owning lane and goes back to that lane. This is the
same property M3-AC8 later asserts with `git diff --stat`.

**Gate.** M2-AC1 green **on a machine that is not the author's**, with AC2–AC26 green in
CI, all nine named jobs, `pnpm boundaries` showing the **nine module names** in the
dependency-cruiser summary (M2-AC26), and `tests/security/b-rows.manifest.json` carrying
no row still marked `pending: M2`.

---

## TDD hand-off shape — every lane, no exceptions

The repo's standard is BDD + TDD: the test is written first and the minimum production
code is written to pass it. In lane terms:

**Step 1 — `test-expert`.** Brief it with:

- the lane's feature file paths **and the scenario names verbatim** (`specs/README.md`
  §"Rule for implementation briefs" requires names, not files);
- the lane's AC IDs, quoted in full from the implementation plan, **including the
  evidence clause** — the AC is not the assertion, the AC is the assertion *plus* what
  proves it;
- the tag → level mapping: `@unit` = pure logic, no I/O, collaborators may be faked;
  `@integration` = authorization, transactions, events, SQL correctness, boundaries,
  external services mocked only; `@e2e` = full system, nothing mocked;
- the module's `tests/` layout (`domain/`, `application/`, `integration/`) and the
  filename-as-price convention: `*.unit.test.ts`, `*.integration.test.ts`.

It returns **failing tests only**. No production code. Run them and confirm they fail for
the *right reason* — a test that fails on a missing import proves nothing.

**Step 2 — `coder`.** Brief it with the same lane brief plus the failing tests. It makes
them pass and does **not** run them; the orchestrator validates. Model selection per
`~/.claude/references/model-selection.md` — `advanced-coder` where the lane requires
co-designing a contract across modules (L0's `ViewerId`/context boundary, L2's §6a
projection, L4's actorship precedence), `coder` elsewhere.

**Step 3 — orchestrator.** Runs the lane's gate commands, flips the B-row manifest states
in the same PR, opens the draft PR with real command output.

**Test-double rule** (`~/.claude/references/principles/coding.md`): don't mock what you
own. Prefer a fake — an in-memory repository, a fake clock — over a mock. **The 60 s
grouping window needs a fake clock, not a `sleep`**; `notify-me.feature`'s 59 s / 61 s
pair is unrunnable otherwise. Assert on emitted behavior and state, never on call
sequences. Mock only at a boundary you cannot cheaply or deterministically call: Web
Push transport, the Supabase Auth JWT issuer.

**Scenario counts per lane, for the hand-off:**

| Lane | `@unit` | `@integration` | `@e2e` | Total |
|---|---|---|---|---|
| L1 | 3 | 6 | 0 | 9 |
| L2 | 3 | 15 | 3 | 21 |
| L3a | 4 | 7 | 3 | 14 |
| L3b | 0 | 8 | 2 | 10 |
| L4 | 0 | 7 | 3 | 10 |
| L5 | 0 | 1 | 1 | 2 |
| **Total** | **10** | **44** | **12** | **66** |

---

## Risks — where lanes collide, and the serialization rule for each

| # | Collision | Why it happens | Serialization rule |
|---|---|---|---|
| **C1** | **`supabase/migrations/`** — two lanes generate migrations the same day | Filenames are timestamps from `supabase migration new`. Two branches produce two files that both apply, in an order neither author chose, and `supabase db reset` replays that order forever. Nothing merges cleanly *and* nothing conflicts, which is worse. | **One open migration PR at a time, repo-wide.** Rebase, regenerate the timestamp, re-run `pnpm db:reset`. Never hand-edit a timestamp to reorder. A merged migration is immutable. |
| **C2** | **The canary drop** | It must be in the same migration as the first product table. If L1 slips and L2 opens a migration first, L2 will be tempted to drop it. | The canary drop belongs to **whichever migration creates the first product table**, and that is L1's `app.users` by construction. If the order changes, this document changes with it — the rule is "first product table", not "L1". |
| **C3** | **`app.outbox_events` is needed before L3b owns it** | L2's `ConnectionAccepted` must be written transactionally, and L1 may want `UserOnboarded`. The outbox table is listed under L3b. | **Move `app.outbox_events` and `app.consumer_receipts` into L2's migration** the moment a lane before L3b needs to emit an event. L3b then owns only the drainer, not the table. Decide this *at L2 planning*, not by discovering it mid-PR. |
| **C4** | **`packages/contracts/src/index.ts`** — the barrel every lane appends to | It is a single export list and the only legal web↔server surface. Every lane adds to the same lines. | Every lane exports from **its own file** (`contracts/src/<module>.ts`) and the barrel gains **one re-export line per lane**, appended at the end. A one-line append conflicts trivially; a shared inline type block does not. |
| **C5** | **tRPC router registration** — the same appRouter object | Same shape as C4: one file, N lanes. | Same fix: one `<module>.router.ts` per module, one registration line in the root router, appended. **The registration line and the module's first procedure land in the same PR** — a registered-but-empty router is the placeholder addendum §4 forbids. |
| **C6** | **`composition/registrations.ts`** | Every lane adds a factory call. | One line per module, appended, in the same PR as the module. Watch for ADR-0003's ~300-line revisit trigger. |
| **C7** | **`tests/security/b-rows.manifest.json`** | Six lanes flip rows in one JSON file. | Flip **only your own lane's rows**, in the PR that implements them. Never batch flips into a "manifest update" PR — that severs the row from its proof, which is the exact failure the manifest exists to prevent. |
| **C8** | **The §6a person projection, implemented three times** | Graph (L2), board author cards (L3a), and notifications (L3b) each need a projected person. Three lanes, three plausible implementations, one of them subtly wider. **This is R2, the plan's only Critical-severity architecture risk.** | **L2 owns the projection and exports it as `modules/graph`'s public application interface.** L3a and L3b consume it; neither writes its own. B12's composition assertion (M2-AC15) is what makes the violation fail the build rather than fail review. |
| **C9** | **`.dependency-cruiser.cjs` + `boundaries.fitness.test.ts`** | L0 adds `no-container-outside-composition`, L1 adds `no-sql-outside-persistence`, both touching the same config and the same fitness test. | Serialized by the L0→L1 dependency anyway. Each rule lands **with its own fixture directory**; the fitness test asserts each fixture trips its own rule and no other. Adding a rule without a fixture fails that test on purpose. |
| **C10** | **L3b and L4 run in parallel and both need a bulletin** | The only concurrent pair in M2. | Both branch from the **merged L3a**, not from each other. L4 consumes `modules/bulletins`' public application interface; L3b consumes its events. Neither imports the other's anything. |
| **C11** | **M1b.5 lands late** | Branch protection is a settings change, easy to defer, and everything appears to work without it. | **It is L0's first merge, not its last.** Until nine named jobs are required, every rule in the implementation plan is advisory and every "green" in a lane PR is an author's word. |
| **C12** | **The e2e suite is written last and discovers a design flaw** (R10) | 12 `@e2e` scenarios concentrated in L5, after every module is built. | The per-module `@e2e` scenarios (`connections`, `directional-trust`, `graph-visibility`, `bulletin-request-lifecycle`, `board-visibility-query`, `notify-me`, `moderation-report-dismiss`, `offline-replay`) run **in their own lane**, not in L5. L5 owns only the composite `vertical-slice-e2e` proof. Two browser contexts from the first `@e2e` scenario in L2 — M2-AC1 uses two contexts, and a suite that only learns that at L5 rewrites its fixtures. |

### Honest weaknesses of this decomposition

- **It is 85 % serial.** L3b ∥ L4 is the only parallelism. That is a property of a
  vertical slice, not a flaw in the split — but it means M2's wall-clock is the sum of
  its lanes, and pressure to parallelize will land on C1, C3, and C8, which are exactly
  the three places where parallelism is unsafe.
- **L3 is the largest lane** (24 scenarios, 6 work items, 5 tables). The L3a/L3b split
  helps, but if a lane is going to overrun, it is this one.
- **The thirteen-table list is reconstructed, not quoted.** The plan says "thirteen" and
  names none; the set here is what the ADRs mandate. Ratify it in the L1 PR.
- **Trust storage is unratified.** `app.connection_trust` as a separate table versus
  directional columns on `app.connections` is an open modeling call. Either satisfies
  M2-AC4; ADR-0002:218-219 lists "trust" among the tables `app_operator_ro` must not
  read, which leans toward a separate table. Decide it in L2's first PR and record it.
- **No lane owns the M3 deploy.** The plan says M3 may start during M2 and must not gate
  it. It is deliberately outside this decomposition.

---

## Handoff

- **ACs:** this document defines no new acceptance criteria. Every gate quoted here is an
  existing M1-ACn or M2-ACn from `docs/engineering/implementation-plan.md`. Nothing to
  send to `ac-reviewer`; the M2 ACs were reviewed with the plan.
- **Next action:** dispatch **L0**. It has no feature file and no scenario, so it goes
  straight to `coder` per work item, with M1b.5 first.
- **Then:** for L1 onward, `test-expert` (scenarios by name) → `coder` → orchestrator
  runs the gate → draft PR with real command output.
