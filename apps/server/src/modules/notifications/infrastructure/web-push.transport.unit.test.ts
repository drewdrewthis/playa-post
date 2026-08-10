import { describe, expect, it } from 'vitest';

import { GROUPED_PUSH_MESSAGE, type PushPayload, type PushSubscription } from '../domain/push-transport';

import { createWebPushTransport, type SendWebPushNotification } from './web-push.transport';

/**
 * The `web-push` adapter's three decisions, asserted at the library seam.
 *
 * A push service is the one boundary this module cannot call cheaply or
 * deterministically (`references/principles/coding.md`), so `sendNotification` is
 * substituted and everything else — the payload serialisation, the VAPID details, the
 * failure classification — is the real adapter.
 *
 * ⚠ **Obvious placeholder credentials.** A realistic-looking key in a test file is a
 * credential in source control as far as `secret-scan` and a future reader are
 * concerned, and the same rule `load-configuration.unit.test.ts` states.
 */
const VAPID = {
  publicKey: 'a-public-key-that-is-not-real',
  privateKey: 'a-private-key-that-is-not-real',
  contact: 'mailto:nobody@example.invalid',
} as const;

const SUBSCRIPTION: PushSubscription = {
  endpoint: 'https://push.example.invalid/subscription-id',
  keys: { p256dh: 'a-p256dh-value', auth: 'an-auth-value' },
};

const PAYLOAD: PushPayload = {
  recipientId: '11111111-1111-4111-8111-111111111111',
  bulletinIds: ['22222222-2222-4222-8222-222222222222'],
  message: GROUPED_PUSH_MESSAGE,
};

/** One call the adapter made, and a log it wrote, recorded rather than asserted here. */
function recordingSeam(behaviour: SendWebPushNotification = () => Promise.resolve({})) {
  const sent: Parameters<SendWebPushNotification>[] = [];
  const warnings: { readonly fields: Record<string, unknown>; readonly message: string }[] = [];

  return {
    sent,
    warnings,
    log: {
      warn(fields: Record<string, unknown>, message: string): void {
        warnings.push({ fields, message });
      },
    },
    sendNotification: ((subscription, payload, options) => {
      sent.push([subscription, payload, options]);
      return behaviour(subscription, payload, options);
    }) satisfies SendWebPushNotification,
  };
}

/** What `web-push` rejects with on a non-2xx response: a `WebPushError` carrying one. */
function pushServiceRefusal(statusCode: number): Error & { statusCode: number } {
  return Object.assign(new Error(`push service answered ${String(statusCode)}`), { statusCode });
}

