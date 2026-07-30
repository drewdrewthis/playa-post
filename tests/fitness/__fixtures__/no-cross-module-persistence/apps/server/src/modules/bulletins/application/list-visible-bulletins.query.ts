// DELIBERATE VIOLATION — do not fix. See tests/fitness/__fixtures__/README.md
//
// The bulletins module reaching into the connections module's repository.
// Addendum §19: a module must not import another module's persistence
// implementation. This is the single most load-bearing rule in the set — it is
// what keeps the monolith modular instead of merely co-located, and it is the
// reason a visibility change in connections cannot silently break bulletins.
//
// The correct shape is one of: a small public application interface on
// connections, a published event, a shared contract with clear ownership, or a
// coordinating application service.

import { PostgresConnectionRepository } from '../../connections/persistence/postgres-connection.repository';

export class ListVisibleBulletinsQuery {
  constructor(private readonly connections = new PostgresConnectionRepository()) {}

  async execute(viewerId: string): Promise<readonly string[]> {
    return this.connections.listAcceptedFor(viewerId);
  }
}
