# M2 lane L5 — Web UI + browser e2e — implementation plan

**Branch:** `l5-web` (worktree `/home/ubuntu/Projects/playa-post/.claude/worktrees/l5-web`).
**Base:** `origin/main` **plus** merged `origin/l4-moderation-sync` **and** `origin/l3b-notify`.
Rebase onto the merged main before step S1; do not start against bare `origin/main` —
half the router surface this lane consumes is on those two branches.

---

## 1. Goal

Ship the M2 frontend (sign-in → onboarding → graph → board → compose → person sheet →
report/dismiss → offline pending badge), prove the addendum §23 flow in one Playwright run
structured as eleven named `test.step()`s (M2-AC1), and close the M2 security-suite surface:
B12 and B14 flipped live, no B-row left `pending` with `pendingUntil: "M2"`, and the
`app.*` table-inventory exit assertion in place.

## 2. Non-goals

- **No service worker behaviour.** `vite-plugin-pwa` already ships one from M1; L5 neither
  extends it nor builds offline caching on it. Offline state is Dexie only. (See R-4: the
  existing `registerType: 'autoUpdate'` SW *will* interfere with the e2e run — handled in S9.)
- No dark theme. Light only.
- No storage/uploads, no saved views, no erasure, no operator surface (M5).
- **No edit to any module's `domain/` or `application/`.** If a behaviour is wrong there it
  is a defect in the owning lane and goes back to that lane. This plan touches
  `apps/server/**` in **zero** files.
- No new dependency-cruiser rule, no rename of any of the nine CI job `name:` strings.
- No `@trpc/tanstack-react-query`, no `superjson` (the server has no transformer — plain JSON).

---

## 3. The surface this lane consumes (verified on the two branches)

Merged `AppRouter` = `health` + eight module routers.
`apps/server/src/shared/trpc/app.router.ts:86` → `export type AppRouter = ReturnType<typeof createAppRouter>;`
Mounted at `TRPC_PREFIX = '/trpc'` (`apps/server/src/entrypoints/http/http-server.ts:19`).

| Path | Kind | Input (verbatim) | Output |
|---|---|---|---|
| `health.check` | query | — | `HealthResponse` |
| `identity.completeOnboarding` | mutation | `{ handle: string, displayName: string(1..80) }` | `{ userId, handle, displayName }` |
| `connections.invitations.create` | mutation | — | `{ token: string }` |
| `connections.invitations.open` | query | `{ token: string }` | `{ inviterId: string }` |
| `connections.connection.accept` | mutation | `{ token: string }` | `{ status: string, trust: number \| null }` |
| `connections.connection.get` | query | `{ otherUserId: uuid }` | `{ status, trust: number \| null }` |
| `connections.trust.set` | mutation | `{ subjectUserId: uuid, trust: number }` | `void` |
| `graph.list` | query | — | `{ people: PresentedPerson[] }` |
| `bulletins.create` | mutation | `{ type: BulletinType, title: string, body: string }` | `PresentedBulletin` |
| `bulletins.archive` | mutation | `{ bulletinId: uuid }` | `PresentedBulletin` |
| `bulletins.getById` | query | `{ bulletinId: uuid }` | `PresentedVisibleBulletin` |
| `bulletins.listMine` | query | — | `PresentedBulletin[]` |
| `bulletins.board` | query | `{ query?: string }` | `{ items: PresentedVisibleBulletin[] }` |
| `views.notifyMe.update` | mutation | `{ sourceText: string, expectedVersion?: int>0 }` | `{ sourceText, version, updatedAt }` |
| `notifications.push.subscribe` | mutation | `{ endpoint: url, keys: { p256dh, auth } }` | `void` |
| `moderation.report` | mutation | `{ bulletinId: uuid }` | `{ bulletinId, hiddenAt }` |
| `moderation.dismiss` | mutation | `{ bulletinId: uuid }` | `{ bulletinId, hiddenAt }` |
| `sync.submitMutations` | mutation | `{ mutations: [{ mutationId: uuid, mutationType: string, clientCreatedAt: iso, payload: unknown }] }` | `{ results: PresentedMutationOutcome[] }` |

DTOs:
- `PresentedPerson` = `{ userId, degree: number, disclosure: string, displayName?, handle?, avatarUrl?, trust: number | null }`
- `PresentedBulletin` = `{ id, type, title, body, createdAt, archivedAt: string | null, version: number }`
- `PresentedVisibleBulletin` = `{ id, type, title, body, createdAt, version, author: { userId, disclosure, displayName?, handle?, avatarUrl? } }`
- `PresentedMutationOutcome` = `{ mutationId, outcome: 'applied'|'replayed'|'conflict'|'rejected'|'expired', result?, conflict?, error? }`
  — optional keys are **omitted**, never `null`. With `exactOptionalPropertyTypes` on, model them as `foo?: T` and never write `foo: undefined`.

Sync semantics (`apps/server/src/modules/sync/application/submit-mutations.service.ts:126-177`):
`request_hash` is **server-computed** (`hashMutationRequest(payload)`, SHA-256 over canonical
JSON, `domain/mutation-request-hash.ts:64-68`) — the client never sends it. Same
`(actorId, mutationId)` + same hash + same type → `replayed` with the stored `result`;
same `mutationId` with a different payload → `rejected` / `IDEMPOTENCY_KEY_REUSE`.
Actorship is checked before idempotency. Only `bulletin.create` has a wired handler in M2;
the other six `MUTATION_TYPES` return `rejected` / `UNSUPPORTED_MUTATION_TYPE`.

Auth: `Authorization: Bearer <token>`, verified ES256 against
`${SUPABASE_URL}/auth/v1/.well-known/jwks.json` (`apps/server/src/composition/supabase-jwks-url.ts`),
`aud: 'authenticated'`, `role: 'authenticated'`, `requiredClaims: ['sub','exp']`.
Outcomes: `anonymous | invalid-token | not-onboarded | authenticated`.

---

## 4. Design decisions — the six questions, each resolved

### D1 — How `AppRouter` typing reaches `apps/web` (RECOMMENDED: contracts-owned API spec + parity fitness test)

