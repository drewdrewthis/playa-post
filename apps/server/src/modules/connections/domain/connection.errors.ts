import { ApplicationError } from '../../../shared/errors/application-error';

import { TRUST_MAX, TRUST_MIN } from './connection-trust';

/**
 * There is no accepted connection between the actor and the person they named.
 *
 * **One answer for two situations**, and that is the security property: "you two are
 * not connected" and "that connection exists but you are not party to it" are
 * indistinguishable here. ADR-0005:69-75 requires actorship to be settled *before*
 * version comparison so an unrelated actor never receives a conflict envelope carrying
 * `currentState` — this error is what they receive instead, and it discloses nothing
 * about a connection between two other people (ADR-0002 §10, B6).
 */
export class NotConnectedError extends ApplicationError {
  static readonly code = 'NOT_CONNECTED';

  constructor() {
    super(NotConnectedError.code, 'You are not connected to that person.');
    this.name = 'NotConnectedError';
  }
}

/**
 * A trust value outside the 0-100 scale.
 *
 * The domain owns this rule rather than the tRPC input schema, for the reason
 * `modules/identity/transport/complete-onboarding.input.ts` gives: restating it at the
 * transport would make a 101 come back as a generic `BAD_REQUEST` instead of the
 * stable code M2-AC18 requires.
 */
export class TrustOutOfRangeError extends ApplicationError {
  static readonly code = 'TRUST_OUT_OF_RANGE';

  constructor() {
    super(
      TrustOutOfRangeError.code,
      `A trust value must be a whole number from ${String(TRUST_MIN)} to ${String(TRUST_MAX)}.`,
    );
    this.name = 'TrustOutOfRangeError';
  }
}
