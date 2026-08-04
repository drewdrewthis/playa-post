// DELIBERATE VIOLATION — do not fix. See tests/fitness/__fixtures__/README.md
//
// A router reaching into the composition root for its dependencies. ADR-0003:41:
// "Only entrypoints/** and composition/** may import container.ts." Addendum §12
// forbids `container.resolve(...)`, `getService(...)`, and friends inside business
// code; this import is that same service-locator move one step earlier, and it is the
// step a boundary rule can actually see.
//
// It is written from `transport/` rather than `application/` on purpose: an
// application-to-composition edge is ALSO caught by no-domain-to-infrastructure, and
// a fixture that trips two rules would let either one rot while the suite stayed
// green. boundaries.fitness.test.ts asserts exactly that — each fixture trips its own
// rule and no other.
//
// The correct shape is: composition builds the module (one factory, one explicit deps
// interface — ADR-0003:37-40) and hands the router what it needs.

import { buildAppContainer } from '../../../composition/container';

export function registerBulletinsRouter(): readonly string[] {
  const container = buildAppContainer();
  return container.bulletins.list();
}
