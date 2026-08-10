// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createFakeApi,
  mountWithApi,
  requireElement,
  type MountedTree,
} from '../testing/mount-with-api';

import { EnablePushControl } from './enable-push-control';
import { NotificationsPanel } from './notifications-panel';

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
  } = {},
): void {
  const permission = options.permission ?? 'default';

  vi.stubGlobal('PushManager', class {});
  vi.stubGlobal('Notification', {
    permission,
    requestPermission: () => Promise.resolve(options.answers ?? permission),
  });

  const registration = {
    pushManager: {
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
