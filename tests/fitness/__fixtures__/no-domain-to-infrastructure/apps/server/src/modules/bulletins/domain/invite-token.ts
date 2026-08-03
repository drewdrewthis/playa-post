// DELIBERATE VIOLATION — do not fix. See tests/fitness/__fixtures__/README.md
//
// A domain value object generating its own randomness from `node:crypto`. This is
// the case ADR-0009 review B3 found unguarded: while the second bundle existed,
// `platform: 'neutral'` failed on a Node builtin reaching module code. That bundle
// is gone, so the rule has to catch it instead — otherwise "runtime code lives only
// in entrypoints" is an assertion nothing checks.
//
// The correct shape is a `TokenGenerator` interface declared here and implemented
// by an infrastructure adapter, which may import `node:crypto` freely.

import { randomBytes } from 'node:crypto';

export class InviteToken {
  static issue(): InviteToken {
    return new InviteToken(randomBytes(16).toString('base64url'));
  }

  private constructor(readonly value: string) {}
}
