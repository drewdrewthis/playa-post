/**
 * Public cross-boundary contracts for Playa Post.
 *
 * This barrel is the ONLY surface `apps/web` may import from the server side of
 * the system (boundary rule `no-web-to-server-internals`, addendum §19).
 *
 * M2 filled it: the eighteen procedures of the tRPC router are declared here as a
 * client-facing API spec — **hand-written, importing nothing from `apps/server`** —
 * and `tests/fitness/contracts-api-parity.fitness.test.ts` fails `pnpm typecheck` the
 * moment the two drift. See `packages/contracts/README.md` for the promotion rule and
 * `docs/adr/ADR-0014-contracts-api-spec-and-router-parity.md` for why it is a
 * declaration rather than a re-export.
 *
 * ⚠ **One `export *` line per module file, appended.** Never a shared inline block:
 * a module gains its own file, and adding one is one line here.
 */

export * from './api-spec';
export * from './bulletins';
export * from './connections';
export * from './graph';
export * from './health';
export * from './identity';
export * from './intros';
export * from './moderation';
export * from './notes';
export * from './notifications';
export * from './sync';
export * from './views';
