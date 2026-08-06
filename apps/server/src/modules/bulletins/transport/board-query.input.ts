import { z } from 'zod';

/**
 * `bulletins.board`'s input.
 *
 * **One optional string, and that is the entire surface.** No `viewerId` (ADR-0002 §5a
 * — the board a caller may read is their own, so there is no parameter that could name
 * a different one), no author filter, no page size, no sort. Each of those is either
 * an M5 grammar field, which arrives *inside* `query` where the validator can see it,
 * or an operational bound an operator turns rather than a client sends (ADR-0004
 * decision 2).
 *
 * **`query` is `z.string().optional()` and nothing more, deliberately.** Length and
 * term bounds are ADR-0007's grammar rules and live in
 * `modules/views/domain/board-query-grammar.ts`; restating the 256-character limit here
 * would make a 257-character query come back as a generic `BAD_REQUEST` instead of the
 * `INVALID_BOARD_QUERY` naming the problem, which is M2-AC13's evidence.
 */
export const boardQueryInput = z.object({
  query: z.string().optional(),
});

export type BoardQueryInput = z.infer<typeof boardQueryInput>;
