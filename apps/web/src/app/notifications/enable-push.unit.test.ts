import { describe, expect, it } from 'vitest';

import type { SubscribeToPushRequest } from '@playa-post/contracts';

import {
  applicationServerKeyBytes,
  enablePush,
  PushNotConfiguredError,
  readPushEnrollment,
  type PushBrowser,
} from './enable-push';

/**
 * The enable-push flow, over a fake browser.
 *
 * No jsdom and no global stubbing: `PushBrowser` is the port this app owns, so the
 * branches are reachable by handing in an implementation rather than by assembling a
 * `navigator` — the same fake-over-interface discipline `mount-with-api.tsx` states.
 * The one real DOM API used below is `atob`, which Node provides globally.
 *
 * An obvious placeholder key, never a realistic one: a VAPID key in a test file reads
 * as a credential to `secret-scan` and to the next person.
 */
const PUBLIC_KEY = 'QUJDREVGRw';

/** What `PushManager.subscribe()` hands back, as the browser would shape it. */
const SUBSCRIPTION_JSON = {
  endpoint: 'https://push.example.invalid/subscription-id',
  expirationTime: null,
  keys: { p256dh: 'a-p256dh-value', auth: 'an-auth-value' },
};

interface FakeBrowserOptions {
  readonly supported?: boolean;
  readonly applicationServerKey?: string | null;
  readonly permission?: NotificationPermission;
  /** What the prompt resolves to. Defaults to `permission`, i.e. no change of mind. */
  readonly answers?: NotificationPermission;
  /** `false` for a build with no service worker — every `pnpm dev` run. */
  readonly registered?: boolean;
}

/** A `PushBrowser` that records what it was asked, and answers from a table. */
function fakeBrowser(options: FakeBrowserOptions = {}) {
  const asked: NotificationPermission[] = [];
  const subscribeOptions: PushSubscriptionOptionsInit[] = [];
  const permission = options.permission ?? 'default';
  const answer = options.answers ?? permission;

  const registration = {
    pushManager: {
      subscribe(subscribeInit: PushSubscriptionOptionsInit) {
        subscribeOptions.push(subscribeInit);
        return Promise.resolve({ toJSON: () => SUBSCRIPTION_JSON });
      },
    },
  } as unknown as ServiceWorkerRegistration;

  const browser: PushBrowser = {
    supported: options.supported ?? true,
    applicationServerKey:
      options.applicationServerKey === undefined ? PUBLIC_KEY : options.applicationServerKey,
    permission: () => permission,
    requestPermission: () => {
      asked.push(answer);
      return Promise.resolve(answer);
    },
    registration: () => Promise.resolve((options.registered ?? true) ? registration : null),
  };

  return { browser, asked, subscribeOptions };
}

/** Records what was forwarded to `notifications.push.subscribe`, and answers as told. */
function recordingSubscribe(behaviour: () => Promise<void> = () => Promise.resolve()) {
  const forwarded: SubscribeToPushRequest[] = [];

  return {
    forwarded,
    subscribe: (request: SubscribeToPushRequest): Promise<void> => {
      forwarded.push(request);
      return behaviour();
    },
  };
}

/** A tRPC client error, in the shape the untyped client actually rejects with. */
function serverRefusal(code: string): Error & { data: { code: string } } {
  return Object.assign(new Error(code), { data: { code } });
}

describe('readPushEnrollment', () => {
  it('reports unsupported when the browser lacks the push APIs', () => {
    expect(readPushEnrollment(fakeBrowser({ supported: false }).browser)).toBe('unsupported');
  });

  it('reports not-configured when the build ships no VAPID public key', () => {
    // A local checkout with no `.env`. Not the reader's problem, and not a state that
    // should render a control they cannot use.
    expect(readPushEnrollment(fakeBrowser({ applicationServerKey: null }).browser)).toBe(
      'not-configured',
    );
  });

  it('reports denied when the browser is already blocking', () => {
    expect(readPushEnrollment(fakeBrowser({ permission: 'denied' }).browser)).toBe('denied');
  });

  it('reports default when the ask has not been made', () => {
    expect(readPushEnrollment(fakeBrowser({ permission: 'default' }).browser)).toBe('default');
  });

  it('reports default when permission is granted but nothing is enrolled yet', () => {
    // Granting is not enrolling: this device may have permission with no subscription on
    // the server at all, and the only way to find out is to press the control.
    expect(readPushEnrollment(fakeBrowser({ permission: 'granted' }).browser)).toBe('default');
  });
});