**Facts established:** `packages/contracts/src/index.ts` is still `export {}` on all three
branches — no lane promoted anything. The rule
(`.dependency-cruiser.cjs`, `no-web-to-server-internals`) is `from: 'apps/web/'` →
`to: 'apps/server/'` with `tsPreCompilationDeps: true`, so **a type-only import is caught**;
but it has no `reachable: true`, so it is a **direct-edge** rule and would *not* catch
`apps/web → packages/contracts → apps/server`. `pnpm boundaries` cruises `apps packages`
only — `tests/**` is not cruised at all.

**Recommendation — Shape C.** `packages/contracts` declares the wire surface itself, in
plain TypeScript, importing nothing from `apps/server`. `apps/web` uses `@trpc/client`'s
`createTRPCClient` against an untyped router and re-types it through a contracts-owned
`PlayaPostApi` spec. Drift is caught at **compile time** by a fitness test in `tests/fitness/`
(which may legally import both sides, since it is outside the cruised roots) asserting
mutual assignability against `inferRouterInputs<AppRouter>` / `inferRouterOutputs<AppRouter>`.

Why this and not the obvious `export type { AppRouter } from '../../../apps/server/...'`:
- The contracts README's promotion rule is explicit — *"if `apps/web` needs a server
  internal, the answer is a contract designed for the client, **not a re-export of the
  internal**"*. A re-export ships the whole private router tree, including every module's
  internal presenter type, as the public client surface.
- It inverts the workspace layering (`packages/` would depend on `apps/`) and creates a
  package-level cycle the moment any server module imports a contract.
- It passes the boundary rule only because the rule is direct-edge — i.e. it survives on a
  loophole. Strengthening the rule to `reachable: true` is a boundary-rule change and per
  C9 needs its own fixture; that is **not** L5 scope, but Shape C makes it unnecessary.

Exact export shape — one file per module (risk C4: the barrel gains one append-only line
per module, never a shared inline block):

```
packages/contracts/src/
  api-spec.ts        # the ProcedureSpec/RouterSpec vocabulary + PlayaPostApi
  identity.ts  connections.ts  graph.ts  bulletins.ts
  views.ts     notifications.ts  moderation.ts  sync.ts
  index.ts           # one `export * from './<module>';` line per file, appended
```

```ts
// packages/contracts/src/api-spec.ts
export interface ProcedureSpec<TInput, TOutput> {
  readonly input: TInput;
  readonly output: TOutput;
}
export type QuerySpec<I, O> = ProcedureSpec<I, O>;
export type MutationSpec<I, O> = ProcedureSpec<I, O>;

/** The whole client-facing surface, keyed by dotted procedure path. */
export interface PlayaPostApi {
  'graph.list': QuerySpec<void, GraphView>;
  'bulletins.create': MutationSpec<CreateBulletinInput, Bulletin>;
  // … one line per row of the §3 table
}
```

`apps/web/src/app/api/client.ts` wraps `createTRPCClient` once and exposes
`query<K extends QueryKeys>(k, input)` / `mutate<K extends MutationKeys>(k, input)`, typed
solely by `PlayaPostApi`. No web file ever names a server path.

**Cost, stated honestly:** ~120 lines of hand-declared types plus a parity test. That is the
price of the boundary being real rather than nominal, and the parity test converts the
maintenance risk (contracts silently drifting from the router) into a `pnpm typecheck`
failure on the very PR that causes it.

### D2 — Where the Playwright run lives (RECOMMENDED: a tenth, **non-required** CI job)

The nine required checks are `typecheck, lint, lint:boundaries, test:unit, test:integration,
test:security, build:web, build:server:node, secret-scan`. **Renaming** one un-requires its
check; **adding** a tenth job does not touch any of the nine, and an added job is not
required until an owner adds it to the protection rule.

The lane gate reads *"M2-AC1 green **on a machine that is not the author's**, with AC2–AC26
green in CI, all nine named jobs"* — M2-AC1 is deliberately outside the nine.

**Recommendation:** add job id `test-e2e`, `name: test:e2e`, running `pnpm test:e2e`, with
`actions/upload-artifact` for `playwright-report/`. It is **not** added to branch protection
in M2 (an owner change, C11-shaped, and out of lane scope). The CI runner *is* a machine that
is not the author's, so a green `test:e2e` run on the PR **is** the M2-AC1 evidence, and the
uploaded HTML report is the artifact the AC's evidence clause names. Record in `CLAUDE.md`
that job #10 is advisory-in-M2 and that the nine required strings are unchanged.

Rejected: (a) folding Playwright into `test:integration` — a browser failure would read as an
integration failure, it doubles that job's runtime with a browser download and a web build,
and it destroys the "each failure names itself" property CI was split for; (b) local-only —
it makes the milestone exit signal invisible on the PR and re-creates the self-report problem
the evidence clauses exist to prevent.

### D3 — Auth in dev/test (RECOMMENDED: a fake GoTrue in the harness, **no seam in the app**)

The lane brief permits mocking exactly two things: the Web Push transport and **the Supabase
Auth JWT issuer**. Take that literally and mock the *issuer*, not the client.

`tests/e2e/support/fake-supabase-auth.ts` — a `node:http` server implementing four endpoints:

| Method + path | Behaviour |
|---|---|
| `GET /auth/v1/.well-known/jwks.json` | the public JWK from `generateSupabaseSigningKeyPair()` (`packages/testing`) |
| `POST /auth/v1/token?grant_type=password` | looks up the seeded user by email, returns `{ access_token, refresh_token, token_type: 'bearer', expires_in, user }` where `access_token` is `mintSupabaseAsymmetricUserToken({ signingKey, role: 'authenticated', subject })` |
| `POST /auth/v1/token?grant_type=refresh_token` | mints a fresh token for the same `sub` |
| `GET /auth/v1/user` | echoes the seeded user for the bearer's `sub` |

