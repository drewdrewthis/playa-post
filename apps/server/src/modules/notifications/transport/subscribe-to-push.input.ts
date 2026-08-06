import { z } from 'zod';

/**
 * `notifications.push.subscribe`'s input — the Web Push subscription, as the browser
 * produced it.
 *
 * **No `ownerId`.** A caller subscribes themselves and nobody else; the owner is the
 * resolved `Actor` (ADR-0002:180-181, B14), and
 * `tests/fitness/viewer-id-provenance.fitness.test.ts` walks this router to prove the
 * field never appears.
 *
 * The shape mirrors `PushSubscription.toJSON()` so a client can forward what
 * `PushManager.subscribe()` gave it without reshaping — a client that has to rearrange
 * a credential is a client that can rearrange it wrong.
 *
 * `endpoint` is validated as a URL because it is one the server will later call; the
 * two keys are validated only as non-empty, since their content is base64url material
 * this system never interprets and a stricter rule here would refuse a legitimate
 * subscription the day a browser changes its encoding.
 */
export const subscribeToPushInput = z.object({
  endpoint: z.string().url(),
  keys: z.object({
    p256dh: z.string().min(1),
    auth: z.string().min(1),
  }),
});

export type SubscribeToPushInput = z.infer<typeof subscribeToPushInput>;
