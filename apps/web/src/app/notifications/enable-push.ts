import type { SubscribeToPushRequest } from '@playa-post/contracts';

/**
 * Where this device stands on push, as the panel has to render it.
 *
 * Five states rather than a boolean, because four of them need different words and
 * three of them are not the person's fault:
 *
 * - `unsupported` — this browser has no Push API, or this build registered no service
 *   worker (a `pnpm dev` run, where the PWA plugin is off). Nothing to offer.
 * - `not-configured` — the build carries no `VITE_VAPID_PUBLIC_KEY`. Also nothing to
 *   offer, and also not a failure the reader can act on.
 * - `default` — askable. Mirrors `Notification.permission`'s own `'default'`, and
 *   covers an already-`granted` permission too: granting is not enrolling, and this
 *   device may have permission with no subscription on the server.
 * - `denied` — the browser is blocking, and only the browser's own settings can undo
 *   it. `Notification.requestPermission()` resolves `'denied'` immediately without
 *   showing anything, so a control that "asks again" would do nothing, visibly.
 * - `subscribed` — the server has this device's subscription.
 */
export type PushEnrollment =
  | 'unsupported'
  | 'not-configured'
  | 'default'
  | 'denied'
  | 'subscribed';

/**
 * This build ships no VAPID public key.
 *
 * Named, and thrown **only on use** — the same shape `AuthNotConfiguredError` has for
 * the same reason: a local checkout with no `.env` should render a panel that quietly
 * omits the control, not one that crashes on mount. {@link readPushEnrollment} reports
 * `'not-configured'` so the control never renders; this exists for a caller that
 * invokes {@link enablePush} anyway.
 */
export class PushNotConfiguredError extends Error {
  constructor() {
    super('Web Push is not configured: VITE_VAPID_PUBLIC_KEY is unset.');
    this.name = 'PushNotConfiguredError';
  }
}

/**
 * The browser surface this flow touches, as one object.
 *
 * A port rather than four direct global reads, so every branch below is reachable from
 * a test without stubbing `navigator`, `window`, and `Notification` — the extraction
 * `sign-in-failure.ts` makes for the same reason ("a branch left inside a component is
 * a branch no test can reach"). {@link browserPush} is the real implementation and is
 * the only code here that touches a global.
 */
export interface PushBrowser {
  /** Whether this browser has the three APIs the flow needs. */
  readonly supported: boolean;
  /** `VITE_VAPID_PUBLIC_KEY`, URL-safe base64, or `null` when the build has none. */
  readonly applicationServerKey: string | null;
  /** `Notification.permission` right now — read, never asked. */
  permission(): NotificationPermission;
  /** Show the browser's own prompt. Resolves with what the person chose. */
  requestPermission(): Promise<NotificationPermission>;
  /**
   * The service worker registered for this scope, or `null` when there is none.
   *
   * ⚠ **`getRegistration()`, never `ready`.** `navigator.serviceWorker.ready` never
   * settles when nothing is registered — which is every `pnpm dev` run, since the PWA
   * plugin registers no worker in development. Awaiting it there would hang the enable
   * flow forever behind a spinner with no failure to render.
   */
  registration(): Promise<ServiceWorkerRegistration | null>;
}

/** The real browser, read once per call so a late-registered worker is still seen. */
export function browserPush(): PushBrowser {
  const supported =
    typeof navigator !== 'undefined' &&
    'serviceWorker' in navigator &&
    typeof window !== 'undefined' &&
    'PushManager' in window &&
    'Notification' in window;

  const configuredKey: unknown = import.meta.env.VITE_VAPID_PUBLIC_KEY;

  return {
    supported,
    applicationServerKey:
      typeof configuredKey === 'string' && configuredKey !== '' ? configuredKey : null,

    permission: () => Notification.permission,
    requestPermission: () => Notification.requestPermission(),
    registration: async () => (await navigator.serviceWorker.getRegistration()) ?? null,
  };
}

/**
 * What to render before anybody presses anything.
 *
 * Synchronous on purpose: it decides whether a control exists at all, and a control
 * that appears one tick after the panel opens is a control that moves under a thumb
 * already travelling towards it. The one thing it cannot know without awaiting — is
 * there a service worker — is settled inside {@link enablePush} instead, before any
 * permission is asked for.
 */
export function readPushEnrollment(browser: PushBrowser = browserPush()): PushEnrollment {
  if (!browser.supported) {
    return 'unsupported';
  }

  if (browser.applicationServerKey === null) {
    return 'not-configured';
  }

  return browser.permission() === 'denied' ? 'denied' : 'default';
}

