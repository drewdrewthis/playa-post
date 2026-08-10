import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  authenticatedProcedure,
  publicProcedure,
  router,
} from '../../apps/server/src/shared/trpc/trpc';

import {
  FORBIDDEN_INPUT_FIELDS,
  findForbiddenIdentifierInputs,
  inputFieldNames,
  procedurePaths,
} from './find-viewer-identifier-inputs';
import {
  buildNullObjectAppRouter as appRouter,
  EXPECTED_PROCEDURE_COUNT,
} from './null-object-app-router';

/**
 * Fitness function for ADR-0002 §5a / M2-AC20 / B14 — `viewerId` provenance.
 *
 * Two halves, and the second is the one that keeps the first honest:
 *
 * 1. **The real router is clean.** Today that is nearly free; from lane L1 on it is
 *    the check standing between the system and R14.
 * 2. **The walker actually catches the thing.** M2-AC20 requires the rule to be
 *    "proven by adding such a field". A control asserting `[] === []` over a router it
 *    cannot introspect passes forever while enforcing nothing — the same failure mode
 *    the TypeScript 7 pin taught this repo to design against
 *    (`boundaries.fitness.test.ts`'s `totalCruised > 0`).
 *
 * The B14 row in `tests/security/b-rows.manifest.json` stays `pending until M2` and is
 * flipped by lane L5 (work item M2.19), which owns the security-suite surface. This
 * file is the mechanism L5's row will point at or reuse.
 */

/** The offending shapes, kept out of the real router — a fixture, exactly like `__fixtures__/`. */
const impersonationFixtureRouter = router({
  flat: publicProcedure
    .input(z.object({ viewerId: z.string(), text: z.string() }))
    .query(() => null),
  nested: authenticatedProcedure
    .input(z.object({ filter: z.object({ ownerId: z.string() }) }))
    .query(() => null),
  optionalAndDeep: publicProcedure
    .input(z.object({ page: z.object({ actorId: z.string() }).optional() }))
    .query(() => null),
  inAnArray: publicProcedure
    .input(z.object({ rows: z.array(z.object({ userId: z.string() })) }))
    .query(() => null),
  legitimate: publicProcedure
    .input(z.object({ bulletinId: z.string(), handle: z.string() }))
    .query(() => null),
});

describe('viewerId provenance (ADR-0002 §5a, M2-AC20/B14)', () => {
  describe('the router this server actually serves', () => {
    it('has procedures to check — a walk over an empty router proves nothing', () => {
      // An exact count, not `not.toHaveLength(0)`: mounting another module without
      // registering it in `null-object-app-router.ts` would leave this green while the
      // control walked one module short of the surface the server actually serves. A
      // blind control is worse than an openly `pending` B-row.
      expect(procedurePaths(appRouter())).toHaveLength(EXPECTED_PROCEDURE_COUNT);
    });

    it('accepts no viewer, user, actor, or owner identifier on any procedure input', () => {
      expect(findForbiddenIdentifierInputs(appRouter())).toEqual([]);
    });
  });

  describe('the walker, proven against deliberately-violating procedures', () => {
    it('names the procedure and the field, not merely "something is wrong"', () => {
      const violations = findForbiddenIdentifierInputs(impersonationFixtureRouter);

      expect(violations).toContainEqual({ procedure: 'flat', field: 'viewerId' });
    });

    it('sees a field nested inside another object', () => {
      expect(findForbiddenIdentifierInputs(impersonationFixtureRouter)).toContainEqual({
        procedure: 'nested',
        field: 'ownerId',
      });
    });

    it('sees a field behind an optional wrapper', () => {
      expect(findForbiddenIdentifierInputs(impersonationFixtureRouter)).toContainEqual({
        procedure: 'optionalAndDeep',
        field: 'actorId',
      });
    });

    it('sees a field inside an array element', () => {
      expect(findForbiddenIdentifierInputs(impersonationFixtureRouter)).toContainEqual({
        procedure: 'inAnArray',
        field: 'userId',
      });
    });

    it('catches every forbidden name, so none is enforced by accident', () => {
      const caught = new Set(
        findForbiddenIdentifierInputs(impersonationFixtureRouter).map(
          (violation) => violation.field,
        ),
      );

      expect([...caught].sort()).toEqual([...FORBIDDEN_INPUT_FIELDS].sort());
    });

    it('leaves an innocent input alone — an over-eager rule gets exceptions bolted on', () => {
      const violations = findForbiddenIdentifierInputs(impersonationFixtureRouter).filter(
        (violation) => violation.procedure === 'legitimate',
      );

      expect(violations).toEqual([]);
    });

    it('reads the input schema at all, rather than reporting nothing everywhere', () => {
      // The control of the control, asserted exactly rather than with `toContain`:
      //
      //  - too few names (tRPC renames `_def.inputs`, the schema stops exposing its
      //    shape) and every assertion above would quietly succeed against an empty
      //    set — the vacuous-green failure this repo already designs against;
      //  - too many names would mean the structural walk is harvesting a validation
      //    library's internals, which is how a control acquires false positives and
      //    then acquires exceptions.
      //
      // If a future Zod version leaks an internal key here, filter it in
      // `collectSchemaFieldNames` — do not loosen the forbidden-field assertions.
      const fields = inputFieldNames(impersonationFixtureRouter._def.procedures['legitimate']);

      expect([...fields].sort()).toEqual(['bulletinId', 'handle']);
    });
  });
});
