// DELIBERATE VIOLATION — do not fix. See tests/fitness/__fixtures__/README.md
//
// An application service typed against a transport input schema. Addendum §6:
// "An application service must not parse HTTP requests [or] return tRPC-specific
// response types." Coupling it to the transport schema means every wire-format
// change becomes a use-case change.
//
// The correct shape is a plain command input owned by the application layer,
// which the router maps its validated input onto.

import type { CreateBulletinInput } from '../transport/bulletin.input';

export class CreateBulletinService {
  async execute(input: CreateBulletinInput): Promise<{ id: string }> {
    return { id: input.body };
  }
}