Both runtimes point at it: the server gets `SUPABASE_URL=http://127.0.0.1:<port>` (so
`createRemoteJWKSet` fetches the fake JWKS and **real ES256 verification runs unmodified**),
and the web build gets `VITE_SUPABASE_URL=http://127.0.0.1:<port>` plus any
`VITE_SUPABASE_ANON_KEY` placeholder (the fake accepts any `apikey`).

Consequence, and the reason this shape is worth the extra file: **`apps/web` contains no test
branch at all.** No `VITE_E2E` flag, no dev-only sign-in path, nothing to grep the production
bundle for, no fitness test needed to prove a bypass was compiled out. The app runs the same
`@supabase/supabase-js` client in e2e as in production; only the issuer's address differs.

Rejected: (a) real GoTrue via `pnpm db:start` — the harness is Testcontainers-based and never
requires `db:start` (CLAUDE.md); booting GoTrue + its schema + a mail catcher adds moving parts
without adding a proven property (the same reasoning ADR-0010 already applied to B2); (b)
Playwright seeding a session into `localStorage` — couples the test to supabase-js's private
storage key and skips the sign-in screen, which is `test.step` 1.

**Fallback if `@supabase/supabase-js` proves fiddly against the fake** (it expects a specific
error envelope shape): keep the `AuthClient` port and implement it with a direct
`fetch('/auth/v1/token?grant_type=password')` + in-memory session. Decide on evidence — one
red run against the fake — not in advance. Prefer supabase-js; addendum §18 favours the proven
library, and it owns refresh scheduling this lane otherwise has to write.

### D4 — Offline replay through `sync.submitMutations`

Client-side contract, derived from the service above:

1. Every offline-capable action writes **one** `pendingMutations` row *before* any network
   call: `{ mutationId: crypto.randomUUID(), mutationType, clientCreatedAt: new Date().toISOString(),
   payload, state: 'pending', attempts: 0, lastError: null }`. The `mutationId` is minted **once**
   and never regenerated — regenerating it on retry is exactly the bug idempotency exists to
   catch, and the server cannot detect it.
2. `payload` is frozen at write time. The client **must not** normalise, re-serialise, or
   re-order it before replay: `request_hash` is SHA-256 over server-canonicalised JSON, and
   a payload that changed between attempts comes back `rejected` / `IDEMPOTENCY_KEY_REUSE`
   rather than `replayed`. Store the payload object; let the transport serialise it.
3. The drainer (`apps/web/src/app/offline/sync-runner.ts`) claims rows `state: 'pending'`
   ordered by `clientCreatedAt`, flips them to `inflight`, and posts them as one
   `sync.submitMutations` batch.
4. Map each `PresentedMutationOutcome` back by `mutationId`:
   `applied`/`replayed` → `synced` (apply `result` to `cachedBoard`); `conflict` → `conflicted`
   (surface as a per-item UI state, **never** a silent revert — ADR-0005 §Client);
   `rejected` → `failed`, `lastError = error.code`; transport failure → back to `pending`,
   `attempts += 1`.
5. Replay is triggered on `window.online`, on app start, and on a manual "retry" affordance.
   No timer-driven backoff in M2 — `attempts` is recorded and displayed, not yet acted on.

`test.step` 11 exercises exactly this: compose a Request while offline
(`context.setOffline(true)`) → badge shows *pending* → go online → badge shows *synchronized*
and the bulletin appears → replay the **same** envelope a second time (drainer re-run against
a manually re-`pending`-ed row) → `replayed`, and `bulletins.listMine` still has one row.

### D5 — Frontend stack

Current scaffold: React 18.3.1 / react-dom 18.3.1, Vite 8.1.5, `@vitejs/plugin-react` 6.0.4,
`vite-plugin-pwa` 1.3.0. One component (`apps/web/src/app/shell/app-shell.tsx`), **no router,
no data layer, no state library**. `.npmrc` sets `save-exact=true` — never commit a `^`.

New dependencies, exact versions (verified against the registry this session):

| Package | Version | Where | Why |
|---|---|---|---|
| `@trpc/client` | `11.0.0` | `apps/web` deps | Speaks the server's HTTP protocol. **Pinned to the server's `@trpc/server` 11.0.0**, not the newer 11.18.0 — one version to bump, in one PR, for both halves. |
| `@tanstack/react-query` | `5.101.4` | `apps/web` deps | Query cache, invalidation, request dedupe. Peer `^18 \|\| ^19` — fine on React 18. |
| `react-router` | `7.18.2` | `apps/web` deps | **Not 8.x** — react-router 8 peers `react >= 19.2.7` and would force a React major in this lane. Addendum §18 forbids hand-rolling a router. |
| `dexie` | `4.4.4` | `apps/web` deps | ADR-0005's offline store. Adopted from zero. |
| `dexie-react-hooks` | `4.4.0` | `apps/web` deps | `useLiveQuery` — the badge must re-render on store change without a second state layer. |
| `@supabase/supabase-js` | `2.112.2` | `apps/web` deps | Sign-in + session refresh (D3). |
| `@playwright/test` | `1.62.1` | root devDeps | The browser proof. |

