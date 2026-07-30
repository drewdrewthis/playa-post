// Support file for the no-transport-to-persistence fixture. Not itself a violation.

export class PostgresBulletinRepository {
  async listVisibleForViewer(viewerId: string): Promise<readonly string[]> {
    return [viewerId];
  }
}
