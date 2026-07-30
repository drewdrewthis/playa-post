// DELIBERATE VIOLATION — do not fix. See tests/fitness/__fixtures__/README.md
//
// A domain entity reaching for its own module's persistence implementation, and
// for Kysely. Addendum §2 names both: the domain must not import a database
// client or a row type, and infrastructure implements interfaces defined by the
// domain, never the reverse.
//
// The correct shape is `domain/bulletin.repository.ts` declaring an interface
// that `persistence/postgres-bulletin.repository.ts` implements.

import type { Kysely } from 'kysely';

import { PostgresBulletinRepository } from '../persistence/postgres-bulletin.repository';

export class Bulletin {
  constructor(
    private readonly repository: PostgresBulletinRepository,
    private readonly database: Kysely<unknown>,
  ) {}
}
