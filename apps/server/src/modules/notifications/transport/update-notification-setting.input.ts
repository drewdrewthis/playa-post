import { z } from 'zod';

import { NOTIFICATION_KINDS } from '../domain/notification-kind';

/**
 * The input for `notifications.settings.update` — one switch, one position.
 *
 * `kind` restates the domain's `NOTIFICATION_KINDS` through zod rather than accepting
 * free text: an unknown kind is a wire mistake and gets a 400 here, never a CHECK
 * violation surfacing as a driver-level 500.
 *
 * ⚠ **No `viewerId`, `userId`, `actorId`, or `ownerId` field** (ADR-0002:180-181). The
 * owner is the resolved actor; a caller naming one would be flipping somebody else's
 * switches. `tests/fitness/viewer-id-provenance.fitness.test.ts` walks the built router
 * and fails on any such field.
 */
export const updateNotificationSettingInput = z.object({
  kind: z.enum(NOTIFICATION_KINDS),
  enabled: z.boolean(),
});

export type UpdateNotificationSettingInput = z.infer<typeof updateNotificationSettingInput>;
