import type { SubscribeToPushRequest } from '@playa-post/contracts';

import {
  deviceLocalPushEnrollmentStore,
  type PushEnrollmentStore,
} from './push-enrollment-store';

/**
 * Where this device stands on push, as the panel has to render it.
 *
 * Six states rather than a boolean, because four of them need different words and four
 * of them are not the person's fault:
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
 * - `dismissed` — this device closed the browser's prompt without answering, recently
 *   enough that the offer is not being made again. Renders nothing, like `unsupported`,
 *   and for the opposite reason: it *could* be asked, and has said not now.
 * - `subscribed` — this device is holding a subscription minted under this build's key.
 */
export type PushEnrollment =
  | 'unsupported'
  | 'not-configured'
  | 'default'
  | 'denied'
  | 'dismissed'
  | 'subscribed';

/**
 * How long a dismissed prompt retires the offer for — `docs/product/decisions.md` D8.
 *
 * A cooldown rather than a permanent retirement: a browser permission dialog is as often
 * dismissed by a stray tap or an Escape as by a decision, and "clear this site's data" is
 * not a path back a person will find. Exported so the decision, the flow, and the test
 * that walks the edge all read the same number.
 */
export const PROMPT_DISMISSAL_COOLDOWN_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

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
 * Whether a recorded dismissal is still holding the offer back.
 *
 * A stamp in the *future* counts as lapsed: a clock that moved is not an answer, and
 * trusting one would retire the offer for however long the skew lasts.
 */
function withinDismissalCooldown(dismissedAt: Date | null, now: Date): boolean {
  if (dismissedAt === null) {
    return false;
  }

  const elapsed = now.getTime() - dismissedAt.getTime();

  return elapsed >= 0 && elapsed < PROMPT_DISMISSAL_COOLDOWN_DAYS * DAY_MS;
}

/**
 * What to render before anybody presses anything, and before anything is awaited.
 *
 * Synchronous on purpose: it decides whether a control exists at all, and a control that
 * appears one tick after the panel opens is a control that moves under a thumb already
 * travelling towards it. What it cannot know without awaiting — is there a service
 * worker, is a subscription actually held — {@link settlePushEnrollment} answers a tick
 * later and corrects this.
 *
 * ⚠ **`'subscribed'` here is the device's own memory, gated on a granted permission.**
 * The marker alone is never enough: permission revoked in browser or OS settings must
 * flip this device straight back to the offer, whatever it remembers and whatever it is
 * still holding (issue #167). The gate is what makes a stale marker harmless rather than
 * a device that quietly believes it is reachable.
 *
 * ⚠ **A granted permission outranks a recorded dismissal.** The dismissal recorded "the
 * browser asked and got no answer"; a granted permission means that question has since
 * been answered yes, in the browser's own settings. Honouring the dismissal there would
 * leave somebody who changed their mind no way in at all until the cooldown lapsed.
 *
 * `'denied'` is deliberately checked *first*: Chrome blocks an origin by itself after
 * repeated dismissals, so "dismissed, then blocked" arrives without anybody choosing it,
 * and going quiet would leave a reader wondering why the app never mentions push.
 */
export function readPushEnrollment(
  browser: PushBrowser = browserPush(),
  store: PushEnrollmentStore = deviceLocalPushEnrollmentStore(),
  now: Date = new Date(),
): PushEnrollment {
  if (!browser.supported) {
    return 'unsupported';
  }

  const { applicationServerKey } = browser;

  if (applicationServerKey === null) {
    return 'not-configured';
  }

  const permission = browser.permission();

  if (permission === 'denied') {
    return 'denied';
  }

  const marker = store.read();

  if (permission === 'granted') {
    return marker.subscribedKey === applicationServerKey ? 'subscribed' : 'default';
  }

  return withinDismissalCooldown(marker.dismissedAt, now) ? 'dismissed' : 'default';
}

/**
 * The same question, answered from the subscription this browser is actually holding.
 *
 * This is what fixes issue #167: enrolment is a subscription, not a permission, and the
 * only place that fact lives is `pushManager.getSubscription()`. Reading it costs two
 * awaits, so {@link readPushEnrollment} paints first and this corrects — and the
 * correction is authoritative in both directions. It reconciles the marker as it goes:
 * a device whose subscription is gone stops claiming one, and a device that enrolled
 * before the marker existed acquires one from what was found.
 *
 * ⚠ **It never asks for permission.** This runs in an effect, on mount. Browsers only
 * show the prompt inside a user activation and Chrome holds a without-a-gesture ask
 * against the origin permanently, so `requestPermission()` belongs to {@link enablePush}
 * and the press that calls it, and to nothing else.
 *
 * ⚠ **"Cannot see" is not "not enrolled".** With no registration — a `pnpm dev` build,
 * or the seconds a fresh install spends registering one — nothing is claimed and nothing
 * is forgotten: the synchronous answer stands. Answering `'default'` there would clear a
 * working device's marker and swap its enrolled line for the offer, on a race.
 *
 * @param store - Defaults to this device's `localStorage`; a test hands in its own.
 * @param now - The reading clock, for the dismissal cooldown.
 */
