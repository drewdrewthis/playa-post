import { z } from 'zod';

/**
 * The input for every procedure that names one bulletin — `bulletins.getById` and
 * `bulletins.archive`.
 *
 * One schema for both, because they take the same claim and must answer a bulletin the
 * caller may not touch the same way. Two schemas would be two places for one of them to
 * grow a field the other refuses.
 *
 * `bulletinId` is checked as a UUID because a malformed one reaches a `uuid` column and
 * comes back as a driver-level 500 — a wire concern, not a domain rule (the same
 * argument `set-connection-trust.input.ts` makes for `subjectUserId`).
 *
 * ⚠ That check is **not** an existence check and must never become one. A well-formed
 * UUID naming a bulletin the caller may not see gets `BULLETIN_GONE`, byte-identical to
 * one that never existed (ADR-0002 §10, B17, M2-AC14).
 */
export const bulletinIdInput = z.object({
  bulletinId: z.uuid(),
});

export type BulletinIdInput = z.infer<typeof bulletinIdInput>;
