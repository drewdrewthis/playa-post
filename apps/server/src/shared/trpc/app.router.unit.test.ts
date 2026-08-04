import { describe, expect, it } from 'vitest';

import { createLogger } from '@playa-post/observability';

import { readHealth } from '../health/read-health';

import { createAppRouter } from './app.router';
import type { RequestContext } from './request-context';
import { createCallerFactory } from './trpc';

const anonymousContext: RequestContext = {
  correlationId: 'correlation-id-for-test',
  logger: createLogger({ level: 'silent' }),
  authentication: { kind: 'anonymous' },
};

describe('createAppRouter', () => {
  it('answers health.check with the same payload GET /healthz returns', () => {
    const caller = createCallerFactory(createAppRouter())(anonymousContext);

    // Compared against readHealth() rather than a literal so the two transports have
    // one source of truth; a drift between them would mean the API and the deploy
    // probe disagree about whether this process is up.
    return expect(caller.health.check()).resolves.toEqual(readHealth());
  });

  it('answers health.check without credentials — liveness must not need a session', async () => {
    const caller = createCallerFactory(createAppRouter())(anonymousContext);

    await expect(caller.health.check()).resolves.toBeDefined();
  });

  it('is a factory, so two calls produce independent routers', () => {
    // Guards the seam L1 extends: once this takes module routers as a parameter, a
    // module-scope singleton would silently share one lane's wiring with another's.
    expect(createAppRouter()).not.toBe(createAppRouter());
  });

  // Addendum §4 / lane-brief C5: a registered-but-empty router is the placeholder the
  // addendum forbids. This fails the moment someone removes the last procedure without
  // removing the router.
  it('registers at least one real procedure', () => {
    const procedures = Object.keys(createAppRouter()._def.procedures);

    expect(procedures).toContain('health.check');
  });
});
