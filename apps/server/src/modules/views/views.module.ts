/**
 * `modules/views`' public surface — and it is a set of pure functions, not a factory.
 *
 * Every other module's `<name>.module.ts` is a wiring point: it builds repositories,
 * assembles services, and hands back a router. This one has nothing to wire. The board
 * grammar owns no table, opens no connection, and holds no state — it is a total
 * function from text to a validated AST — so `createViewsModule({ database })` would be
 * ceremony around a re-export, and a router mounted with no procedure is the
 * placeholder addendum §4 forbids. Saved views and Notify Me (M5) are what give this
 * module state, a table, and procedures; the factory arrives with them.
 *
 * **This file is the whole of what other modules may import.** `modules/bulletins`'
 * board query consumes `parseBoardQuery` from here, which is addendum §19's "shared
 * contract with clear ownership" rather than a reach-in: views owns the grammar
 * (ADR-0007: "one grammar, one validator, one compiler" for board list, saved views,
 * and Notify Me), and the three consumers arriving over three milestones is exactly
 * why it may not be re-derived per caller.
 *
 * ⚠ Re-export additions belong here only if another module genuinely needs them.
 * Widening this barrel is how a module's internals become everyone's dependency.
 */
export {
  EMPTY_BOARD_QUERY,
  InvalidBoardQueryError,
  parseBoardQuery,
} from './domain/board-query-grammar';
export type { BoardQuery } from './domain/board-query-grammar';
