import { AccessTokenVerificationError, type AccessTokenVerifier } from './access-token-verifier';
import type { Actor, AuthenticatedPrincipal } from './actor';
import type { ActorResolver } from './actor-resolver';

/** Case-insensitive `Bearer ` scheme prefix, per RFC 6750 §2.1. */
const BEARER_PREFIX = /^Bearer\s+/i;

/**
 * What one request's credentials turned out to be.
 *
 * A discriminated union rather than `Actor | null` because the four outcomes have
 * genuinely different responses — 401, 401, 403, and success — and collapsing the
 * first three into "falsy" is how a `not-onboarded` user ends up being told to sign
 * in again forever.
 *
 * `anonymous` and `invalid-token` stay distinct **here and nowhere else**: the
 * transport answers both with the same status, code, and body, so no caller can use
 * the response to learn whether a token was well-formed. The distinction exists for
 * the server's own logs, where "tokens are arriving and failing" and "no tokens are
 * arriving" are different incidents.
 */
export type AuthenticationOutcome =
  | { readonly kind: 'anonymous' }
  | { readonly kind: 'invalid-token' }
  | { readonly kind: 'not-onboarded'; readonly principal: AuthenticatedPrincipal }
  | {
      readonly kind: 'authenticated';
      readonly principal: AuthenticatedPrincipal;
      readonly actor: Actor;
    };

/** Collaborators {@link authenticateRequest} needs, injected rather than resolved (addendum §12). */
export interface AuthenticateRequestDependencies {
  readonly accessTokenVerifier: AccessTokenVerifier;
  readonly actorResolver: ActorResolver;
}

/**
 * Extract the token from an `Authorization` header value.
 *
 * A header carrying some other scheme (`Basic …`) is treated as *absent* rather than
 * invalid: the client never offered a bearer token, so there is nothing to have
 * failed. Both answers are 401 anyway; this keeps the log honest.
 */
function readBearerToken(authorizationHeader: string | undefined): string | undefined {
  if (authorizationHeader === undefined || !BEARER_PREFIX.test(authorizationHeader)) {
    return undefined;
  }

  const token = authorizationHeader.replace(BEARER_PREFIX, '').trim();
  return token === '' ? undefined : token;
}

/**
 * Resolve one request's `Authorization` header into an {@link AuthenticationOutcome}.
 *
 * The single place authentication happens (ADR-0008 rule 8). It runs once per request,
 * at the tRPC context boundary, and nothing downstream ever sees a token: the
 * resolution cost ADR-0008 calls out — one indexed read from auth ID to internal ID —
 * is paid here and shared by every procedure in the request.
 *
 * Verification failures are **swallowed into `invalid-token`, never rethrown.** An
 * expired token is an ordinary event on a long-lived tab, not a server fault, and
 * letting it escape as an exception would produce a 500 where M2-AC2 requires a 401.
 *
 * @param authorizationHeader - The raw header value, or `undefined` when absent.
 * @param dependencies - Verifier and resolver, both injected.
 */
export async function authenticateRequest(
  authorizationHeader: string | undefined,
  dependencies: AuthenticateRequestDependencies,
): Promise<AuthenticationOutcome> {
  const token = readBearerToken(authorizationHeader);
  if (token === undefined) {
    return { kind: 'anonymous' };
  }

  let principal: AuthenticatedPrincipal;
  try {
    principal = await dependencies.accessTokenVerifier.verify(token);
  } catch (error) {
    if (error instanceof AccessTokenVerificationError) {
      return { kind: 'invalid-token' };
    }
    // Anything else is a genuine fault — a broken key, an unavailable dependency —
    // and must surface as a 500 rather than be reported to the client as "your token
    // is bad". Misattributing an outage to the caller is how it stays undiagnosed.
    throw error;
  }

  const actor = await dependencies.actorResolver.resolve(principal);
  return actor === null
    ? { kind: 'not-onboarded', principal }
    : { kind: 'authenticated', principal, actor };
}