export async function settlePushEnrollment(
  browser: PushBrowser = browserPush(),
  store: PushEnrollmentStore = deviceLocalPushEnrollmentStore(),
  now: Date = new Date(),
): Promise<PushEnrollment> {
  if (!browser.supported) {
    return 'unsupported';
  }

  const { applicationServerKey } = browser;

  if (applicationServerKey === null) {
    return 'not-configured';
  }

  if (browser.permission() !== 'granted') {
    // Checked before anything is awaited, so a revoked permission cannot be masked by a
    // subscription the browser has not got round to dropping. Nothing will be delivered
    // through it, which makes it not an enrolment.
    store.forgetSubscribed();

    return readPushEnrollment(browser, store, now);
  }

  const registration = await browser.registration();

  if (registration === null) {
    // Nothing to ask, so nothing is claimed and — deliberately — nothing is forgotten.
    return readPushEnrollment(browser, store, now);
  }

  const held = await registration.pushManager.getSubscription();

  if (held !== null && isKeyedTo(held, applicationServerKeyBytes(applicationServerKey))) {
    store.rememberSubscribed(applicationServerKey);

    return 'subscribed';
  }

  store.forgetSubscribed();

  return readPushEnrollment(browser, store, now);
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

/**
 * Whether a subscription the browser is already holding was minted under this key.
 *
 * A `PushSubscription` is bound for life to the application server key it was created
 * with, and the binding is invisible to the person holding it: the only way to tell is
 * to compare `options.applicationServerKey` against the key this build ships. `null` —
 * a subscription created with no key at all — is never a match, which is the answer
 * that makes it get replaced.
 */
function isKeyedTo(subscription: PushSubscription, key: Uint8Array): boolean {
  const bound = subscription.options.applicationServerKey;

  if (bound === null) {
    return false;
  }

  const boundBytes = new Uint8Array(bound);

  return boundBytes.length === key.length && boundBytes.every((byte, at) => byte === key[at]);
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
 * is a decision they do not get to make twice. A subscription this browser already
 * holds is reconciled **after** the answer, so a refusal costs nothing it was holding.
 *
 * ⚠ **A held subscription bound to a superseded key is dropped first.**
 * `pushManager.subscribe()` does not replace one — it rejects with `InvalidStateError`
 * — so after the VAPID rotation `docs/engineering/secrets.md` §4 prescribes, every
 * previously-subscribed device would fail here forever, and this is the app's only
 * enrollment path. A held subscription that *matches* is kept and re-registered rather
 * than re-minted: replacing a working one churns the endpoint on every press and leaves
 * a window with nothing subscribed if the re-subscribe then fails.
 *
 * ⚠ **`subscription.toJSON()` is forwarded exactly as the browser produced it.**
 * `subscribe-to-push.input.ts` asks for precisely that: "a client that has to rearrange
 * a credential is a client that can rearrange it wrong". The server's zod input reads
 * the three fields it needs and ignores the rest.
 *
 * Every server refusal propagates. There is no "already subscribed" code to swallow:
 * `notifications.push.subscribe` stores by replacement, so a re-enrollment succeeds
 * plainly — see `subscribe-to-push.service.ts`. That is what makes forwarding a
 * subscription this device was already holding a repair rather than a no-op.
 *
 * ⚠ **The outcome is written to the device-local marker, and the order matters.** The
 * enrolment is recorded only after the server has stored the subscription — a marker
 * written earlier would leave a device claiming an enrolment nothing will be delivered
 * to. A *dismissed* prompt is recorded too, which is what stops later loads re-offering
 * (`docs/product/decisions.md` D8) while this session's control stays exactly as it was.
 *
 * @param subscribe - Sends `notifications.push.subscribe`. Injected so a test asserts on
 *   what was forwarded rather than on a transport.
 * @param browser - Defaults to the real browser; a test hands in its own.
 * @param store - Defaults to this device's `localStorage`; a test hands in its own.
 * @returns The state to render. Never `'not-configured'` — that is a build fact known
 *   before the press, and reaching this function without a key throws instead. Never
 *   `'dismissed'` either: retiring the offer under the thumb that just pressed it would
 *   read as a crash, so a dismissal only takes effect on the next load.
 * @throws {PushNotConfiguredError} when the build ships no `VITE_VAPID_PUBLIC_KEY`.
 */
export async function enablePush(
  subscribe: (request: SubscribeToPushRequest) => Promise<void>,
  browser: PushBrowser = browserPush(),
  store: PushEnrollmentStore = deviceLocalPushEnrollmentStore(),
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
    if (permission !== 'denied') {
      // A dismissed prompt: no answer, so nothing is decided *here* — the control stays
      // exactly as it was and a second press asks again. The record is for later loads,
      // which stop making an offer this person has already waved away once.
      store.rememberPromptDismissed();
    }

    // 'denied' is a decision, with its own copy naming the only thing that can undo it.
    // Recording a dismissal on top would silence that copy the day the browser unblocked.
    return permission === 'denied' ? 'denied' : 'default';
  }

  const keyBytes = applicationServerKeyBytes(applicationServerKey);
  const held = await registration.pushManager.getSubscription();

  if (held !== null && !isKeyedTo(held, keyBytes)) {
    await held.unsubscribe();
  }

  const subscription = await registration.pushManager.subscribe({
    // Required by every browser that implements the API: a push that renders nothing is
    // a silent background wake, and this app has no use for one.
    userVisibleOnly: true,
    applicationServerKey: keyBytes,
  });

  // The cast asserts what a real subscription always carries and the DOM type marks
  // optional. Narrowing it by hand would mean rebuilding the object, which is the one
  // thing the server's input contract asks a client not to do.
  await subscribe(subscription.toJSON() as unknown as SubscribeToPushRequest);

  // After the server has agreed, never before — and it clears any earlier dismissal,
  // because this device has now said yes to the question that recorded one.
  store.rememberSubscribed(applicationServerKey);

  return 'subscribed';
}
