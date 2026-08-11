// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createFakeApi,
  mountWithApi,
  requireElement,
  type MountedTree,
} from '../testing/mount-with-api';

import { applicationServerKeyBytes } from './enable-push';
import { EnablePushControl } from './enable-push-control';
import { NotificationsPanel } from './notifications-panel';
import { deviceLocalPushEnrollmentStore } from './push-enrollment-store';

/**
 * The panel's push affordance, over a stubbed browser.
 *
 * ⚠ jsdom, by the per-file pragma above: the `unit` project runs in `node`, and only the
 * files that render React ask for a DOM. jsdom ships no Push API, so the "this browser
 * cannot" case is the default state here and the others are installed per test.
 *
 * The flow's own branches are asserted without a DOM in `enable-push.unit.test.ts`,
 * through the `PushBrowser` port. What lives here is what that cannot hold: whether a
 * control renders at all, whether it is pressable, and that the panel mounts it.
 */
const PUBLIC_KEY = 'QUJDREVGRw';
const SUBSCRIBE_PATH = 'notifications.push.subscribe';

const SUBSCRIPTION_JSON = {
  endpoint: 'https://push.example.invalid/subscription-id',
  expirationTime: null,
  keys: { p256dh: 'a-p256dh-value', auth: 'an-auth-value' },
};

let tree: MountedTree | null = null;

afterEach(async () => {
  const mounted = tree;

  tree = null;

  if (mounted !== null) {
    await mounted.unmount();
  }

  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  Reflect.deleteProperty(navigator, 'serviceWorker');
  // jsdom gives every file in this suite one shared `localStorage`, and the marker below
  // is the whole subject of half these tests — a leftover would decide the next one.
  globalThis.localStorage.clear();
});

/**
 * Install the three globals `browserPush()` reads, plus the build-time key.
 *
 * `navigator.serviceWorker` is defined on jsdom's own navigator rather than replacing
 * the object: React DOM reads other fields off it, and swapping the whole thing to add
 * one property breaks renders for reasons that have nothing to do with push.
 */
function installPushCapableBrowser(
  options: {
    readonly permission?: NotificationPermission;
    readonly answers?: NotificationPermission;
    readonly configured?: boolean;
    readonly registered?: boolean;
    /** The key a subscription this browser is *already* holding is bound to. */
    readonly heldSubscriptionKey?: string;
  } = {},
): void {
  const permission = options.permission ?? 'default';

  vi.stubGlobal('PushManager', class {});
  vi.stubGlobal('Notification', {
    permission,
    requestPermission: () => Promise.resolve(options.answers ?? permission),
  });

  // A browser holding nothing unless a test says otherwise. What the *flow* does with a
  // held subscription — a key rotation to recover from, one to keep — is asserted in
  // `enable-push.unit.test.ts`, where the Push API's rules are modelled without a DOM;
  // what a held one decides here is only whether this control paints enrolled.
  const held =
    options.heldSubscriptionKey === undefined
      ? null
      : {
          options: {
            applicationServerKey: applicationServerKeyBytes(options.heldSubscriptionKey).buffer,
          },
          toJSON: () => SUBSCRIPTION_JSON,
        };

  const registration = {
    pushManager: {
      getSubscription: () => Promise.resolve(held),
      subscribe: () => Promise.resolve({ toJSON: () => SUBSCRIPTION_JSON }),
    },
  };

  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: {
      getRegistration: () =>
        Promise.resolve((options.registered ?? true) ? registration : undefined),
    },
  });

  if (options.configured ?? true) {
    vi.stubEnv('VITE_VAPID_PUBLIC_KEY', PUBLIC_KEY);
  }
}

/**
 * Press the control and let the flow settle.
 *
 * The press is the user gesture browsers require before showing a permission prompt, so
 * every path through {@link EnablePushControl} that matters starts here and none of them
 * starts in an effect.
 */
async function pressEnable(mounted: MountedTree): Promise<void> {
  await mounted.run(() => {
    requireElement<HTMLButtonElement>(
      mounted.container,
      '[data-testid="enable-push-button"]',
    ).click();
  });
}

