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

/** The key a device subscribed under before a rotation. 'HELLO', and not `PUBLIC_KEY`. */
const ROTATED_AWAY_KEY = 'SEVMTE8';

/** What `PushManager.subscribe()` hands back, as the browser would shape it. */
const SUBSCRIPTION_JSON = {
  endpoint: 'https://push.example.invalid/subscription-id',
  expirationTime: null,
  keys: { p256dh: 'a-p256dh-value', auth: 'an-auth-value' },
};

/** What this browser is already holding from an earlier enable, when it holds one. */
const HELD_SUBSCRIPTION_JSON = {
  endpoint: 'https://push.example.invalid/an-earlier-subscription',
  expirationTime: null,
  keys: { p256dh: 'p256dh-old', auth: 'auth-old' },
};

interface FakeBrowserOptions {
  readonly supported?: boolean;
  readonly applicationServerKey?: string | null;
  readonly permission?: NotificationPermission;
  /** What the prompt resolves to. Defaults to `permission`, i.e. no change of mind. */
  readonly answers?: NotificationPermission;
  /** `false` for a build with no service worker — every `pnpm dev` run. */
  readonly registered?: boolean;
  /**
   * The application server key a subscription this browser *already holds* is bound to,
   * or `undefined` for a browser holding none.
   */
  readonly heldSubscriptionKey?: string;
}

/** Whether two application server keys are the same bytes, as the browser compares them. */
function sameKeyBytes(one: ArrayBuffer | null, other: BufferSource | string | null): boolean {
  if (one === null || other === null || typeof other === 'string') {
    return false;
  }

  const left = new Uint8Array(one);
  const right = ArrayBuffer.isView(other)
    ? new Uint8Array(other.buffer, other.byteOffset, other.byteLength)
    : new Uint8Array(other);

  return left.length === right.length && left.every((byte, index) => byte === right[index]);
}

/**
 * A `PushBrowser` that records what it was asked, and answers from a table.
 *
 * `pushManager` models the two Push API rules this flow now depends on, rather than
 * always resolving: **`subscribe()` rejects with `InvalidStateError` when a subscription
 * bound to a different application server key is still held** (it does not replace one),
 * and it returns the held subscription unchanged when the keys match. A fake that
 * resolved regardless would let the rotation bug pass as green.
 */
function fakeBrowser(options: FakeBrowserOptions = {}) {
  const asked: NotificationPermission[] = [];
  const subscribeOptions: PushSubscriptionOptionsInit[] = [];
  const unsubscribed: string[] = [];
  const permission = options.permission ?? 'default';
  const answer = options.answers ?? permission;

  let held: PushSubscription | null =
    options.heldSubscriptionKey === undefined
      ? null
      : ({
          options: {
            applicationServerKey: applicationServerKeyBytes(options.heldSubscriptionKey).buffer,
          },
          toJSON: () => HELD_SUBSCRIPTION_JSON,
          unsubscribe: () => {
            unsubscribed.push(HELD_SUBSCRIPTION_JSON.endpoint);
            held = null;
            return Promise.resolve(true);
          },
        } as unknown as PushSubscription);

  const registration = {
    pushManager: {
      getSubscription: () => Promise.resolve(held),
      subscribe(subscribeInit: PushSubscriptionOptionsInit) {
        subscribeOptions.push(subscribeInit);

        if (held !== null) {
          if (!sameKeyBytes(held.options.applicationServerKey, subscribeInit.applicationServerKey ?? null)) {
            return Promise.reject(
              Object.assign(
                new Error('Registration failed - A subscription with a different key already exists'),
                { name: 'InvalidStateError' },
              ),
            );
          }
          return Promise.resolve(held);
        }

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

  return { browser, asked, subscribeOptions, unsubscribed };
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

    it('propagates a server refusal rather than claiming success', async () => {
      // Every refusal, with no exception for CONFLICT: `notifications.push.subscribe`
      // stores by replacement now, so a second enrollment is a plain success and there
      // is no status left that means "already yours" — a branch swallowing one would be
      // claiming a device is reachable on the strength of a code the server never sends.
      const fake = fakeBrowser({ answers: 'granted' });
      const api = recordingSubscribe(() => Promise.reject(serverRefusal('UNAUTHORIZED')));

      await expect(enablePush(api.subscribe, fake.browser)).rejects.toThrow('UNAUTHORIZED');
    });
  });

  describe('given this browser already holds a subscription', () => {
    /*
     * The VAPID pair rotates (`docs/engineering/secrets.md` §4), and every device that
     * subscribed under the old public key is still holding a subscription bound to it.
     * `subscribe()` does not replace that one — it rejects with `InvalidStateError` —
     * so without dropping the stale subscription first, "Enable push" fails on those
     * devices forever, and the only enrollment path in the app cannot carry out the
     * rotation procedure that same document prescribes.
     */
    it('drops a subscription bound to a superseded key, then enrolls the fresh one', async () => {
      const fake = fakeBrowser({ answers: 'granted', heldSubscriptionKey: ROTATED_AWAY_KEY });
      const api = recordingSubscribe();

      await expect(enablePush(api.subscribe, fake.browser)).resolves.toBe('subscribed');
      expect(fake.unsubscribed).toEqual([HELD_SUBSCRIPTION_JSON.endpoint]);
      expect(api.forwarded).toEqual([SUBSCRIPTION_JSON]);
    });

    it('keeps one already bound to the configured key, and re-registers it', async () => {
      // No churn: unsubscribing a working subscription would mint a new endpoint on
      // every press and leave a window with no subscription at all if the re-subscribe
      // then failed. Forwarding it again is what makes the press a repair — the server
      // stores by replacement, so this is how a device's current credential wins back
      // an account whose stored one belongs to a browser that no longer exists.
      const fake = fakeBrowser({ answers: 'granted', heldSubscriptionKey: PUBLIC_KEY });
      const api = recordingSubscribe();

      await expect(enablePush(api.subscribe, fake.browser)).resolves.toBe('subscribed');
      expect(fake.unsubscribed).toEqual([]);
      expect(api.forwarded).toEqual([HELD_SUBSCRIPTION_JSON]);
    });
  });

  describe('given permission is refused', () => {
    it('reports denied, subscribes nothing, and drops nothing already held', async () => {
      // The held subscription is stale here, and it still survives a refusal: dropping
      // one on the way to an answer that turns out to be "no" would spend a device's
      // working enrollment on a press that enrolled nothing.
      const fake = fakeBrowser({ answers: 'denied', heldSubscriptionKey: ROTATED_AWAY_KEY });
      const api = recordingSubscribe();

      await expect(enablePush(api.subscribe, fake.browser)).resolves.toBe('denied');
      expect(api.forwarded).toEqual([]);
      expect(fake.subscribeOptions).toEqual([]);
      expect(fake.unsubscribed).toEqual([]);
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