/**
 * Decode a URL-safe base64 VAPID key into the bytes `pushManager.subscribe()` wants.
 *
 * `applicationServerKey` accepts a `BufferSource` and, in principle, a base64 string —
 * but the string form is unimplemented or subtly different across browsers, and the
 * byte form is what every reference implementation sends. Padding is restored first:
 * VAPID keys are 65 raw bytes, which is 88 base64 characters minus one `=`, so an
 * unpadded key fails `atob` in every browser that is strict about it.
 *
 * Exported so it can be asserted directly — it is the one piece of this file that is
 * pure arithmetic, and the one whose failure mode is a subscription the server cannot
 * push to rather than an exception anybody sees.
 *
 * ⚠ Returns `Uint8Array<ArrayBuffer>`, not the default `Uint8Array<ArrayBufferLike>`:
 * `BufferSource` excludes a `SharedArrayBuffer`-backed view, so the buffer has to be
 * constructed explicitly for this to be passable to `pushManager.subscribe()` at all.
 */
export function applicationServerKeyBytes(urlSafeBase64: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (urlSafeBase64.length % 4)) % 4);
  const base64 = (urlSafeBase64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(base64);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

/** Read one property off an unknown value without asserting its shape. */
function property(value: unknown, key: string): unknown {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)[key]
    : undefined;
}

/**
 * Whether the server refused because this account already has a subscription.
 *
 * `notifications.push.subscribe` answers `CONFLICT` for `PUSH_SUBSCRIPTION_EXISTS`
 * (M2 stores one subscription per user), and from this side that is **success**: the
 * device asked to be reachable and it is. Surfacing it as a failure would show an error
 * to the one person for whom everything already works.
 *
 * ⚠ Duck-typed on `data.code`, not `instanceof TRPCClientError`: the same error travels
 * as `error.data.code` on the client's normalised error and as `error.shape.data.code`
 * on the raw envelope, and a class check would also bind this app to a tRPC internal
 * it deliberately does not import (ADR-0014 — `@playa-post/contracts` is the surface).
 */
function isAlreadySubscribed(error: unknown): boolean {
  const codes = [
    property(property(error, 'data'), 'code'),
    property(property(property(error, 'shape'), 'data'), 'code'),
  ];

  return codes.includes('CONFLICT');
}

/**
 * Ask for notification permission and register this device — **from a user gesture**.
 *
 * Browsers only show the permission prompt inside a user activation, and Chrome
 * permanently blocks a site that asks without one. So this is called from a button's
 * `onClick` and from nowhere else: never on mount, never after a query resolves.
 *
 * The order is deliberate. The service worker is checked **before** the permission is
 * asked for, because a build with no worker cannot subscribe whatever the person
 * answers — and burning a one-shot permission prompt on a request that cannot be used
 * is a decision they do not get to make twice.
 *
 * ⚠ **`subscription.toJSON()` is forwarded exactly as the browser produced it.**
 * `subscribe-to-push.input.ts` asks for precisely that: "a client that has to rearrange
 * a credential is a client that can rearrange it wrong". The server's zod input reads
 * the three fields it needs and ignores the rest.
 *
 * @param subscribe - Sends `notifications.push.subscribe`. Injected so a test asserts on
 *   what was forwarded rather than on a transport.
 * @param browser - Defaults to the real browser; a test hands in its own.
 * @returns The state to render. Never `'not-configured'` — that is a build fact known
 *   before the press, and reaching this function without a key throws instead.
 * @throws {PushNotConfiguredError} when the build ships no `VITE_VAPID_PUBLIC_KEY`.
 */
export async function enablePush(
  subscribe: (request: SubscribeToPushRequest) => Promise<void>,
  browser: PushBrowser = browserPush(),
): Promise<PushEnrollment> {
  if (!browser.supported) {
    return 'unsupported';
  }

  const { applicationServerKey } = browser;

  if (applicationServerKey === null) {
    throw new PushNotConfiguredError();
  }

  const registration = await browser.registration();

  if (registration === null) {
    // No service worker, so nothing can receive a push even with permission granted.
    // The same answer as a browser without the API, because it is the same fact for
    // the reader: not on this device, not their doing.
    return 'unsupported';
  }

  const permission = await browser.requestPermission();

  if (permission !== 'granted') {
    // 'denied' is a decision; 'default' is a dismissed prompt, which leaves the control
    // exactly as it was so a second press asks again.
    return permission === 'denied' ? 'denied' : 'default';
  }

  const subscription = await registration.pushManager.subscribe({
    // Required by every browser that implements the API: a push that renders nothing is
    // a silent background wake, and this app has no use for one.
    userVisibleOnly: true,
    applicationServerKey: applicationServerKeyBytes(applicationServerKey),
  });

  try {
    // The cast asserts what a real subscription always carries and the DOM type marks
    // optional. Narrowing it by hand would mean rebuilding the object, which is the one
    // thing the server's input contract asks a client not to do.
    await subscribe(subscription.toJSON() as unknown as SubscribeToPushRequest);
  } catch (error) {
    if (!isAlreadySubscribed(error)) {
      throw error;
    }
  }

  return 'subscribed';
}
