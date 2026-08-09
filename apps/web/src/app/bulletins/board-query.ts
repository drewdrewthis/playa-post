import { BULLETIN_TYPE, type BulletinType } from '@playa-post/contracts';

/**
 * The board's search state, compiled into the one query string the server parses.
 *
 * **There is no client-side grammar here, and there must never be one.** The board
 * query language is compiled server-side by `parseBoardQuery`, which refuses an
 * unimplemented token *naming it* rather than ignoring it (ADR-0007:53-56). A client
 * that rewrote, dropped, or locally evaluated a term would show a person results they
 * did not ask for and give them no way to tell. Everything below either concatenates
 * text or normalises whitespace.
 */

/** The chip row's selection: every type, or one of them. */
export type BoardTypeFilter = 'all' | BulletinType;

/** One chip in the board's filter row. */
export interface BoardFilterChip {
  readonly filter: BoardTypeFilter;
  readonly label: string;
}

/**
 * The comp's plural type labels (`typePl`), for the types a client can post.
 *
 * The comp's one human-facing dictionary: its filter chips AND its compose chips both
 * label types from `typePl` (`design/Playa Post.dc.html:732,892`), so the compose
 * select here consumes this same map — a person never sees a bare wire value.
 *
 * A `Record` rather than a lookup with a fallback, deliberately: adding a member to
 * `BULLETIN_TYPE` fails `pnpm typecheck` here until someone writes its label, which is
 * the cheapest possible reminder that a new type needs one. Plural is not derivable —
 * the comp's own dictionary has `thanks`, whose plural is `Thanks`.
 */
export const TYPE_CHIP_LABELS: Record<BulletinType, string> = {
  offer: 'Offers',
  request: 'Requests',
  event: 'Events',
  collab: 'Collabs',
  thanks: 'Thanks',
  intro: 'Intros',
};

/**
 * The chip row: "All", then one chip per postable bulletin type.
 *
 * The comp draws eight chips (`All / Offers / Requests / Events / Collabs / Thanks /
 * Intros / Note`). Only the types in `BULLETIN_TYPE` get a chip — the six postable
 * ones (#87) — and this row is deliberately *narrower than the grammar*: the server's
 * `type:` vocabulary also accepts `update` so that a filter for a type no person can
 * compose returns zero rows rather than an error, but offering that as a **chip**
 * advertises a filter whose only possible answer is an empty board. `note` is never a
 * value at all (decision D2).
 */
export const BOARD_FILTER_CHIPS: readonly BoardFilterChip[] = [
  { filter: 'all', label: 'All' },
  ...Object.values(BULLETIN_TYPE).map((type) => ({ filter: type, label: TYPE_CHIP_LABELS[type] })),
];

/**
 * Compile the chip and the typed text into `bulletins.board`'s `query`.
 *
 * The chip is sugar over the grammar's own `type:` term rather than a second filter
 * mechanism — exactly how the comp composes it (`fullQ = 'type:' + filter + ' ' +
 * query`). One filter, one place it is applied, and the server remains the only thing
 * that decides what a query means.
 *
 * @param filter - The selected chip.
 * @param search - Whatever the person typed, unedited.
 * @returns The query string, or `undefined` for the unfiltered board. `undefined`
 *   rather than `''`: an empty string is a query the server would parse, and the
 *   default board is the absence of one.
 */
export function buildBoardQuery(filter: BoardTypeFilter, search: string): string | undefined {
  const terms = [
    ...(filter === 'all' ? [] : [`type:${filter}`]),
    // Split-and-rejoin, not `trim()`: the server counts whitespace-separated terms
    // against a 16-term limit, so a double space here spends nothing but reads as two.
    ...search.split(/\s+/u).filter((term) => term.length > 0),
  ];

  return terms.length === 0 ? undefined : terms.join(' ');
}

/**
 * Is the board showing a filtered view rather than everything?
 *
 * The comp's `queryActive`: what gates the match count and the save affordance.
 */
export function isBoardQueryActive(filter: BoardTypeFilter, search: string): boolean {
  return buildBoardQuery(filter, search) !== undefined;
}

/** The comp's "{n} match" / "{n} matches" line. */
export function matchCountLabel(count: number): string {
  return `${String(count)} ${count === 1 ? 'match' : 'matches'}`;
}
