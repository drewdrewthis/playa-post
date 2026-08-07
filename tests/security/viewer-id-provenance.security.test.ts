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
  procedurePaths,
} from '../fitness/find-viewer-identifier-inputs';
import {
  buildNullObjectAppRouter,
  EXPECTED_PROCEDURE_COUNT,
} from '../fitness/null-object-app-router';

/**
 * **B14** — `viewerId` provenance (ADR-0002 §5a / M2-AC20).
 *
 * No tRPC input schema on any procedure may carry a caller-supplied identity. The
 * viewer is derived from the verified token by `authenticatedProcedure` and nowhere
 * else; a `viewerId` on an input is impersonation with a schema in front of it.
 *
 * Points at the **merged eight-module** router via `null-object-app-router.ts`, the
 * one hand-maintained registry all three consumers of this walk share. ⚠ That registry
 * is the single highest-value line in this control: four modules landed after the
 * walker was written, and a registry missing one flips this row `live` while the
 * control is blind to part of the surface. `EXPECTED_PROCEDURE_COUNT` is asserted, not
 * inferred, precisely so "the walk saw everything" is itself checked.
 *
 * The anti-vacuity half is not optional. M2-AC20 requires the rule to be *"proven by
 * adding such a field"*, so the fixture below adds one and this suite asserts it is
 * caught by name.
 */
const impersonationFixtureRouter = router({
  deliberatelyViolating: publicProcedure
    .input(z.object({ viewerId: z.string(), bulletinId: z.string() }))
    .query(() => null),
  nestedBehindAnOptional: authenticatedProcedure
    .input(z.object({ page: z.object({ actorId: z.string() }).optional() }))
    .query(() => null),
});

describe('B14 — viewerId provenance across the whole router (ADR-0002 §5a, M2-AC20)', () => {
  const appRouter = buildNullObjectAppRouter();

  it('walks every procedure the server serves, across all eight modules', () => {
    const paths = procedurePaths(appRouter);

    // An exact count, not `> 0`. A ninth module mounted without a line in
    // `null-object-app-router.ts` would leave every assertion below green while this
    // control quietly stopped seeing it — the vacuous-green shape this repo designs
    // against everywhere else (`boundaries.fitness.test.ts`'s `totalCruised > 0`).
    expect(paths).toHaveLength(EXPECTED_PROCEDURE_COUNT);
    expect(paths).toContain('moderation.report');
    expect(paths).toContain('sync.submitMutations');
    expect(paths).toContain('views.notifyMe.update');
    expect(paths).toContain('notifications.push.subscribe');
  });

  it('accepts no viewer, user, actor, or owner identifier on any procedure input', () => {
    expect(findForbiddenIdentifierInputs(appRouter)).toEqual([]);
  });

  it('names the procedure and the field when such an input is added', () => {
    const violations = findForbiddenIdentifierInputs(impersonationFixtureRouter);

    expect(violations).toContainEqual({ procedure: 'deliberatelyViolating', field: 'viewerId' });
    expect(violations).toContainEqual({ procedure: 'nestedBehindAnOptional', field: 'actorId' });
  });

  it('enforces every forbidden name, so none is enforced by accident', () => {
    expect(FORBIDDEN_INPUT_FIELDS).toContain('viewerId');
    expect(FORBIDDEN_INPUT_FIELDS).toContain('actorId');
    expect(FORBIDDEN_INPUT_FIELDS).toContain('userId');
    expect(FORBIDDEN_INPUT_FIELDS).toContain('ownerId');
  });

  it('leaves an innocent input alone — an over-eager rule gets exceptions bolted on', () => {
    const violations = findForbiddenIdentifierInputs(impersonationFixtureRouter).filter(
      (violation) => violation.field === 'bulletinId',
    );

    expect(violations).toEqual([]);
  });
});
