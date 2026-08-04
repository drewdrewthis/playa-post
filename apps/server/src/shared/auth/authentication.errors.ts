import { ApplicationError } from '../errors/application-error';

/**
 * A valid session exists, but no onboarded product user is behind it.
 *
 * M2-AC2's third case: **403, not 401.** The distinction is the whole point — 401
 * says "prove who you are", which a client would answer by re-authenticating, and it
 * would loop forever because the token was never the problem. 403 with this code says
 * "you are signed in; finish onboarding", which is an action the client can actually
 * take.
 *
 * This does not leak anything ADR-0002 §10 protects: the caller already proved it
 * holds a token for this auth identity, so telling it about its own onboarding state
 * discloses nothing it did not supply.
 */
export class OnboardingRequiredError extends ApplicationError {
  static readonly code = 'ONBOARDING_REQUIRED';

  constructor() {
    super(
      OnboardingRequiredError.code,
      'This account has not completed onboarding. Choose a handle before using the API.',
    );
    this.name = 'OnboardingRequiredError';
  }
}
