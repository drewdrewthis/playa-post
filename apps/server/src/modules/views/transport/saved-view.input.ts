import { z } from 'zod';

/**
 * The saved-view procedures' inputs.
 *
 * ⚠ **Not one of them carries an owner.** `app.saved_views.owner_id` is always the
 * caller's resolved `Actor` (ADR-0002:180-181, B14), so a field naming somebody else's
 * views is not merely forbidden — there is nowhere for it to point.
 * `tests/fitness/viewer-id-provenance.fitness.test.ts` walks the built router to prove
 * the field never appears. `viewId` is a different thing entirely: it names a *row*, and
 * every statement behind it is scoped to the actor, so an id belonging to somebody else
 * matches nothing (M5-AC16).
 *
 * **`sourceText` is `z.string()` and nothing more, deliberately.** Length and term bounds
 * are ADR-0007's grammar rules and live in `domain/board-query-grammar.ts`; restating the
 * 256-character limit here would make an over-long query come back as a generic
 * `BAD_REQUEST` instead of the `INVALID_BOARD_QUERY` naming the offending token — the
 * same argument `update-notify-me-query.input.ts` already makes. `name` is bounded in
 * `domain/saved-view-name.policy.ts` for the identical reason.
 */
export const saveViewInput = z.object({
  name: z.string(),
  sourceText: z.string(),
});

export type SaveViewInput = z.infer<typeof saveViewInput>;

/** Input of every procedure that names one saved view. */
export const savedViewTargetInput = z.object({
  viewId: z.uuid(),
});

export type SavedViewTargetInput = z.infer<typeof savedViewTargetInput>;

/**
 * `views.saved.rename`'s input.
 *
 * `expectedVersion` is **required**, unlike `views.notifyMe.update`'s: a rename always
 * edits a row the caller has already read from `views.saved.list`, which carries the
 * version, so there is no first-write case where the caller could not know it
 * (ADR-0005:102).
 */
export const renameSavedViewInput = savedViewTargetInput.extend({
  name: z.string(),
  expectedVersion: z.number().int().positive(),
});

export type RenameSavedViewInput = z.infer<typeof renameSavedViewInput>;

/**
 * `views.saved.setNotify`'s input.
 *
 * `notify` is explicit rather than the procedure being a toggle, because a toggle applied
 * to state the client has not re-read is a coin flip: two taps that race each other on a
 * slow connection would land in an order nobody chose. Sending the *desired* state makes
 * the operation idempotent, which is what a switch means.
 */
export const setSavedViewNotifyInput = savedViewTargetInput.extend({
  notify: z.boolean(),
});

export type SetSavedViewNotifyInput = z.infer<typeof setSavedViewNotifyInput>;
