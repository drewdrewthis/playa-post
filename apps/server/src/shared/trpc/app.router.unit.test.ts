import { describe, expect, it } from 'vitest';

import { createLogger } from '@playa-post/observability';

import { createIdentityRouter } from '../../modules/identity/transport/identity.router';
import { readHealth } from '../health/read-health';

import { createAppRouter } from './app.router';
import type { RequestContext } from './request-context';
import { createCallerFactory } from './trpc';

const anonymousContext: RequestContext = {
  correlationId: 'correlation-id-for-test',
  logger: createLogger({ level: 'silent' }),
  // A lazy context, as `buildRequestScope` builds one: nothing here resolves
  // credentials until a procedure asks, and `health.check` never does.
  authentication: () => Promise.resolve({ kind: 'anonymous' }),
};

/**
 * A real identity router over a service that is never reached.
 *
 * These tests are about *registration and routing*, not about onboarding: every
 * assertion below calls `health.check` anonymously, and `identity.completeOnboarding`
 * refuses an anonymous caller at the middleware, before the service would be
 * consulted. A null object keeps that honest — if a test ever did reach it, it would
 * say so rather than quietly return a fabricated user.
 */
function identityRouter(): ReturnType<typeof createIdentityRouter> {
  return createIdentityRouter({
    completeOnboarding: {
      complete: () => Promise.reject(new Error('the onboarding service is not exercised here')),
    },
  });
}

const appRouter = (): ReturnType<typeof createAppRouter> =>
  createAppRouter({ identity: identityRouter() });

describe('createAppRouter', () => {
  it('answers health.check with the same payload GET /healthz returns', () => {
    const caller = createCallerFactory(appRouter())(anonymousContext);

    // Compared against readHealth() rather than a literal so the two transports have
    // one source of truth; a drift between them would mean the API and the deploy
    // probe disagree about whether this process is up.
    return expect(caller.health.check()).resolves.toEqual(readHealth());
  });

  it('answers health.check without credentials — liveness must not need a session', async () => {
    const caller = createCallerFactory(appRouter())(anonymousContext);

    await expect(caller.health.check()).resolves.toBeDefined();
  });

  it('is a factory, so two calls produce independent routers', () => {
    // Now that it takes module routers as a parameter, a module-scope singleton would
    // silently share one lane's wiring with another's.
    expect(appRouter()).not.toBe(appRouter());
  });

  // Addendum §4 / lane-brief C5: a registered-but-empty router is the placeholder the
  // addendum forbids. This fails the moment someone removes the last procedure without
  // removing the router.
  it('registers at least one real procedure', () => {
    const procedures = Object.keys(appRouter()._def.procedures);

    expect(procedures).toContain('health.check');
  });

  it('mounts the identity module under its own namespace (lane-brief C5)', () => {
    const procedures = Object.keys(appRouter()._def.procedures);

    expect(procedures).toContain('identity.completeOnboarding');
  });
});