describe('createWebPushTransport', () => {
  it('declares itself configured, which is what schedules the flush', () => {
    const seam = recordingSeam();

    const transport = createWebPushTransport({
      vapid: VAPID,
      log: seam.log,
      sendNotification: seam.sendNotification,
    });

    expect(transport.isConfigured).toBe(true);
  });

  describe('given a subscription the push service accepts', () => {
    it('signs with the VAPID details it was configured with, per call', async () => {
      // Per call rather than through `webPush.setVapidDetails()`, which mutates state
      // shared by every importer in the process — two containers in one test run would
      // otherwise sign each other's pushes.
      const seam = recordingSeam();

      await createWebPushTransport({
        vapid: VAPID,
        log: seam.log,
        sendNotification: seam.sendNotification,
      }).send(SUBSCRIPTION, PAYLOAD);

      expect(seam.sent[0]?.[2]).toEqual({
        vapidDetails: {
          subject: VAPID.contact,
          publicKey: VAPID.publicKey,
          privateKey: VAPID.privateKey,
        },
      });
    });

    it('sends the subscription exactly as it was stored', async () => {
      const seam = recordingSeam();

      await createWebPushTransport({
        vapid: VAPID,
        log: seam.log,
        sendNotification: seam.sendNotification,
      }).send(SUBSCRIPTION, PAYLOAD);

      expect(seam.sent[0]?.[0]).toEqual({
        endpoint: SUBSCRIPTION.endpoint,
        keys: { p256dh: SUBSCRIPTION.keys.p256dh, auth: SUBSCRIPTION.keys.auth },
      });
    });

    /*
     * M2-AC21, at the last seam before the network. `push-transport.ts` proves the
     * payload the handler *builds*; this proves nothing is added on the way out —
     * a title, an icon, a `data` envelope, an author's name. A full-object equality
     * rather than a field check, so an added key fails here rather than shipping.
     */
    it('puts the payload on the wire with no field added to it', async () => {
      const seam = recordingSeam();

      await createWebPushTransport({
        vapid: VAPID,
        log: seam.log,
        sendNotification: seam.sendNotification,
      }).send(SUBSCRIPTION, PAYLOAD);

      const body: unknown = JSON.parse(String(seam.sent[0]?.[1]));

      expect(body).toEqual({
        recipientId: PAYLOAD.recipientId,
        bulletinIds: PAYLOAD.bulletinIds,
        message: GROUPED_PUSH_MESSAGE,
      });
    });

    it('carries the fixed message and never an interpolated one', async () => {
      const seam = recordingSeam();

      await createWebPushTransport({
        vapid: VAPID,
        log: seam.log,
        sendNotification: seam.sendNotification,
      }).send(SUBSCRIPTION, PAYLOAD);

      expect(String(seam.sent[0]?.[1])).toContain(GROUPED_PUSH_MESSAGE);
    });
  });

  describe('given a push service that says the endpoint is gone', () => {
    /*
     * The load-bearing case. `send` runs inside the flush's receipt transaction and the
     * flush walks its windows sequentially, so a throw here would roll this window back
     * on every round forever and starve every recipient sorted after it. One dead device
     * must not stop everybody else's notifications.
     */
    it.each([404, 410])('resolves rather than throwing on %i', async (statusCode) => {
      const seam = recordingSeam(() => Promise.reject(pushServiceRefusal(statusCode)));

      await expect(
        createWebPushTransport({
          vapid: VAPID,
          log: seam.log,
          sendNotification: seam.sendNotification,
        }).send(SUBSCRIPTION, PAYLOAD),
      ).resolves.toBeUndefined();
    });

    it('logs the status, and nothing that identifies the person or the device', async () => {
      // Tolerated silently would be a silent hole; the log line is what makes it a fact
      // an operator can see. The endpoint is a routable push credential and the
      // recipient id is a person — neither belongs in a log (addendum §17, §25).
      const seam = recordingSeam(() => Promise.reject(pushServiceRefusal(410)));

      await createWebPushTransport({
        vapid: VAPID,
        log: seam.log,
        sendNotification: seam.sendNotification,
      }).send(SUBSCRIPTION, PAYLOAD);

      expect(seam.warnings).toHaveLength(1);
      expect(seam.warnings[0]?.fields).toEqual({ statusCode: 410 });

      const logged = JSON.stringify(seam.warnings[0]);
      expect(logged).not.toContain(SUBSCRIPTION.endpoint);
      expect(logged).not.toContain(PAYLOAD.recipientId);
    });
  });

  describe('given a delivery failure that is not the endpoint being gone', () => {
    /*
     * At-least-once is the contract (ADR-0006, `PushTransport.send`): throwing rolls the
     * receipt back so the window is retried. Swallowing a transient failure would make
     * it at-most-once and lose notifications with nothing to show for it.
     */
    it.each([429, 500, 503])('rethrows a %i so the window is retried', async (statusCode) => {
      const seam = recordingSeam(() => Promise.reject(pushServiceRefusal(statusCode)));

      await expect(
        createWebPushTransport({
          vapid: VAPID,
          log: seam.log,
          sendNotification: seam.sendNotification,
        }).send(SUBSCRIPTION, PAYLOAD),
      ).rejects.toThrow(`push service answered ${String(statusCode)}`);
    });

    it('rethrows a transport error that carries no status at all', async () => {
      // A dropped socket rejects with a plain `Error`. Unknown means transient — the
      // fail-safe direction, since retrying a delivery costs a round and swallowing one
      // costs a notification.
      const seam = recordingSeam(() => Promise.reject(new Error('socket hang up')));

      await expect(
        createWebPushTransport({
          vapid: VAPID,
          log: seam.log,
          sendNotification: seam.sendNotification,
        }).send(SUBSCRIPTION, PAYLOAD),
      ).rejects.toThrow('socket hang up');
    });

    it('writes no log line, because the retry is not an operator-actionable event', async () => {
      const seam = recordingSeam(() => Promise.reject(pushServiceRefusal(503)));

      await expect(
        createWebPushTransport({
          vapid: VAPID,
          log: seam.log,
          sendNotification: seam.sendNotification,
        }).send(SUBSCRIPTION, PAYLOAD),
      ).rejects.toThrow();

      expect(seam.warnings).toEqual([]);
    });
  });
});
