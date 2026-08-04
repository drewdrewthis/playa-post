# ADR-0003 — Dependency injection via explicit factory composition

- **Status:** proposed (implemented at M2.3; see the two amendments below)
- **Date:** 2026-07-30 (amended 2026-08-04 when M2.3 built the composition root)
- **Drivers:** addendum §12, §18, §24; PDF §8 "Dependency injection"

> **Amended 2026-08-04 (M2.3), twice. The decision is unchanged; two of its restatements were.**
>
> **1. Spike criterion S8 is retired.** ADR-0009 supersedes ADR-0001 and cancels its runtime spike, so
> the original status line pointed at a gate that no longer exists. The reason the decision held —
> a container's whole job is wiring plus two lifetimes, which the type system already does — never
> depended on `workerd` bundle size. Nothing to revisit; the remaining revisit trigger is the
> ~300-line `registrations.ts` rule below.
>
> **2. `registrations.ts` does not ship until there is a module to register.** The four-file shape
> below is the target, not a checklist to satisfy on day one. `config.ts`, `container.ts`, and
> `request-scope.ts` land at M2.3; `registrations.ts` lands with lane L1's first module. An empty
> `registrations.ts` is the placeholder addendum §4 forbids, and the addendum is normative over this
> file.
>
> The Verification section's substantive clauses are unaffected.

## Context

The addendum mandates constructor injection, one composition root, and forbids `container.resolve(...)`,
service locators, and globals inside business code. It permits Awilix *"if it passes the selected runtime
compatibility spike,"* otherwise *"another mature DI library or explicit factory composition."*

The decisive observation: once container resolution is banned from business code, the container's entire
job is **wiring at the composition root plus request-scope lifetimes**. That is a small job, and the
runtime target (ADR-0001) may be `workerd`, where every dependency costs bundle size and cold-start CPU
(spike criterion S8: composition < 5 ms CPU, cold start p95 < 400 ms).

## Decision

**Explicit, hand-written factory composition in `apps/server/src/composition/`. No DI container in v1.**

Shape:

```text
composition/
├── config.ts          # Zod-validated env → typed Config (from packages/configuration)
├── container.ts       # buildAppContainer(config): AppContainer — singleton-scoped graph
├── request-scope.ts   # buildRequestScope(app, ctx): RequestScope — actor, correlationId, tx, logger
└── registrations.ts   # per-module factory functions, one export per module
```

- `AppContainer` is a plain typed object built once per isolate/process: config, logger, db pool,
  clock, id generator, push client, and each module's long-lived services.
- `RequestScope` is a plain typed object built per request from the container plus the authenticated
  actor, correlation ID, and (where applicable) transaction context. Only genuinely request-scoped
  concerns live here (§12); stateless services are not re-created per request.
- Each module exports **one** factory, e.g.
  `createBulletinsModule(deps: BulletinsModuleDeps): BulletinsModule`, where `BulletinsModuleDeps` is an
  explicit interface — this is the module's declared dependency contract and doubles as the boundary
  documentation §19 wants.
- Only `entrypoints/**` and `composition/**` may import `container.ts`. Enforced by dependency-cruiser.
- Unit tests instantiate classes directly with hand-built fakes (PDF §8: *"Unit tests should normally
  instantiate classes directly"*), never through the composition root.

## Alternatives considered

| Alternative | Why not (now) |
|---|---|
| **Awilix** | Mature and explicitly sanctioned. But: `CLASSIC` injection mode parses `Function.prototype.toString()` for parameter names, which minified Worker bundles break; `PROXY` mode works but resolves by string key, losing the compile-time guarantee that the wiring is complete — the single benefit we most want. Adds runtime weight for a job the type system already does. Reconsider if `registrations.ts` exceeds ~300 lines or scope lifetimes become error-prone. |
| **tsyringe / InversifyJS** | Decorators + `reflect-metadata` polyfill; `emitDecoratorMetadata` couples us to a TS compiler feature and to a runtime metadata shim with poor `workerd` ergonomics. Heavier than the problem. |
| **NestJS** | Brings its own module system, transport layer, and opinions that collide with the addendum's structure (§3, §4). Out of scope. |
| **No injection — direct imports/singletons** | Violates §12 and destroys testability and the dependency-inversion requirement in §25. |

## Consequences

- **Positive:** zero runtime dependency; the compiler proves the object graph is complete and correctly
  typed; nothing to make Worker-compatible; trivially portable between the two ADR-0001 targets;
  no string keys to typo.
- **Negative:** wiring is manual — adding a service means editing one factory. This is a real cost that
  grows linearly, and it is the trigger condition for revisiting (300-line rule above).
- **Negative:** no automatic lifetime management or disposal ordering. Mitigated by keeping exactly two
  scopes (app, request) and one explicit `dispose()` on the container.
- **Reversibility:** high. Introducing Awilix later means rewriting `registrations.ts` only, because
  business code never sees the container either way — that is the property that makes this cheap to
  get wrong.

## Verification

`accepted` when the M2 vertical slice runs entirely through `buildAppContainer` / `buildRequestScope`
and the dependency-cruiser rule `no-container-outside-composition` is green in CI **with its
deliberately-violating fixture proving it still fires** (`tests/fitness/__fixtures__/`).

The rule and its fixture landed at M2.3. The first clause needs a slice to run, so it stays open until
lane L5. The former third clause — spike criterion S8 — is void; see the amendment at the top.
