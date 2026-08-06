import { randomBytes } from 'node:crypto';

import type { RandomTokenSource } from '../domain/invite-token';

/**
 * The Node adapter behind the domain's {@link RandomTokenSource} port.
 *
 * **This is the file that is allowed to know it is running on Node**, and the only one
 * in this module. `.dependency-cruiser.cjs`'s `no-domain-to-infrastructure` rule
 * forbids `domain/` and `application/` from importing a Node builtin precisely so that
 * the choice of host lives in an adapter like this one — its own comment names M2's
 * CSPRNG invite token as the first real instance of the shape.
 *
 * `node:crypto`'s `randomBytes` is a CSPRNG (OpenSSL's `RAND_bytes`). `Math.random`,
 * a `Date.now()`-derived value, or any other non-cryptographic source in this file or
 * in `domain/invite-token.ts` fails `tests/fitness/invite-token-csprng.fitness.test.ts`
 * — that rule walks the generator's local import closure, so moving the randomness
 * here does not move it out of the rule's sight.
 *
 * base64url rather than hex: same entropy in 4/3 fewer characters, and URL-safe
 * without escaping, because an invite token's job is to survive being pasted into a
 * link.
 */
export const nodeCryptoRandomToken: RandomTokenSource = (byteLength: number): string =>
  randomBytes(byteLength).toString('base64url');
