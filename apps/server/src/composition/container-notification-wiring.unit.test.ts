import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SELF_DRAINED_EVENT_TYPES } from '../modules/notifications/domain/notification.events';

import type { Configuration } from './config';
import { buildAppContainer } from './container';

/**
 * Lane-only coverage for two of the L3b-notify reconciliation seams in
 * `composition/container.ts`: the drainer's `excludedEventTypes` argument, and
 * `notificationFlush`'s `SendGroupedPushHandler | null` decision through
 * `isPushDeliveryConfigured`.
 *
 * A new file rather than an edit to the not-yet-arrived `container.unit.test.ts`
 * (merged on origin/main, absent here, arrives clean at rebase) — mirrors that
 * file's fixture shape and network-stubbing idiom without touching it.
 */
const configuration: Configuration = {
  nodeEnv: 'test',
  host: '127.0.0.1',
  port: 0,
  logLevel: 'silent',
  databaseUrl: 'postgres://app_rw@127.0.0.1:1/nothing_listening_here',
  supabaseUrl: 'https://project-that-does-not-exist.supabase.co',
};

const networkAttempt = vi.fn(() => Promise.reject(new Error('unit tests do not use the network')));

beforeEach(() => {
  networkAttempt.mockClear();
  vi.stubGlobal('fetch', networkAttempt);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('notification.events.ts SELF_DRAINED_EVENT_TYPES', () => {
  it('contains NotifyMeMatched, the row the drainer must never claim', () => {
    expect(SELF_DRAINED_EVENT_TYPES).toContain('NotifyMeMatched');
  });
});

describe('buildAppContainer notificationFlush wiring', () => {
  it('is null when the composed transport is the unconfigured one', async () => {
    // The positive direction — a configured transport producing a non-null flush —
    // is unreachable through this function by design: `composition/container.ts`
    // hardcodes `unconfiguredPushTransport` for M2 (no VAPID key pair configured),
    // and there is no configuration knob that swaps it. Proving the positive
    // direction belongs to `isPushDeliveryConfigured`'s own unit coverage
    // (`push-transport.unit.test.ts`), which exercises the pure decision directly
    // rather than through this container's fixed wiring.
    const container = buildAppContainer(configuration);

    expect(container.notificationFlush).toBeNull();

    await container.dispose();
  });
});
