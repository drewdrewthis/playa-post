# `@playa-post/contracts`

The **only** thing `apps/web` is allowed to import from the server side of the system.

## Ownership

| Question | Answer |
|---|---|
| Who owns a contract? | The **server module that publishes it**. `apps/web` is a consumer, never an author. |
| Who may change one? | The owning module, in the same PR that changes the behavior behind it. |
| Who may add one? | Any module, once a **second** runtime genuinely needs the type. Not before. |
| What may live here? | Transport-facing types: request/response shapes, published event envelopes, enumerations that both runtimes must agree on. |
| What may **not** live here? | Domain entities, policies, repository interfaces, persistence/row types, internal transport schemas, anything with behavior. Those stay in their owning module (addendum §19). |

## What is in it

M2 filled it. `apps/web` now calls eighteen tRPC procedures, and this package is
how it knows their shapes.

```
src/
  api-spec.ts   the ProcedureSpec vocabulary and PlayaPostApi, keyed by dotted path
  <module>.ts   one file per server module: its request and response types
  index.ts      one appended `export * from './<module>';` line per file
```

`PlayaPostApi` is the whole client-facing surface. `apps/web/src/app/api/client.ts`
wraps `@trpc/client`'s **untyped** client once and re-types it through that
interface, so no file under `apps/web` ever names a server path or a server type.

Until M2 the barrel was `export {}`, per addendum §3 — *"do not create a package
merely because code could theoretically be shared"*. The package existed only so
`no-web-to-server-internals` had a legal destination to point at. M2's browser
client is the demonstrated cross-runtime dependency that changed that.

## How the types get here — declared, never re-exported

The types in this package are **hand-written**. They are not
`export type { AppRouter } from '../../../apps/server/…'`, and that is a decision
with an ADR behind it ([ADR-0014](../../docs/adr/ADR-0014-contracts-api-spec-and-router-parity.md)):

- a re-export publishes every module's private presenter as the client's public
  surface — exactly what the promotion rule below forbids;
- it inverts the workspace layering, making `packages/` depend on `apps/`;
- it passes `pnpm boundaries` only because `no-web-to-server-internals` is a
  direct-edge rule. Surviving on a loophole is not being allowed.

**The declaration cannot drift, because a test won't let it.**
`tests/fitness/contracts-api-parity.fitness.test.ts` asserts, at type level, that
every key of `PlayaPostApi` is mutually assignable with the router's own inferred
input and output for that path — and, at runtime, that the key set equals the
router's procedure paths in both directions. Change a presenter without changing
the contract and `pnpm typecheck` fails on the PR that did it, naming the key. Add
a procedure with no contract entry and `pnpm test:unit` fails.

That test may import both sides because `pnpm boundaries` cruises `apps packages`
only — `tests/**` is outside the cruised roots. It is the one place in the
repository allowed to see both, and it exists solely to hold them together.

## No runtime dependencies

`package.json` declares none, and should keep declaring none. These are types.
A validation library here would become a dependency of both runtimes and would
put a second definition of "valid" beside the zod schemas the server already
owns — the server's input schemas are authoritative, and this package describes
them rather than re-enforcing them.

## The promotion rule

A type moves into `contracts/` when **both** runtimes need it and neither can own
it alone. Until then it lives in the module that uses it. Copying a type here
"so the frontend can see it" is how a shared kernel rots into a distributed
monolith — if `apps/web` needs a server internal, the answer is a contract
designed for the client, not a re-export of the internal.

## Boundary check

`pnpm boundaries` fails any import from `apps/web` into `apps/server`. This
package is the sanctioned alternative. A deliberately-violating fixture proving
the rule fires lives in `tests/fitness/__fixtures__/no-web-to-server-internals/`.
