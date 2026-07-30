// Support file for the no-domain-to-infrastructure fixture. Not itself a violation.

export class PostgresBulletinRepository {
  async findActiveById(id: string): Promise<{ id: string } | undefined> {
    return { id };
  }
}
