import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DELIVER_CONNECTION_REQUESTED_CONSUMER } from '../modules/notifications/application/deliver-connection-requested.handler';
import { DELIVER_NOTE_PINNED_CONSUMER } from '../modules/notifications/application/deliver-note-pinned.handler';
import {
  CONNECTION_REQUESTED,
  NOTE_PINNED,
  SELF_DRAINED_EVENT_TYPES,
} from '../modules/notifications/domain/notification.events';

import type { Configuration } from './config';
import { buildAppContainer } from './container';

/**
 * Lane-only coverage for two of the L3b-notify reconciliation seams in
 * `composition/container.ts`: the drainer's `excludedEventTypes` argument, and
 * `notificationFlush`'s `SendGroupedPushHandler | null` decision through
 * `isPushDeliveryConfigured`.
 *
 * That second decision is now driven by `configuration.webPush` — the three `VAPID_*`
 * keys are the only switch that turns real delivery on, and this file is where "setting
 * them schedules the flush, and the harness override still wins" is held. No
 * infrastructure: `buildAppContainer` opens no socket, so the whole graph builds against
 * a database that is not listening.
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
  purgeRetentionDays: 30,
  webPush: null,
};

/**
 * The same configuration with Web Push actually configured.
 *
 * Obvious placeholder credentials — a realistic-looking VAPID key in a test file is a
 * finding for `secret-scan` and for the next reader. Nothing here signs anything: the
 * container builds its object graph without touching a socket, so these strings are
 * only ever read into the adapter's closure.
 */
const configuredForWebPush: Configuration = {
  ...configuration,
  webPush: {
    publicKey: 'a-public-key-that-is-not-real',
    privateKey: 'a-private-key-that-is-not-real',
    contact: 'mailto:nobody@example.invalid',
  },
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

  it('does NOT contain NotePinned, which the generic drainer must deliver (#149)', () => {
    // The other half of the same coupling, and its failure is just as silent: excluding
    // `NotePinned` would leave every pinned note `pending` forever with nothing reading
    // it, because — unlike `NotifyMeMatched` — no scheduled job sweeps it.
    expect(SELF_DRAINED_EVENT_TYPES).not.toContain(NOTE_PINNED);
  });

  it('does NOT contain ConnectionRequested, which the generic drainer must deliver (#218)', () => {
    // Same coupling, third kind: nothing self-drains a connection request, so excluding
    // it would strand every request event `pending` with nothing reading it.
    expect(SELF_DRAINED_EVENT_TYPES).not.toContain(CONNECTION_REQUESTED);
  });
});

describe('DeliverConnectionRequestedHandler receipt name', () => {
  it('is the literal DeliverConnectionRequestedHandler', () => {
    // Pinned for the reason DeliverNotePinnedHandler's is, one paragraph down: the
    // receipt IS the notification, and a rename empties every bell retroactively.
    expect(DELIVER_CONNECTION_REQUESTED_CONSUMER).toBe('DeliverConnectionRequestedHandler');
  });
});

describe('DeliverNotePinnedHandler receipt name', () => {
  it('is the literal DeliverNotePinnedHandler', () => {
    // Pinned as a literal for the reason the event names above are: it is written into
    // `app.consumer_receipts.consumer_name`, and every already-written receipt becomes
    // invisible the moment it changes — which here means every note notification already
    // in somebody's bell disappears. That the container actually registers this consumer
    // needs a database and is `container-notification-wiring.integration.test.ts`'s job.
    expect(DELIVER_NOTE_PINNED_CONSUMER).toBe('DeliverNotePinnedHandler');
  });
});

describe('buildAppContainer notificationFlush wiring', () => {
  it('is null when the environment configures no VAPID keys', async () => {
    // The unconfigured path: `configuration.webPush` is null, so the composed transport
    // is `unconfiguredPushTransport` and the flush must not be schedulable. Every local
    // checkout and every harness without keys is in this state.
    const container = buildAppContainer(configuration);

    expect(container.notificationFlush).toBeNull();

    await container.dispose();
  });

  it('is the grouped-push flush when the environment configures VAPID keys', async () => {
    // The whole point of this issue: the three keys are the only switch. Nothing else
    // changes between this call and the one above — no override, no code edit — and
    // `main.ts` reads exactly this field to decide whether to arm the poll loop.
    const container = buildAppContainer(configuredForWebPush);

    expect(container.notificationFlush).not.toBeNull();

    await container.dispose();
  });

  it('lets a harness override win over configured VAPID keys', async () => {
    /*
     * The seam stays outermost. A harness that injects a transport must reach its own
     * recorder rather than a real push service whatever the ambient environment says —
     * otherwise a developer box with VAPID keys exported would send an e2e run's pushes
     * to a live push service.
     *
     * Proven through `isConfigured: false`, which is the one difference observable from
     * outside the container: the configured web-push adapter declares `true` and would
     * make this non-null, so a null flush here can only mean the override was taken.
     */
    const container = buildAppContainer(configuredForWebPush, {
      pushTransport: { isConfigured: false, send: () => Promise.resolve() },
    });

    expect(container.notificationFlush).toBeNull();

    await container.dispose();
  });

  it('is the grouped-push flush when a configured transport is injected through the seam', async () => {
    // The issue #31 option-2 seam: a composition-layer override, taken by the e2e
    // harness (`tests/e2e/global-setup.ts`) so step 9's flush can actually run.
    const container = buildAppContainer(configuration, {
      pushTransport: { send: async () => undefined },
    });

    expect(container.notificationFlush).not.toBeNull();

    await container.dispose();
  });
});
