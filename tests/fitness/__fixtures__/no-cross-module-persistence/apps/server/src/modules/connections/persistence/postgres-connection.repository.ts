// Support file for the no-cross-module-persistence fixture. Not itself a violation.

export class PostgresConnectionRepository {
  async listAcceptedFor(viewerId: string): Promise<readonly string[]> {
    return [viewerId];
  }
}
