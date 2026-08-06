# ADR-0014 — `packages/contracts` declares the API; a parity gate keeps it honest

- **Status:** proposed
- **Date:** 2026-08-06
- **Drivers:** boundary rule `no-web-to-server-internals`, addendum §3, §18, §19;
  `packages/contracts/README.md`'s promotion rule; implementation plan M2.16, M2-AC1

## Context

M2 is the first milestone in which `apps/web` calls the server. The tRPC router lives at
`apps/server/src/shared/trpc/app.router.ts` and exports `AppRouter`; the usual tRPC client
recipe is `createTRPCClient<AppRouter>()`, which needs the browser bundle to import that
type. The `no-web-to-server-internals` rule forbids exactly that edge, and it is compiled
with `tsPreCompilationDeps: true`, so a **type-only** import is caught too.

The obvious workaround is to put `export type { AppRouter } from '../../../apps/server/…'`
inside `packages/contracts`. It would pass `pnpm boundaries` — the rule is a *direct-edge*
rule with no `reachable: true`, so `apps/web → packages/contracts → apps/server` is
invisible to it. Passing on a loophole is not the same as being allowed.

Three things are wrong with the re-export beyond that:

1. It publishes every module's **private presenter type** — `PresentedVisibleBulletin`,
   `PresentedMutationOutcome`, and the rest — as the client's public surface. The
   contracts README forbids it in as many words: *"if `apps/web` needs a server internal,
   the answer is a contract designed for the client, **not a re-export of the
   internal**"*.
2. It inverts the workspace layering: `packages/` would depend on `apps/`, and the first
   server module to import a contract closes a package-level cycle.
3. It makes every presenter change a client-visible API change, silently, with no place
   for a reviewer to notice.

## Decision

**`packages/contracts` declares the client-facing API itself, in plain TypeScript,
importing nothing from `apps/server`.**

- One file per module (`identity.ts`, `connections.ts`, `graph.ts`, `bulletins.ts`,
  `views.ts`, `notifications.ts`, `moderation.ts`, `sync.ts`, `health.ts`), plus
  `api-spec.ts` carrying the `ProcedureSpec` vocabulary and the `PlayaPostApi` interface
  keyed by dotted procedure path. `index.ts` gains **one appended `export *` line per
  file** — never a shared inline block, so adding a module is a one-line diff.
- `packages/contracts` declares **zero runtime dependencies**. These are types; a
  validation library here would become a dependency of both runtimes.
- `apps/web/src/app/api/client.ts` wraps `@trpc/client`'s **untyped** client once and
  re-types it solely through `PlayaPostApi`. No web file ever names a server path or a
  server type.

**And the declaration is gated at compile time.**
`tests/fitness/contracts-api-parity.fitness.test.ts` asserts, for every key of
`PlayaPostApi`, mutual assignability with `inferRouterInputs<AppRouter>` /
`inferRouterOutputs<AppRouter>`, and — at runtime — set equality between the spec's keys
and `procedurePaths(appRouter())` **in both directions**. The fitness test may import both
sides because `pnpm boundaries` cruises `apps packages` only; `tests/**` is outside the
cruised roots, which is precisely why the gate can live there and nowhere else.

The gate is not optional decoration. Without it this decision degrades into
hand-maintained duplication that drifts silently — the one failure mode that would make
the re-export the better choice.

## Consequences

- **Positive.** The boundary is real rather than nominal: no server type reaches the
  browser bundle, and `packages/` depends on nothing under `apps/`. The client surface is
  designed, reviewed, and documented as a surface, not inherited from whatever a
  presenter happens to return this week.
- **Positive.** Presenter drift becomes a `pnpm typecheck` failure **on the PR that
  causes it**, naming the procedure path. Adding a procedure with no contract key fails
  the runtime half of the same file.
- **Negative, and stated honestly.** Roughly 120 lines of hand-declared types, and every
  new procedure costs a contract entry plus a parity-table row. That is the price of the
  boundary; the gate is what converts the maintenance risk into a build failure instead
  of a production surprise.
- **Negative.** The parity test normalises `readonly` on both sides, because tRPC's
  `Serialize<T>` — applied to every output since this router has no data transformer —
  strips it. Those differences are invisible over JSON, but the normalisation means the
  gate does not police mutability, only shape.

## Alternatives considered

| Alternative | Why not |
|---|---|
| `export type { AppRouter }` from `packages/contracts` | Ships every module's private presenter as the public client surface; inverts `packages/ → apps/`; survives the boundary rule only because that rule is direct-edge. The contracts README forbids it explicitly. |
| Strengthen `no-web-to-server-internals` to `reachable: true` and re-export anyway | A boundary-rule change needs its own deliberately-violating fixture (`tests/fitness/__fixtures__/`), which is out of L5's scope — and this decision makes the strengthening unnecessary rather than merely deferred. |
| Hand-rolled `fetch` client, no `@trpc/client` | Re-implements tRPC's input encoding, batching, and error envelope. Addendum §18 gates re-implementing protocol behind an ADR, and there is no reason here that would survive one. |
| `@trpc/tanstack-react-query` or `createTRPCClient<AppRouter>` | Both require the router type in the browser bundle. Same problem, one import further away. |
| Generate the contracts from the router in a build step | A generator is custom infrastructure (addendum §18) and moves the review surface from a diff a human reads into a script nobody does. The parity test gets the same guarantee with no generated artifact to keep in sync. |
