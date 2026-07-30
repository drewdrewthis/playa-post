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

## Why it is empty

Addendum §3: *"Do not create a package merely because code could theoretically be
shared. Keep code inside its owning application or feature until a real,
demonstrated cross-runtime dependency exists."*

The package exists in M1 because the boundary rule `no-web-to-server-internals`
needs a legal destination to point at — not because there is anything to share
yet. The barrel is `export {}` and that is the correct state until M2 lands the
first tRPC router.

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
