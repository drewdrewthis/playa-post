import { z } from 'zod';

/**
 * `views.notifyMe.update`'s input.
 *
 * **A query string and a version, and that is the entire surface.** There is no
 * `ownerId` and no query identifier, and D16 did not change that even though it gave
 * `app.notify_me_queries` a surrogate `id` and let one owner hold several rows: this
 * procedure addresses the **untied** query, the single row per person that
 * `UNIQUE NULLS NOT DISTINCT (owner_id, source_view_id)` holds at `source_view_id IS NULL`.
 * The caller's own resolved `Actor` picks it out completely. A field naming somebody
 * else's query is not merely forbidden by ADR-0002:180-181 — there is still nowhere for it
 * to point. `tests/fitness/viewer-id-provenance.fitness.test.ts` walks this router to prove
 * the field never appears.
 *
 * **`sourceText` is `z.string()` and nothing more, deliberately.** Length and term
 * bounds are ADR-0007's grammar rules and live in `domain/board-query-grammar.ts`;
 * restating the 256-character limit here would make an over-long query come back as a
 * generic `BAD_REQUEST` instead of the `INVALID_BOARD_QUERY` naming the offending
 * token — the same argument `bulletins`' `board-query.input.ts` already makes.
 *
 * `expectedVersion` is optional because a first save has no version to expect
 * (ADR-0005:98); absent means "I believe I have no saved query yet", and a row already
 * existing is itself the mismatch.
 */
export const updateNotifyMeQueryInput = z.object({
  sourceText: z.string(),
  expectedVersion: z.number().int().positive().optional(),
});

export type UpdateNotifyMeQueryInput = z.infer<typeof updateNotifyMeQueryInput>;
