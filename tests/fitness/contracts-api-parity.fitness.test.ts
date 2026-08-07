import type { inferRouterInputs, inferRouterOutputs } from '@trpc/server';
import { describe, expect, it } from 'vitest';

import type { ProcedureInput, ProcedureOutput, ProcedurePath } from '@playa-post/contracts';

import type { AppRouter } from '../../apps/server/src/shared/trpc/app.router';

import { procedurePaths } from './find-viewer-identifier-inputs';
import { buildNullObjectAppRouter, EXPECTED_PROCEDURE_COUNT } from './null-object-app-router';

/**
 * The drift gate behind ADR-0014.
 *
 * `packages/contracts` declares the client-facing API **by hand** rather than
 * re-exporting `AppRouter`, so `apps/web` never imports a server internal and
 * `packages/` never depends on `apps/`. The cost of that boundary being real is that
 * the declaration can rot; this file is what converts that maintenance risk into a
 * `pnpm typecheck` failure **on the PR that causes it** rather than a runtime surprise
 * three lanes later.
 *
 * It may legally import both sides: `pnpm boundaries` cruises `apps packages` only, so
 * `tests/` is outside the cruised roots. That is the whole reason the gate can live
 * here and nowhere else.
 *
 * **Two halves, and neither is sufficient alone:**
 *
 * 1. *Compile time* — every key of `PlayaPostApi` is mutually assignable with the
 *    router's own inferred input and output for that path. Changing a presenter
 *    without changing the contract fails to compile, naming the key.
 * 2. *Run time* — the key set equals `procedurePaths()` **in both directions**. A
 *    procedure added to the router without a contract key is caught here, because a
 *    type-level check can only check the keys it was given.
 */

/** Index a nested inference record by the dotted path the contracts spec uses. */
type Get<T, Path extends string> = Path extends `${infer Head}.${infer Rest}`
  ? Head extends keyof T
    ? Get<T[Head], Rest>
    : never
  : Path extends keyof T
    ? T[Path]
    : never;

/**
 * Strip `readonly` everywhere, recursively.
 *
 * tRPC's `Serialize<T>` — applied to every output because this router has no data
 * transformer — turns `readonly T[]` into `T[]` and drops `readonly` from the
 * properties it re-maps. Those differences are invisible over JSON and would otherwise
 * make every array-valued procedure fail a mutual-assignability check for a reason
 * that has nothing to do with drift. Normalising **both** sides keeps the comparison
 * about shape.
 */
type Mutable<T> = T extends readonly (infer Element)[]
  ? Mutable<Element>[]
  : T extends object
    ? { -readonly [K in keyof T]: Mutable<T[K]> }
    : T;

/**
 * A procedure that resolves `Promise<void>` infers as `never` through `Serialize`
 * (`void` matches none of its branches). "No response body" is `void` on the contracts
 * side, so the two are reconciled here rather than by writing `never` into a contract
 * and inviting the next reader to wonder what it means.
 */
type WireOutput<T> = [T] extends [never] ? void : Mutable<T>;

/**
 * `true` when the two describe the same wire shape; otherwise a type whose name says
 * which direction drifted, so the compile error reads as a diagnosis.
 */
type Parity<Contract, Actual> = [Contract] extends [Actual]
  ? [Actual] extends [Contract]
    ? true
    : { drift: 'the router returns a shape the contract does not describe'; Actual: Actual }
  : { drift: 'the contract describes a shape the router does not provide'; Contract: Contract };

type RouterInputs = inferRouterInputs<AppRouter>;
type RouterOutputs = inferRouterOutputs<AppRouter>;

/**
 * Mapped over `ProcedurePath`, so a contract key with no entry below is a compile
 * error too — the table cannot silently stop covering a procedure.
 */
type InputParity = {
  readonly [K in ProcedurePath]: Parity<Mutable<ProcedureInput<K>>, Mutable<Get<RouterInputs, K>>>;
};

type OutputParity = {
  readonly [K in ProcedurePath]: Parity<
    Mutable<ProcedureOutput<K>>,
    WireOutput<Get<RouterOutputs, K>>
  >;
};

const inputParity: InputParity = {
  'health.check': true,
  'identity.completeOnboarding': true,
  'connections.invitations.create': true,
  'connections.invitations.open': true,
  'connections.connection.accept': true,
  'connections.connection.get': true,
  'connections.trust.set': true,
  'graph.list': true,
  'bulletins.create': true,
  'bulletins.archive': true,
  'bulletins.getById': true,
  'bulletins.listMine': true,
  'bulletins.board': true,
  'moderation.report': true,
  'moderation.dismiss': true,
  'sync.submitMutations': true,
  'views.notifyMe.update': true,
  'notifications.list': true,
  'notifications.push.subscribe': true,
};

const outputParity: OutputParity = {
  'health.check': true,
  'identity.completeOnboarding': true,
  'connections.invitations.create': true,
  'connections.invitations.open': true,
  'connections.connection.accept': true,
  'connections.connection.get': true,
  'connections.trust.set': true,
  'graph.list': true,
  'bulletins.create': true,
  'bulletins.archive': true,
  'bulletins.getById': true,
  'bulletins.listMine': true,
  'bulletins.board': true,
  'moderation.report': true,
  'moderation.dismiss': true,
  'sync.submitMutations': true,
  'views.notifyMe.update': true,
  'notifications.list': true,
  'notifications.push.subscribe': true,
};

describe('packages/contracts is the router, restated (ADR-0014)', () => {
  const routerPaths = [...procedurePaths(buildNullObjectAppRouter())].sort();
  const contractPaths = Object.keys(inputParity).sort();

  it('walks a router with procedures in it — a walk over an empty router proves nothing', () => {
    expect(routerPaths).toHaveLength(EXPECTED_PROCEDURE_COUNT);
  });

  it('declares a contract for every procedure the router serves, and no others', () => {
    // Set equality, both directions, as one assertion whose failure prints the delta:
    // asserting only "every contract key is a real path" would let a new procedure ship
    // with no contract, which is the drift this gate exists for.
    expect(contractPaths).toEqual(routerPaths);
  });

  it('checks the output of every path it checks the input of', () => {
    expect(Object.keys(outputParity).sort()).toEqual(contractPaths);
  });
});
