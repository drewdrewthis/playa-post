// Support file for the no-container-outside-composition fixture. Not itself a violation.
//
// Stands in for the real apps/server/src/composition/container.ts. It imports nothing,
// so the only edge dependency-cruiser can find in this fixture is the illegal one in
// ../modules/bulletins/transport/bulletins.router.ts — which is what lets
// boundaries.fitness.test.ts assert that this fixture trips its own rule and no other.

export interface AppContainer {
  readonly bulletins: { readonly list: () => readonly string[] };
}

export function buildAppContainer(): AppContainer {
  return { bulletins: { list: () => [] } };
}