Routing: `createBrowserRouter` with five routes — `/signin`, `/onboarding`, `/` (graph home),
`/board`, `/board/new`. The person sheet is **not** a route: it is an overlay over the graph
(the comp's `sel` selection — a route-based sheet unmounted the graph and was reverted in
PR #80). One `<RequireSession>` wrapper redirecting `anonymous → /signin` and
`not-onboarded → /onboarding`.

Theme: light-only CSS custom properties in `apps/web/src/app/theme/tokens.css`, values read
from `design/Playa Post.dc.html` (repo-map: *"never copy its structure — but the deployed UI
must match it visually"*). Read the prototype for colour/spacing/typography; do not import it.

### D6 — B12/B14, the table-inventory assertion, and M2-AC16 placement

**The mechanisms already exist on main** and are currently proven only in the `unit` project:
`tests/fitness/viewer-id-provenance.fitness.test.ts` + `find-viewer-identifier-inputs.ts` (B14),
`tests/fitness/sql-table-ownership.fitness.test.ts` + `no-sql-outside-persistence.fitness.test.ts`
(B12's two halves). The manifest gate (`tests/security/b-row-manifest.security.test.ts:52-64`)
only requires `provenBy` to name an **existing file that mentions the row ID by word boundary** —
it does not require a `tests/security/` path. But the manifest's own header calls itself *"the
source of truth for `pnpm test:security`"*, and a row whose proof runs in a different job is a
control that a `test:security`-green claim does not cover.

**Recommendation:** add two thin `tests/security/` files that *invoke the existing walkers*
rather than duplicating them, and point `provenBy` at those:

- `tests/security/composition-assertion.security.test.ts` → B12. Imports
  `findSqlTableOwnershipViolations` and `findSqlOutsidePersistence`, asserts empty, and asserts
  **each walker still trips on its own fixture** (the anti-vacuity half M2-AC15 requires:
  *"a fixture query taking a `ViewerId` without composing the authorized set fails the build"*).
- `tests/security/viewer-id-provenance.security.test.ts` → B14. Imports
  `findForbiddenIdentifierInputs` + `procedurePaths`, walks the **merged eight-module**
  `createAppRouter`, asserts zero findings, and asserts a deliberately-added `viewerId` field is
  caught by name. ⚠ `viewer-id-provenance.fitness.test.ts:50-58` warns that the router registry
  is maintained by hand — **`moderation`, `sync`, `views`, and `notifications` must be added to
  both the fitness test's `appRouter()` helper and the new security test**, or the control stops
  seeing four modules. This is the single highest-value line in this lane.

Then in `tests/security/b-rows.manifest.json`:

| Row | Action |
|---|---|
| **B12** | `status: "live"`, delete `pendingUntil`+`reason`, `provenBy: "tests/security/composition-assertion.security.test.ts"` |
| **B14** | `status: "live"`, delete `pendingUntil`+`reason`, `provenBy: "tests/security/viewer-id-provenance.security.test.ts"` |
| **B9** | `status: "live"` — L4 shipped report/dismiss; `provenBy` points at L4's report-privacy security test (confirm its filename on the merged branch; if L4 did not add one, L5 adds `tests/security/report-privacy.security.test.ts` proving M2-AC10's five responses) |
| **B7, B8** | **Not flippable in M2** — both `reason` fields already say the row *completes at M5*. The `pendingUntil` value is the bug: rewrite to `"M5"` and rewrite `reason` to state which half is asserted today (M2.19 precursors) and which needs the ADR-0006 queue / structural re-identification fixture. This is how the gate clause *"no row may remain pending with `pendingUntil: M2`"* is satisfied honestly. **Flag it in the PR body as a deliberate re-pointing, not a silent deferral.** |

And update the pinned live list at `tests/security/b-row-manifest.security.test.ts:73`:
`['B1','B2','B3','B4','B5','B6','B10','B13','B17']` → `['B1','B2','B3','B4','B5','B6','B9','B10','B12','B13','B14','B17']`
(the pending count is derived, so this is the only edit).

**Table-inventory exit assertion.** New `tests/security/app-table-inventory.security.test.ts`.
Assert the **exact set of names**, not a bare count — a count-only assertion fails with
`expected 13, got 12` and tells the reader nothing. Derive the count from the set so the two
cannot disagree:

```ts
const INVENTORY = [ 'users','invitations','connections','connection_trust','outbox_events',
  'consumer_receipts','bulletins','audit_entries','notify_me_queries','push_subscriptions',
  'bulletin_reports','bulletin_dismissals','mutation_results' ] as const;   // 13, briefs §Migration ownership
// SELECT tablename FROM pg_tables WHERE schemaname='app'  ->  expect(actual).toEqual([...INVENTORY].sort())
// and expect(actual).toHaveLength(INVENTORY.length)
```

⚠ **`app.audit_entries` is L3b-infra's**, and `origin/l3b-infra-outbox-drainer` is *not* in
this lane's base. Until it merges this assertion is red by one row, and **M2-AC26's "nine
module names in the dependency-cruiser summary" is short one module (`audit`)**. Two legal
responses, in order of preference: (1) sequence L5's merge after L3b-infra; (2) land the
assertion with `audit_entries` present in `INVENTORY` and the test `.skip`ped behind an
explicit `L3B_INFRA_MERGED` guard — **never** by quietly shrinking the inventory. State the
delta in the PR body; that is precisely what ratified decision (a) asks for.

**M2-AC16 log hygiene.** The feature file tags it `@integration`, not `@e2e`. Placing it inside
the Playwright run would put a required-AC assertion in the one job that is not a required
check. **Recommendation:** `apps/server/src/entrypoints/http/slice-log-hygiene.integration.test.ts`
— drives the same eleven flow lines **at the API level** through `createCaller` (the shape
L1–L4's `@e2e` scenarios already use) against a pino destination captured in-memory
(`@playa-post/observability`), then greps the captured buffer for four canaries: the bulletin
body string, the invite token returned by `connections.invitations.create`, the raw JWT, and a
seeded email address. Zero matches. Runs in `test:integration` — a required job.
Add a **free second assertion inside the Playwright run**: collect `page.on('console')` and
`page.on('pageerror')` for both contexts and assert the same four canaries are absent from the
browser console. That covers the client half the integration test cannot see, at ~10 lines.

---

## 5. Critical files

**Created**

| Path | Purpose |
|---|---|
| `packages/contracts/src/api-spec.ts` | `ProcedureSpec` / `PlayaPostApi` (D1) |
| `packages/contracts/src/{identity,connections,graph,bulletins,views,notifications,moderation,sync}.ts` | per-module wire types (C4) |
| `tests/fitness/contracts-api-parity.fitness.test.ts` | compile-time drift gate, contracts ↔ `AppRouter` |
| `apps/web/src/app/api/client.ts` | typed tRPC facade |
| `apps/web/src/app/auth/{auth-client.ts,supabase-auth-client.ts,session-provider.tsx,require-session.tsx}` | sign-in + session |
| `apps/web/src/app/router.tsx`, `apps/web/src/app/theme/tokens.css` | routing + light theme |
| `apps/web/src/app/routes/{sign-in,onboarding,graph-home,board,compose-request,person-sheet}.tsx` | the six screens |
| `apps/web/src/app/offline/{database.ts,pending-mutations.ts,sync-runner.ts,pending-badge.tsx}` | Dexie stores + badge |
| `tests/e2e/vertical-slice.e2e.spec.ts` | the eleven `test.step()`s (M2-AC1) |
| `tests/e2e/support/{fake-supabase-auth.ts,start-e2e-stack.ts,seed.ts,global-setup.ts}` | harness |
| `playwright.config.ts` | project config, HTML reporter, two contexts |
| `tests/security/{composition-assertion,viewer-id-provenance,app-table-inventory}.security.test.ts` | B12, B14, inventory |
| `apps/server/src/entrypoints/http/slice-log-hygiene.integration.test.ts` | M2-AC16 |
| `docs/adr/ADR-0012-contracts-api-spec-and-router-parity.md` | the D1 pattern (DoD: a pattern needs an ADR in the same PR) |
| `apps/web/.env.example` | `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_API_URL` — names + placeholders only |

**Modified**

| Path | Change |
|---|---|
| `packages/contracts/src/index.ts:13` | replace `export {}` with eight appended `export * from './<module>';` lines |
| `packages/contracts/README.md` | document the API-spec shape as the promotion mechanism |
| `apps/web/package.json` | seven exact-version deps (D5) |
| `apps/web/src/app/shell/app-shell.tsx`, `apps/web/src/entry.tsx` | mount router + providers, drop the M1 placeholder copy |
| `apps/web/vite.config.ts` | `devOptions.enabled: false` for the PWA plugin (R-4) |
| `package.json` (root) | `"test:e2e": "playwright test"` |
| `.github/workflows/ci.yml` | **append** job `test-e2e` / `name: test:e2e`. Do not touch the nine existing `name:` strings |
| `tests/fitness/viewer-id-provenance.fitness.test.ts:50-70` | register `views`, `notifications`, `moderation`, `sync` in `appRouter()` |
| `tests/security/b-rows.manifest.json` | B12/B14/B9 flips, B7/B8 re-pointed to M5 |
| `tests/security/b-row-manifest.security.test.ts:73` | pinned live list |
| `.gitignore` | `playwright-report/`, `test-results/`, `/blob-report/`, `playwright/.cache/` |
| `CLAUDE.md`, `docs/engineering/repo-map.md`, `docs/engineering/ac-index.md` | tenth job is advisory; new dirs; AC → job mapping |

---

## 6. Step sequence

Each step is one commit. S1–S3 and S12–S13 are independent of the UI work and can be
front-loaded to de-risk. Per the lane hand-off shape: `test-expert` writes failing tests from
the ACs first; `coder` (or `advanced-coder` for S1/S2/S9) makes them pass; the orchestrator runs
the gate. Model split per `~/.claude/references/model-selection.md`: **S1, S2, S9, S10 →
`advanced-coder`** (contract co-design and harness composition); **S3–S8, S11–S14 → `coder`**;
**S14's mechanical doc edits → `fast-coder`** once the prose is drafted.

**S0 — rebase.** Merge `origin/l4-moderation-sync` and `origin/l3b-notify` into `l5-web`
(C5 says both append a registration line to `app.router.ts` — expect exactly that conflict; the
resolution is the union of `views, notifications, moderation, sync`). Confirm
`pnpm typecheck && pnpm lint && pnpm boundaries && pnpm test:unit` green **before** writing a
line of L5, so any later red is unambiguously this lane's.

**S1 — contracts.** Write the eight module files + `api-spec.ts`; append eight lines to
`index.ts`. No `zod` import — these are types, and contracts must not gain a runtime dependency.

**S2 — parity gate.** `tests/fitness/contracts-api-parity.fitness.test.ts`. Type-level mutual
assignability against `inferRouterInputs<AppRouter>` / `inferRouterOutputs<AppRouter>` for every
key of `PlayaPostApi`, plus a key-completeness check (every procedure path in the router appears
in the spec — reuse `procedurePaths` from `tests/fitness/find-viewer-identifier-inputs.ts`).
**Prove it bites:** delete one field from a contracts DTO and show `pnpm typecheck` red, then
restore. Root `tsconfig.json` already includes `tests/**/*.ts`, so this fails the `typecheck` job.

**S3 — web deps + transport.** Add the seven dependencies. `apps/web/src/app/api/client.ts`:
one `createTRPCClient` with `httpBatchLink({ url: `${VITE_API_URL}/trpc`, headers })` where
`headers` pulls the current access token from the session provider. `QueryClientProvider` at the
root. No component calls `fetch` directly.

**S4 — auth + sign-in + onboarding.** `AuthClient` port, supabase-js implementation,
`SessionProvider` exposing `{ status: 'anonymous'|'signed-in', accessToken, signIn, signOut }`,
`RequireSession` doing the two redirects. `/onboarding` posts `identity.completeOnboarding` and
renders the structured handle errors from M2-AC25 by code (reserved / duplicate / confusable /
charset / length) — the codes are the server's; the copy is the client's.

**S5 — shell, routing, theme.** `createBrowserRouter` with the five routes; tokens from the
design prototype; the pending-badge slot in the shell header (populated in S8).

**S6 — graph home + person sheet.** `graph.list` → first-degree list (`degree === 1`),
respecting `disclosure`: when `displayName`/`handle`/`avatarUrl` are **absent**, render the
private-person treatment — never a placeholder name (M2-AC5's §6a sub-case). The person
sheet — an overlay over the graph, not a route (PR #80) — shows
`connections.connection.get` and, **only for a connection the viewer owns**, a trust slider
writing `connections.trust.set`. `trust: null` renders as *unset*, and `0` renders as *0* —
two distinct UI states, not one falsy branch (M2-AC4).

**S7 — board, compose, report/dismiss.** `bulletins.board` list; compose posts
`bulletins.create` with `type: 'request'`; per-item overflow menu calls `moderation.report` /
`moderation.dismiss` and removes the item from `cachedBoard` optimistically. Author cards use
the same disclosure rule as S6.

**S8 — Dexie + pending states.** `apps/web/src/app/offline/database.ts` declares exactly the
four ADR-0005 stores — `pendingMutations` (envelope + `state: 'pending'|'inflight'|'failed'|
'conflicted'|'synced'`, `attempts`, `lastError`), `cachedGraph`, `cachedBoard`, `syncMeta`.
Compose routes through `pendingMutations` **always** (online and offline take the same path —
one code path, so the offline case is not a rarely-exercised branch). `sync-runner.ts` per D4.
Badge via `useLiveQuery`, with a distinct visible affordance per non-`synced` state.

**S9 — e2e harness.** `playwright.config.ts` + `tests/e2e/support/`. `globalSetup` boots, in
order: Testcontainers Postgres via `startPostgresTestDatabase()` (migrations applied by default,
no `db:start`); the fake GoTrue (D3); the server via `pnpm --filter @playa-post/server dev` with
`DATABASE_URL` (role `app_rw`) and `SUPABASE_URL` pointing at the fake; `vite preview` of the
built web app via Playwright's `webServer`. Seed users A and B into `app.users` + the fake
issuer's directory with matching `sub` values.
⚠ **R-4 — the service worker.** M1's `VitePWA({ registerType: 'autoUpdate' })` will register
against the preview server and can serve a stale shell mid-run. Set `devOptions.enabled: false`
and, in the Playwright fixture, unregister any SW and disable the cache on context creation
(`await context.addInitScript(...)` removing `navigator.serviceWorker` registrations). Do **not**
delete the plugin — it is M1's deliberate PWA-by-construction choice and out of L5's scope.

**S10 — the eleven steps.** `tests/e2e/vertical-slice.e2e.spec.ts`, two `browser.newContext()`
(A and B), exactly eleven `test.step()` calls whose names are the eleven descriptions in
`specs/features/vertical-slice-e2e.feature` **verbatim**. Step 9 asserts the grouped
notification out-of-band: the test process drives `createSendGroupedPushHandler(...).flush({ now })`
with a recording fake `PushTransport` and asserts one grouped payload plus one
`app.consumer_receipts` row — no production code is modified to make this observable. Step 11
is the offline replay of D4. Add the console-canary assertion from D6.

**S11 — M2-AC16 integration test** (D6).

**S12 — B-rows.** The two new `tests/security/` files, the four manifest edits, the pinned
live-list edit, and the `viewer-id-provenance.fitness.test.ts` registry addition. Show the
**failing** run first for each anti-vacuity assertion (M2-AC15 and M2-AC20 both require
"proven by adding such a field / a fixture").

**S13 — table inventory** (D6), with the L3b-infra caveat stated in the PR body.

**S14 — docs.** `ADR-0012`; `packages/contracts/README.md`; `CLAUDE.md` (tenth job, `pnpm test:e2e`,
the "web imports only contracts, and here is how the types get there" paragraph);
`docs/engineering/repo-map.md` (`tests/e2e/`, `apps/web/src/app/*`);
`docs/engineering/ac-index.md` (M2-AC1 → `test:e2e`; AC15/AC20 → `test:security`; AC16 → `test:integration`).

---

## 7. Alternatives considered

| Decision | Alternative | Why not |
|---|---|---|
| D1 | `export type { AppRouter }` from contracts | Ships every module's private presenter as the public client surface; inverts `packages/ → apps/`; survives the boundary rule only because it is direct-edge. README forbids it in as many words. |
| D1 | Hand-rolled `fetch` client, no `@trpc/client` | Re-implements tRPC's input encoding and batching — custom infrastructure the addendum §18 list explicitly gates behind an ADR. |
| D2 | Playwright inside `test:integration` | A browser failure reads as an integration failure; doubles a required job's runtime; destroys "each failure names itself". |
| D2 | Tenth job **added to branch protection** now | Protection is an owner/admin repo-settings change (C11). Out of lane scope, and gating M2 on it risks the lane stalling on an external action. |
| D3 | Real GoTrue via `pnpm db:start` | Adds an auth server, its schema, and a mail catcher to obtain a string the harness already mints in four lines — ADR-0010's reasoning, applied to the same problem. |
| D3 | `VITE_E2E` sign-in bypass in the app | Ships a dead auth path in the production bundle and requires a fitness test to prove it was compiled out. The fake issuer needs neither. |
| D5 | `react-router` 8.3.0 | Peers `react >= 19.2.7`. A React major inside a UI lane is scope this plan will not take. |
| D5 | `@trpc/client` 11.18.0 | Skews from the server's 11.0.0. Pin both, bump both. |
| D6 | Point B12/B14 `provenBy` at the existing `tests/fitness/` files | Legal under the manifest gate, but the proof would then run in `test:unit` while the manifest calls itself the source of truth for `test:security` — a control a green `test:security` does not actually cover. |
| D6 | Bare `count(*)` for the table inventory | Fails with a number instead of a name. Set equality names the missing or surprise table. |

---

## 8. Risks

| # | Risk | Severity | Mitigation / one-way-door flag |
|---|---|---|---|
| R-1 | **`audit_entries` / the ninth module is on unmerged `l3b-infra-outbox-drainer`.** M2-AC26's nine module names and S13's inventory both come up one short. | High | Sequence L5's merge after L3b-infra (preferred), or land guarded and state the delta. **Not a one-way door, but it will read as an L5 failure if unstated.** |
| R-2 | **The `viewer-id-provenance` router registry is hand-maintained** (`fitness test:50-58`). Four modules landed since it was written. If S12 forgets them, B14 flips `live` while the control is blind to half the surface. | **Critical** | S12 makes registration the first edit and asserts `procedurePaths(appRouter()).length` matches the §3 table's row count. A blind control is worse than a `pending` row. |
| R-3 | Contracts drift silently from the router as later lanes change a presenter. | High | S2's parity test — the drift becomes a `typecheck` failure on the causing PR. **This is the whole justification for D1; if S2 is dropped, D1 collapses into hand-maintained duplication.** |
| R-4 | M1's `autoUpdate` service worker serves a stale shell mid-e2e — a flaky M2-AC1. | High | S9 disables dev registration and unregisters per context. Symptom to recognise: a step passes in isolation and fails in sequence. |
| R-5 | `sync.submitMutations` supports **only** `bulletin.create` in M2. A pending row for any other type returns `rejected`/`UNSUPPORTED_MUTATION_TYPE`. | Medium | Only `bulletin.create` is written to `pendingMutations` in M2. Every other mutation is online-only, and the UI says so rather than queuing a mutation the server will refuse. |
| R-6 | The client re-serialises `payload` between attempts → `IDEMPOTENCY_KEY_REUSE` instead of `replayed`. | Medium | D4 rule 2, and an explicit AC (AC-L5-19). |
| R-7 | Adding a tenth CI job near a config whose nine `name:` strings are branch-protection keys. | **One-way door if fumbled** — a renamed job silently un-requires its check and the repo looks green while enforcing nothing. | The diff must be **append-only** in `ci.yml`. Reviewer instruction in the PR body: `git diff .github/workflows/ci.yml` must show zero changes to any existing `name:` line. |
| R-8 | B7/B8 re-pointed from `M2` to `M5` reads as moving a goalpost. | Medium | Their existing `reason` text already says they complete at M5 — the `pendingUntil` was wrong, not the scope. Flag as a correction in the PR body; do not bury it in a JSON diff. |
| R-9 | The fake GoTrue diverges from real Supabase and the e2e proves a fiction. | Medium | The fake mocks only the **issuer**; the server runs unmodified ES256 verification against its JWKS, so a bad token still fails. The residual is supabase-js's client behaviour, which M4's deployed smoke covers. State the residual; do not pretend it is zero. |
| R-10 | Two browser contexts + Testcontainers + a web build makes `test:e2e` the slowest job and a flake magnet. | Medium | One spec, one worker, `fullyParallel: false`, `retries: 0` in CI — a retried e2e is a green light that hides a real race, and M2-AC1 is the milestone exit signal. |

---

## 9. AC draft

<!-- ACs ready for ac-reviewer -->

Each AC is written as **assertion + evidence**, matching the plan's own AC style. Milestone ACs
(M2-AC1/15/16/20/26) are quoted from the plan by ID and not restated; the ACs below are the
step-level criteria that compose them.

**S1–S2 — contracts and the parity gate**

- **AC-L5-1 (no server edge from web).** `pnpm boundaries` exits 0 and reports zero
  `no-web-to-server-internals` violations with `totalCruised > 0`, and
  `grep -rn "apps/server" apps/web/src` returns nothing. *Evidence: the depcruise summary line
  quoted (module count and violation count) plus the empty grep.*
- **AC-L5-2 (contracts owns no server import).** No file under `packages/contracts/src/`
  contains an import whose specifier resolves into `apps/server`, and `packages/contracts`
  declares zero runtime dependencies. *Evidence: quoted `packages/contracts/package.json` and
  the output of `grep -rn "^import" packages/contracts/src`.*
- **AC-L5-3 (parity is complete).** Every procedure path returned by `procedurePaths(appRouter())`
  appears as a key of `PlayaPostApi`, and every key of `PlayaPostApi` is such a path — asserted
  as a set equality, both directions. *Evidence: the test output listing the path count on both
  sides.*
- **AC-L5-4 (parity bites).** Removing one field from a contracts DTO, and separately adding a
  procedure to the router without a spec key, each make `pnpm typecheck` exit non-zero naming the
  offending key. *Evidence: two failing transcripts naming the key, then the passing run.*

**S3–S4 — transport and auth**

- **AC-L5-5 (bearer propagation).** An authenticated request from the browser carries
  `Authorization: Bearer <token>` on every `/trpc` call; a signed-out browser carries none.
  *Evidence: two quoted `page.on('request')` header captures.*
- **AC-L5-6 (session gating).** Anonymous at `/` redirects to `/signin`; a valid token whose
  user has not onboarded redirects to `/onboarding` and never renders graph or board content;
  after onboarding, `/` renders the graph. *Evidence: three quoted URL + heading assertions.*
- **AC-L5-7 (401 is not a crash).** A tampered/expired token produces a signed-out state and a
  route back to `/signin`, not a blank page, an unhandled rejection, or a retry loop.
  *Evidence: the rendered state plus a `page.on('pageerror')` capture with zero entries.*
- **AC-L5-8 (handle rules surface by code).** Each of the five M2-AC25 rejections renders a
  distinct, human-readable message keyed off the server's structured code — not a generic
  "something went wrong". *Evidence: five screenshots or five quoted rendered strings with their
  codes.*
- **AC-L5-9 (no auth bypass in the bundle).** `pnpm build:web` output contains no e2e or dev
  sign-in path: the built assets contain no `VITE_E2E`-style flag and no token-minting code.
  *Evidence: quoted grep over `apps/web/dist/assets/*.js`, 0 matches.*

**S5–S7 — screens**

- **AC-L5-10 (first degree only).** Graph home renders exactly the `graph.list` people with
  `degree === 1`; a person at degree 2 in the same payload is absent from the DOM.
  *Evidence: the quoted payload plus the rendered list.*
- **AC-L5-11 (§6a disclosure honoured).** A person or bulletin author whose payload omits
  `displayName`/`handle`/`avatarUrl` renders with **no** name, handle, or avatar anywhere in the
  DOM subtree — and no placeholder derived from `userId` (no initials, no truncated UUID).
  *Evidence: quoted `outerHTML` of the rendered card plus the payload it came from.*
- **AC-L5-12 (trust is never displayed to a non-owner).** For user B's view of A, no rendered
  DOM and no network response body contains a trust field or its value; the slider is absent.
  *Evidence: quoted DOM subtree + the serialized `graph.list` body B received.*
- **AC-L5-13 (unset ≠ zero in the UI).** `trust: null` renders as the *unset* state and `trust: 0`
  renders as *0*, and they are visually and textually distinct. *Evidence: two rendered states
  quoted, with the two payloads.*
- **AC-L5-14 (report and dismiss are viewer-local in the UI).** After B reports, the item is gone
  from B's board on the next render and still present on a third eligible viewer's board without a
  reload of that viewer's session. *Evidence: two quoted board DOMs.*

**S8 — offline**

- **AC-L5-15 (the four stores exist, exactly).** `apps/web/src/app/offline/database.ts` declares
  `pendingMutations`, `cachedGraph`, `cachedBoard`, `syncMeta` and no fifth store; the
  `pendingMutations` state domain is exactly `pending|inflight|failed|conflicted|synced`, with
  `attempts` and `lastError` present. *Evidence: the quoted schema declaration plus a
  compile-time exhaustiveness check over the state union.*
- **AC-L5-16 (badge reflects every non-synced state).** For each of `pending`, `inflight`,
  `failed`, `conflicted`, the badge renders a distinct visible affordance; at `synced` the badge
  shows the synchronized state. *Evidence: five rendered captures, one per state.*
- **AC-L5-17 (offline write survives reload).** A mutation composed offline persists across a
  full page reload while still offline and is still `pending`. *Evidence: the store contents
  before and after reload.*
- **AC-L5-18 (replay applies exactly once).** Draining the same envelope twice yields `applied`
  then `replayed` with an identical `result`, and `bulletins.listMine` returns exactly one
  bulletin. *Evidence: both quoted `sync.submitMutations` responses + the quoted list length.*
- **AC-L5-19 (payload immutability).** A replayed envelope's `payload` is byte-identical to the
  stored one; a deliberately mutated payload under the same `mutationId` returns `rejected` /
  `IDEMPOTENCY_KEY_REUSE` and moves the row to `failed` with that code in `lastError` — it does
  **not** silently retry. *Evidence: the two quoted responses + the quoted store row.*
- **AC-L5-20 (conflict is never a silent revert).** A `conflict` outcome leaves the row
  `conflicted` with the server's `conflict.reason` in `lastError`, keeps the local optimistic
  state visible, and renders a per-item conflict affordance. *Evidence: the quoted row plus the
  rendered item.* *(M2 produces no `conflict` outcome — assert against a fabricated response at
  the sync-runner boundary, which is a transport response, not a mock of something we own.)*

**S9–S11 — the browser proof and log hygiene**

- **AC-L5-21 (M2-AC1 shape).** One Playwright run, two browser contexts, exactly eleven
  `test.step()` calls whose names match the eleven feature-file descriptions **verbatim**, all
  passed. *Evidence: the Playwright HTML report showing eleven named steps plus the terminal
  summary line.*
- **AC-L5-22 (a skipped step is visible).** Skipping one step makes the report show ten steps and
  the eleventh visibly missing — not a silently green run. *Evidence: the report from the
  deliberately-skipped run, then the full run.*
- **AC-L5-23 (M2-AC1 on a machine that is not the author's).** The `test:e2e` CI job is green on
  the PR. *Evidence: the job URL, its log tail, and the uploaded `playwright-report` artifact.*
- **AC-L5-24 (the nine required checks are untouched).** `git diff origin/main -- .github/workflows/ci.yml`
  shows only additions, and every pre-existing `name:` string is unchanged. *Evidence: the quoted
  diff plus the list of the nine names before and after.*
- **AC-L5-25 (M2-AC16 canaries).** The captured slice logs contain zero matches for the bulletin
  body, the invite token, a JWT (`eyJ`-prefixed), and an email address; the browser console
  capture from the e2e run likewise. *Evidence: quoted greps for all four canaries against both
  captures, 0 matches each, plus a positive control showing the grep matches when the canary is
  deliberately logged.*

**S12–S13 — the security surface**

- **AC-L5-26 (B14 sees the whole router).** The B14 walker runs against all eight module routers;
  `procedurePaths(appRouter()).length` equals the procedure count of the merged router, asserted
  against an explicit expected number. *Evidence: the quoted count assertion and the module list.*
- **AC-L5-27 (B12/B14 anti-vacuity).** Adding a `viewerId` field to any input schema fails
  `pnpm test:security` naming the procedure and the field; a fixture query taking a `ViewerId`
  without composing the authorized set fails the build. *Evidence: two failing runs naming the
  offender, then the passing run.*
- **AC-L5-28 (manifest integrity).** `pnpm test:security` exits 0, prints all eighteen row IDs,
  and **no row has `pendingUntil: "M2"`**. *Evidence: the full runner output plus
  `grep -c '"pendingUntil": "M2"' tests/security/b-rows.manifest.json` = 0.*
- **AC-L5-29 (a flip cannot be a JSON edit).** Each newly-`live` row's `provenBy` names a file
  that exists and mentions the row ID at a word boundary; deleting the assertion from that file
  makes the manifest test red. *Evidence: the passing run plus one deliberate-deletion failing run.*
- **AC-L5-30 (table inventory).** `SELECT tablename FROM pg_tables WHERE schemaname='app'` equals
  the thirteen-name inventory as a **set**, and the count matches. *Evidence: the quoted actual
  set, the expected set, and any delta explained in the PR body.*
- **AC-L5-31 (M2-AC26 regression).** `pnpm boundaries` and `pnpm test:security` both exit 0 with
  the **nine** module names visible in the dependency-cruiser summary. *Evidence: both
  transcripts.* ⚠ Gated on R-1.

**S14 — documentation**

- **AC-L5-32 (the pattern is recorded).** ADR-0012 exists, states the D1 decision and its rejected
  alternative, and is linked from `docs/adr/README.md`; `docs/engineering/ac-index.md` maps
  M2-AC1 → `test:e2e`, M2-AC15/AC20 → `test:security`, M2-AC16 → `test:integration`.
  *Evidence: the quoted ADR index row and the three ac-index rows.*

---

## Handoff
- ACs ready for ac-reviewer (see §9 AC draft above).
- Implementation → `advanced-coder` for S1, S2, S9, S10 (contract co-design + harness
  composition); `coder` for S3–S8 and S11–S13; `fast-coder` for S14's mechanical doc/index
  edits once the ADR prose is drafted — per `~/.claude/references/model-selection.md`.
- Blocking sequencing question for the orchestrator before S13/S31: merge order versus
  `origin/l3b-infra-outbox-drainer` (R-1).
