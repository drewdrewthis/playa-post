// DELIBERATE VIOLATION — do not fix. See tests/fitness/__fixtures__/README.md
//
// The frontend importing a server-side domain entity. Addendum §19: apps/web may
// import `@playa-post/contracts` and nothing else from the server. Reaching into
// a module's internals couples the client to a private shape, and — worse — it is
// how visibility logic starts living on the client, which §15 forbids outright:
// hidden data must never leave the server in the first place.
//
// The correct shape is a contract in packages/contracts, designed for the client,
// published by the owning server module.

import type { Bulletin } from '../../../../../server/src/modules/bulletins/domain/bulletin';

export async function listBulletins(): Promise<readonly Bulletin[]> {
  return [];
}
