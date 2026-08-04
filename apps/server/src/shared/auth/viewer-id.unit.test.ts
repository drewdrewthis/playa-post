import { describe, expect, it } from 'vitest';

import type { Actor } from './actor';
import * as viewerIdModule from './viewer-id';

// Namespace import, then destructured: the export *surface* is itself under test
// below, and a second `import { … } from './viewer-id'` would be a duplicate import.
const { viewerIdFromActor } = viewerIdModule;

const actor: Actor = { userId: '9c2b1e40-0000-4000-8000-000000000042', handle: 'dusty_rhodes' };

describe('viewerIdFromActor', () => {
  it('brands the actor’s internal user id and nothing else', () => {
    // Runtime-identical to `actor.userId` on purpose: the brand is a compile-time
    // constraint, so a ViewerId can be handed to SQL as a bound parameter with no
    // unwrapping step for someone to forget.
    expect(viewerIdFromActor(actor)).toBe(actor.userId);
  });

  it('does not derive the viewer from the handle', () => {
    // A handle is user-chosen and, though immutable in v1, is not the identifier any
    // foreign key points at (ADR-0008 rule 1). Deriving a viewer from it would make
    // every visibility query depend on a value the user picked.
    expect(viewerIdFromActor(actor)).not.toBe(actor.handle);
  });
});

/**
 * The file-local half of B14 / M2-AC20.
 *
 * ADR-0002:177-179 requires **exactly one** ViewerId constructor, taking an `Actor`.
 * The other half — no procedure input schema carries a viewer/owner/actor/user
 * identifier — is asserted over the whole router tree by
 * `tests/fitness/viewer-id-provenance.fitness.test.ts`.
 *
 * Asserting on the module's exports rather than reviewing the file is the point: a
 * second constructor added later ("just for the drainer", "just for a test") fails
 * here, at the moment it is written.
 */
describe('the ViewerId constructor surface (ADR-0002 §5a)', () => {
  it('exports exactly one runtime value, and it is the constructor', () => {
    const runtimeExports = Object.entries(viewerIdModule).filter(
      ([, value]) => typeof value === 'function',
    );

    expect(runtimeExports.map(([name]) => name)).toEqual(['viewerIdFromActor']);
  });

  it('takes exactly one argument', () => {
    expect(viewerIdFromActor).toHaveLength(1);
  });

  it('cannot be built from a raw string — the whole of R14’s mitigation', () => {
    // The directive below IS the assertion. If that call ever type-checks, the
    // now-unused `@ts-expect-error` fails `pnpm typecheck` and this file stops
    // compiling — so R14 is caught at author time rather than at review time.
    const buildFromRequestInput = (): unknown =>
      // @ts-expect-error a ViewerId is constructible only from an Actor
      viewerIdFromActor('9c2b1e40-0000-4000-8000-000000000042');

    expect(buildFromRequestInput).toBeTypeOf('function');
  });
});
