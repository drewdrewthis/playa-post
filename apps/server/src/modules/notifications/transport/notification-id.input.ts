import { z } from 'zod';

/**
 * The input for `notifications.dismiss` — the identifier `notifications.list` served.
 *
 * `notificationId` is checked as a UUID because it reaches a `uuid` comparison in
 * `app.outbox_events` and a malformed one would come back as a driver-level 500 — a wire
 * concern, not a domain rule. The same reasoning
 * `modules/moderation/transport/moderation-target.input.ts` records for `bulletinId`.
 *
 * ⚠ That check is **not** an existence check and must never become one. A well-formed
 * UUID naming a notification that is not the caller's gets
 * `NOTIFICATION_UNAVAILABLE`, byte-identical to one that never existed (ADR-0002 §10).
 *
 * ⚠ **No `viewerId`, `userId`, `actorId`, or `ownerId` field** (ADR-0002:180-181). The
 * recipient is the resolved actor; a caller naming one would be clearing somebody else's
 * panel. `tests/fitness/viewer-id-provenance.fitness.test.ts` walks the built router and
 * fails on any such field.
 */
export const notificationIdInput = z.object({
  notificationId: z.uuid(),
});

export type NotificationIdInput = z.infer<typeof notificationIdInput>;
