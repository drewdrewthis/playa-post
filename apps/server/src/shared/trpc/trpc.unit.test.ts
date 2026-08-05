import { type TRPCError } from '@trpc/server';
import { describe, expect, it } from 'vitest';

import { createLogger } from '@playa-post/observability';

import type { Actor } from '../auth/actor';
import type { AuthenticationOutcome } from '../auth/authenticate-request';
import { OnboardingRequiredError } from '../auth/authentication.errors';

import type { RequestContext } from './request-context';
import { authenticatedProcedure, createCallerFactory, publicProcedure, router } from './trpc';

const actor: Actor = { userId: 'app-user-1', handle: 'dusty_rhodes' };
const principal = { authUserId: 'auth-user-1' } as const;

/**
 * A probe router built from the real exported procedures.
 *
 * Defined here rather than in production code on purpose: `authenticatedProcedure`'s
 * behaviour is what needs proving, and no product procedure exists to prove it
 * against until lane L1. Inventing one in `app.router.ts` "so the test has something
 * to call" would ship an endpoint nobody asked for (addendum §4).
 */
const probeRouter = router({
  open: publicProcedure.query(() => 'reachable'),
  guarded: authenticatedProcedure.query(({ ctx }) => ({
    userId: ctx.actor.userId,
    handle: ctx.actor.handle,
    viewerId: ctx.viewerId,
  })),
});

const createCaller = createCallerFactory(probeRouter);

function contextFor(authentication: AuthenticationOutcome): RequestContext {
  return {
    correlationId: 'correlation-id-for-test',
    logger: createLogger({ level: 'silent' }),
    // Resolved lazily in production (`composition/request-scope.ts`) so a public
    // procedure pays neither the JWKS fetch nor the `app.users` read; the outcome
    // itself is unchanged, which is why these cases still read as plain values.
    authentication: () => Promise.resolve(authentication),
  };
}

async function rejectionFrom(authentication: AuthenticationOutcome): Promise<TRPCError> {
  try {
    await createCaller(contextFor(authentication)).guarded();
  } catch (error) {
    return error as TRPCError;
  }
  throw new Error('expected the guarded procedure to reject, but it resolved');
}

describe('publicProcedure', () => {
  it('runs for a caller with no credentials at all', async () => {
    const caller = createCaller(contextFor({ kind: 'anonymous' }));

    await expect(caller.open()).resolves.toBe('reachable');
  });
});

describe('authenticatedProcedure', () => {
  // M2-AC2, first case.
  it('refuses an anonymous caller with 401 UNAUTHORIZED', async () => {
    expect((await rejectionFrom({ kind: 'anonymous' })).code).toBe('UNAUTHORIZED');
  });

  // M2-AC2, second case.
  it('refuses an unverifiable token with 401 UNAUTHORIZED', async () => {
    expect((await rejectionFrom({ kind: 'invalid-token' })).code).toBe('UNAUTHORIZED');
  });

  // ADR-0002 §10 as house style. If these two ever differ, an attacker can ask the
  // auth boundary whether a token was well-formed and tune a forgery against it.
  it('says exactly the same thing to "no token" and "bad token"', async () => {
    const anonymous = await rejectionFrom({ kind: 'anonymous' });
    const invalid = await rejectionFrom({ kind: 'invalid-token' });

    expect({ code: invalid.code, message: invalid.message, cause: invalid.cause }).toEqual({
      code: anonymous.code,
      message: anonymous.message,
      cause: anonymous.cause,
    });
  });

  // M2-AC2, third case. 403 rather than 401 because re-authenticating would not help.
  it('refuses a verified but un-onboarded caller with FORBIDDEN + ONBOARDING_REQUIRED', async () => {
    const rejection = await rejectionFrom({ kind: 'not-onboarded', principal });

    expect(rejection.code).toBe('FORBIDDEN');
    expect(rejection.cause).toBeInstanceOf(OnboardingRequiredError);
    expect((rejection.cause as OnboardingRequiredError).code).toBe('ONBOARDING_REQUIRED');
  });

  it('runs for an onboarded actor and hands it its own identity', async () => {
    const caller = createCaller(contextFor({ kind: 'authenticated', principal, actor }));

    await expect(caller.guarded()).resolves.toEqual({
      userId: actor.userId,
      handle: actor.handle,
      viewerId: actor.userId,
    });
  });

  // ADR-0002 §5a: the ViewerId reaching a procedure is derived from the resolved
  // actor, never from the auth identity the token asserted and never from input.
  it('derives the viewer from the resolved product user, not from the token’s subject', async () => {
    const caller = createCaller(contextFor({ kind: 'authenticated', principal, actor }));

    const result = await caller.guarded();

    expect(result.viewerId).toBe(actor.userId);
    expect(result.viewerId).not.toBe(principal.authUserId);
  });
});