describe('EnablePushControl', () => {
  it('renders nothing on a browser with no Push API', async () => {
    // jsdom as it comes: no `serviceWorker`, no `PushManager`, no `Notification`. A
    // control that cannot work teaches that the feature is broken rather than absent.
    tree = await mountWithApi(<EnablePushControl />, createFakeApi({}));

    expect(tree.container.querySelector('[data-testid="enable-push"]')).toBeNull();
  });

  it('renders nothing when the build ships no VAPID public key', async () => {
    // A local checkout with no `.env`. Not the reader's failure to fix, so it is not
    // shown to them at all.
    installPushCapableBrowser({ configured: false });

    tree = await mountWithApi(<EnablePushControl />, createFakeApi({}));

    expect(tree.container.querySelector('[data-testid="enable-push"]')).toBeNull();
  });

  it('offers the ask, with the consent line above it', async () => {
    installPushCapableBrowser({ permission: 'default' });

    tree = await mountWithApi(<EnablePushControl />, createFakeApi({}));

    const control = requireElement(tree.container, '[data-testid="enable-push"]');
    const button = requireElement<HTMLButtonElement>(
      tree.container,
      '[data-testid="enable-push-button"]',
    );

    expect(control.textContent).toContain('Your browser will ask first');
    expect(button.disabled).toBe(false);
  });

  it('disables the ask and names the remedy when the browser is blocking', async () => {
    // `requestPermission()` resolves 'denied' immediately once refused, so a pressable
    // control here would do nothing, visibly. The copy points at the only thing that can
    // undo it.
    installPushCapableBrowser({ permission: 'denied' });

    tree = await mountWithApi(<EnablePushControl />, createFakeApi({}));

    const control = requireElement(tree.container, '[data-testid="enable-push"]');
    const button = requireElement<HTMLButtonElement>(
      tree.container,
      '[data-testid="enable-push-button"]',
    );

    expect(control.textContent).toContain('blocking notifications');
    expect(button.disabled).toBe(true);
  });

  it('subscribes on the press and settles into the enrolled line', async () => {
    installPushCapableBrowser({ permission: 'default', answers: 'granted' });

    const api = createFakeApi({ [SUBSCRIBE_PATH]: () => undefined });
    const mounted = await mountWithApi(<EnablePushControl />, api);

    tree = mounted;
    await pressEnable(mounted);

    // Verbatim `toJSON()`, `expirationTime` and all — the input contract asks a client
    // not to rearrange a credential it is only forwarding.
    expect(api.calls).toEqual([{ kind: 'mutate', path: SUBSCRIBE_PATH, input: SUBSCRIPTION_JSON }]);
    expect(requireElement(mounted.container, '[data-testid="enable-push"]').textContent).toContain(
      'Push is on for this device.',
    );
  });

  it('says so once, honestly, when the subscribe is refused', async () => {
    installPushCapableBrowser({ permission: 'default', answers: 'granted' });

    const mounted = await mountWithApi(
      <EnablePushControl />,
      createFakeApi({
        [SUBSCRIBE_PATH]: () => {
          throw new Error('UNAUTHORIZED');
        },
      }),
    );

    tree = mounted;
    await pressEnable(mounted);

    expect(
      requireElement(mounted.container, '[data-testid="enable-push-failed"]').textContent,
    ).toContain('That did not go through.');
  });

  it('leaves the control pressable when the prompt is dismissed', async () => {
    // 'default' back from the prompt means the person closed it without choosing. The
    // control has to stay exactly as it was, so a second press asks again.
    installPushCapableBrowser({ permission: 'default', answers: 'default' });

    const mounted = await mountWithApi(<EnablePushControl />, createFakeApi({}));

    tree = mounted;
    await pressEnable(mounted);

    expect(
      requireElement<HTMLButtonElement>(mounted.container, '[data-testid="enable-push-button"]')
        .disabled,
    ).toBe(false);
  });

  it('paints the enrolled line on a device that enrolled before this load', async () => {
    // #167: the state used to live in this component and die with it, so every reload
    // asked a device that already had push to enable push. The marker answers the first
    // paint and the held subscription confirms it — no flash of the consent copy at
    // somebody who consented last week.
    installPushCapableBrowser({ permission: 'granted', heldSubscriptionKey: PUBLIC_KEY });
    deviceLocalPushEnrollmentStore().rememberSubscribed(PUBLIC_KEY);

    tree = await mountWithApi(<EnablePushControl />, createFakeApi({}));

    expect(requireElement(tree.container, '[data-testid="enable-push"]').textContent).toContain(
      'Push is on for this device.',
    );
    expect(tree.container.querySelector('[data-testid="enable-push-button"]')).toBeNull();
  });

  it('drops back to the offer when notification permission has been revoked', async () => {
    // Switched off in browser or OS settings. The device is still holding a correctly
    // keyed subscription and it is worth nothing, so neither that nor the remembered
    // answer may keep the enrolled line on screen.
    installPushCapableBrowser({ permission: 'default', heldSubscriptionKey: PUBLIC_KEY });
    deviceLocalPushEnrollmentStore().rememberSubscribed(PUBLIC_KEY);

    tree = await mountWithApi(<EnablePushControl />, createFakeApi({}));

    expect(requireElement(tree.container, '[data-testid="enable-push"]').textContent).toContain(
      'Your browser will ask first',
    );
    // Reconciled, not merely ignored: a marker left claiming enrolment would paint the
    // enrolled line again on the next load, before the settle could correct it.
    expect(deviceLocalPushEnrollmentStore().read().subscribedKey).toBeNull();
  });

  it('corrects a remembered answer the browser no longer backs', async () => {
    // Storage says enrolled, permission agrees, and the subscription itself is gone —
    // dropped by the push service, or by a rotation this device never re-enrolled after.
    // The held subscription is the authority; the marker is only a hint about first paint.
    installPushCapableBrowser({ permission: 'granted' });
    deviceLocalPushEnrollmentStore().rememberSubscribed(PUBLIC_KEY);

    tree = await mountWithApi(<EnablePushControl />, createFakeApi({}));

    expect(requireElement(tree.container, '[data-testid="enable-push"]').textContent).toContain(
      'Your browser will ask first',
    );
  });

  it('stops offering on later loads once the browser prompt was dismissed', async () => {
    // D8. The offer is retired for the cooldown rather than for good — this is the load
    // after the dismissal, not the session it happened in.
    installPushCapableBrowser({ permission: 'default' });
    deviceLocalPushEnrollmentStore().rememberPromptDismissed();

    tree = await mountWithApi(<EnablePushControl />, createFakeApi({}));

    expect(tree.container.querySelector('[data-testid="enable-push"]')).toBeNull();
  });

  it('records the dismissal that retires the offer, without retiring it in this session', async () => {
    // Both halves of D8 in one press: the control stays exactly as it was so a second
    // press asks again, and the time is written so the next load does not.
    installPushCapableBrowser({ permission: 'default', answers: 'default' });

    const mounted = await mountWithApi(<EnablePushControl />, createFakeApi({}));

    tree = mounted;
    await pressEnable(mounted);

    expect(mounted.container.querySelector('[data-testid="enable-push-button"]')).not.toBeNull();
    expect(deviceLocalPushEnrollmentStore().read().dismissedAt).toBeInstanceOf(Date);
  });

  it('offers nothing when this build registered no service worker', async () => {
    // `pnpm dev`: the PWA plugin registers nothing, so the flow answers 'unsupported'
    // and the control retires itself rather than asking for a permission it cannot use.
    installPushCapableBrowser({ permission: 'default', answers: 'granted', registered: false });

    const api = createFakeApi({ [SUBSCRIBE_PATH]: () => undefined });
    const mounted = await mountWithApi(<EnablePushControl />, api);

    tree = mounted;
    await pressEnable(mounted);

    expect(mounted.container.querySelector('[data-testid="enable-push"]')).toBeNull();
    expect(api.calls).toEqual([]);
  });
});

describe('NotificationsPanel', () => {
  it('carries the push affordance, because the panel is where the intent already is', async () => {
    // The control is useless where nobody has asked for notifications. This is the one
    // assertion that it is actually mounted in the screen it was written for.
    installPushCapableBrowser({ permission: 'default' });

    tree = await mountWithApi(
      <NotificationsPanel onClose={() => undefined} />,
      createFakeApi({ 'notifications.list': () => [] }),
    );

    expect(tree.container.querySelector('[data-testid="enable-push-button"]')).not.toBeNull();
  });
});