describe('applicationServerKeyBytes', () => {
  it('decodes URL-safe base64 into the raw bytes subscribe() wants', () => {
    // 'QUJDREVGRw' is 'ABCDEFG' — unpadded, which is how a VAPID key is published.
    expect([...applicationServerKeyBytes('QUJDREVGRw')]).toEqual([65, 66, 67, 68, 69, 70, 71]);
  });

  it('restores the padding a published key omits', () => {
    // A 65-byte VAPID key is 88 base64 characters minus one `=`. Without this, `atob`
    // throws in every browser strict about padding, and the failure surfaces as a
    // permission prompt followed by an unexplained error.
    expect(() => applicationServerKeyBytes('QQ')).not.toThrow();
  });

  it('maps the URL-safe alphabet back to standard base64', () => {
    // `-` and `_` stand in for `+` and `/`. Feeding them to `atob` unmapped produces
    // different bytes, and the only symptom is a push service rejecting every send.
    expect([...applicationServerKeyBytes('-_8')]).toEqual([...applicationServerKeyBytes('+/8')]);
  });
});

describe('enablePush', () => {
  describe('given permission is granted', () => {
    it('forwards subscription.toJSON() verbatim, without reshaping it', async () => {
      // `subscribe-to-push.input.ts`: "a client that has to rearrange a credential is a
      // client that can rearrange it wrong". Object identity of the parsed shape, extra
      // fields and all — the server's zod input reads what it needs and ignores the rest.
      const fake = fakeBrowser({ permission: 'default', answers: 'granted' });
      const api = recordingSubscribe();

      const enrollment = await enablePush(api.subscribe, fake.browser);

      expect(enrollment).toBe('subscribed');
      expect(api.forwarded).toEqual([SUBSCRIPTION_JSON]);
    });

    it('subscribes with userVisibleOnly and the decoded application server key', async () => {
      const fake = fakeBrowser({ answers: 'granted' });

      await enablePush(recordingSubscribe().subscribe, fake.browser);

      expect(fake.subscribeOptions).toEqual([
        {
          userVisibleOnly: true,
          applicationServerKey: applicationServerKeyBytes(PUBLIC_KEY),
        },
      ]);
    });

    it('treats the server CONFLICT as success — this device is already reachable', async () => {
      // `PUSH_SUBSCRIPTION_EXISTS` maps to CONFLICT (M2 stores one subscription per
      // user). Showing an error to the one person for whom everything already works
      // would be the wrong end of the trade.
      const fake = fakeBrowser({ answers: 'granted' });
      const api = recordingSubscribe(() => Promise.reject(serverRefusal('CONFLICT')));

      await expect(enablePush(api.subscribe, fake.browser)).resolves.toBe('subscribed');
    });

    it('propagates any other server refusal rather than claiming success', async () => {
      const fake = fakeBrowser({ answers: 'granted' });
      const api = recordingSubscribe(() => Promise.reject(serverRefusal('UNAUTHORIZED')));

      await expect(enablePush(api.subscribe, fake.browser)).rejects.toThrow('UNAUTHORIZED');
    });
  });

  describe('given permission is refused', () => {
    it('reports denied and subscribes nothing', async () => {
      const fake = fakeBrowser({ answers: 'denied' });
      const api = recordingSubscribe();

      await expect(enablePush(api.subscribe, fake.browser)).resolves.toBe('denied');
      expect(api.forwarded).toEqual([]);
      expect(fake.subscribeOptions).toEqual([]);
    });

    it('reports default when the prompt was dismissed, so a second press asks again', async () => {
      const fake = fakeBrowser({ answers: 'default' });
      const api = recordingSubscribe();

      await expect(enablePush(api.subscribe, fake.browser)).resolves.toBe('default');
      expect(api.forwarded).toEqual([]);
    });
  });

  describe('given a browser or build that cannot do push', () => {
    it('reports unsupported without asking for anything', async () => {
      const fake = fakeBrowser({ supported: false });

      await expect(enablePush(recordingSubscribe().subscribe, fake.browser)).resolves.toBe(
        'unsupported',
      );
      expect(fake.asked).toEqual([]);
    });

    /*
     * `pnpm dev` registers no service worker. `navigator.serviceWorker.ready` never
     * settles there, which is why the flow asks `getRegistration()` — and it asks
     * BEFORE the permission prompt, because a one-shot permission spent on a request
     * that cannot be used is not a decision the person gets to make twice.
     */
    it('reports unsupported when no service worker is registered, and never prompts', async () => {
      const fake = fakeBrowser({ registered: false });
      const api = recordingSubscribe();

      await expect(enablePush(api.subscribe, fake.browser)).resolves.toBe('unsupported');
      expect(fake.asked).toEqual([]);
      expect(api.forwarded).toEqual([]);
    });

    it('throws the named error when the build ships no VAPID public key', async () => {
      // Only on use, mirroring `AuthNotConfiguredError`: the state is knowable before
      // the press, so the control never renders, and this is the backstop for a caller
      // that invokes it anyway.
      const fake = fakeBrowser({ applicationServerKey: null });

      await expect(enablePush(recordingSubscribe().subscribe, fake.browser)).rejects.toBeInstanceOf(
        PushNotConfiguredError,
      );
    });
  });
});
