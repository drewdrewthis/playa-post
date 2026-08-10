import { useState, type JSX } from 'react';

import { useApi } from '../api/api-provider';

import { enablePush, readPushEnrollment, type PushEnrollment } from './enable-push';

/**
 * The consent line, said before the browser's own prompt appears.
 *
 * Short, declarative, and it names both halves of what happens — that this device
 * starts getting pinged, and that the browser asks first — because the browser's dialog
 * says neither. It is the same shape as the CONNECT card's "Nothing happens until you
 * both consent.": the sentence a person needs *before* they tap, not after.
 */
const CONSENT_LINE =
  'Get pinged on this device when something lands here. Your browser will ask first.';

/**
 * What to say when the browser is blocking.
 *
 * ⚠ **The remedy is named, and it is not this app's.** `requestPermission()` resolves
 * `'denied'` immediately without showing anything once a person has refused, so a
 * control that offers to ask again would do nothing, visibly — which is why the button
 * below is disabled here rather than merely unhelpful.
 */
const DENIED_LINE =
  'Your browser is blocking notifications for this site. Turn them back on in its settings — nothing in here can undo that.';

/** Enrolled. Present tense, because the fact is now true of this device and no other. */
const SUBSCRIBED_LINE = 'Push is on for this device.';

/**
 * Whatever else went wrong. No cause offered: the failures reaching here are a push
 * service refusing a subscription and the server refusing to store one, and neither is
 * something the reader can tell apart or act on differently.
 */
const FAILED_LINE = 'That did not go through. Try again.';

/**
 * The panel's "enable push" affordance.
 *
 * **Inside the notifications panel and nowhere else**, because this is where intent
 * already is: somebody reading their notifications is the one person who has just
 * demonstrated they want to know about them. An app-level banner would ask everybody,
 * including the people who opened the app to post.
 *
 * **Renders nothing at all** when the browser has no Push API, when this build
 * registered no service worker, or when no `VITE_VAPID_PUBLIC_KEY` was configured — see
 * {@link PushEnrollment}. A control that cannot work is worse than no control: it
 * teaches that the feature is broken rather than absent.
 *
 * ⚠ **The press is the user gesture.** {@link enablePush} must run inside one — browsers
 * refuse to show the permission prompt otherwise, and Chrome holds a
 * without-a-gesture ask against the origin permanently. Nothing here may move that call
 * into an effect.
 */
export function EnablePushControl(): JSX.Element | null {
  const api = useApi();
  // Read once, on mount: the answer changes only as a result of the press below, and
  // re-reading per render would re-run a feature detect for nothing.
  const [enrollment, setEnrollment] = useState<PushEnrollment>(() => readPushEnrollment());
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);

  async function enable(): Promise<void> {
    setPending(true);
    setFailed(false);

    try {
      setEnrollment(
        await enablePush((request) => api.mutate('notifications.push.subscribe', request)),
      );
    } catch {
      // Including `PushNotConfiguredError`, which cannot arrive here — this component
      // does not render without a key — and is caught rather than special-cased because
      // there is one honest thing to say about every failure at this seam.
      setFailed(true);
    } finally {
      setPending(false);
    }
  }

  if (enrollment === 'unsupported' || enrollment === 'not-configured') {
    return null;
  }

  if (enrollment === 'subscribed') {
    return (
      <p className="notifications__push notifications__push--on" data-testid="enable-push">
        {SUBSCRIBED_LINE}
      </p>
    );
  }

  const denied = enrollment === 'denied';

  return (
    <section className="notifications__push" data-testid="enable-push">
      <p className="notifications__push-copy">{denied ? DENIED_LINE : CONSENT_LINE}</p>

      <button
        className="notifications__push-button"
        data-testid="enable-push-button"
        type="button"
        disabled={denied || pending}
        onClick={() => {
          void enable();
        }}
      >
        Enable push
      </button>

      {failed ? (
        <p className="notifications__push-failed" role="status" data-testid="enable-push-failed">
          {FAILED_LINE}
        </p>
      ) : null}
    </section>
  );
}
