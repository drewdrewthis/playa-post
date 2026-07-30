// DELIBERATE VIOLATION — do not fix. See tests/fitness/__fixtures__/README.md
//
// A router querying a repository directly. Addendum §2: "Transport code must not
// directly access repositories or the database." This is the shape that quietly
// relocates authorization into routers, where §15 says visibility rules must not
// be duplicated.
//
// The correct shape is: validate input, resolve the actor, invoke ONE application
// operation, map the result.

import { PostgresBulletinRepository } from '../persistence/postgres-bulletin.repository';

export function registerBulletinsRouter(): unknown {
  const repository = new PostgresBulletinRepository();
  return repository.listVisibleForViewer('viewer-id');
}
