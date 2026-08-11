import { BULLETIN_TYPE, type BulletinType } from '@playa-post/contracts';

/**
 * The board's search state, compiled into the one query string the server parses.
 *
 * **There is no client-side grammar here, and there must never be one.** The board
 * query language is compiled server-side by `parseBoardQuery`, which refuses an
 * unimplemented token *naming it* rather than ignoring it (ADR-0007:53-56). The client
 * may *read* a query to reflect its own UI state — which chip is selected, what is left
 * in the search box — but must never rewrite, drop, or locally evaluate a term the
 * server would interpret differently. A client that did would show a person results
 * they did not ask for and give them no way to tell.
 *
 * `parseBoardQueryState` reads a `type:` term out into `filter`, and `buildBoardQuery`
 * puts it back — the round trip is lossless, so nothing the server ever sees changes
 * meaning; only where the term is *displayed* (chip vs. search box) changes.
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
 * Every value carried by this query's `type:` terms, flattened.
 *
 * A query can carry the field more than once (`type:offer type:request`) or use the
 * grammar's own pipe alternation within one term (`type:offer|request`) — the server's
 * `parseBoardQuery` concatenates both shapes into one values array (ADR-0007's `values`
 * production), and this mirrors that so a value this function misses is a value the
 * server would have kept.
 */
function queryTypeValues(query: string): readonly string[] {
  const values: string[] = [];

  for (const term of query.split(/\s+/u)) {
    if (!term.startsWith('type:')) {
      continue;
    }

    values.push(...term.slice('type:'.length).split('|'));
  }

  return values;
}

/** Narrows to a chip-backed type — the six {@link BULLETIN_TYPE} values, not the grammar's seven. */
function isBulletinType(value: string): value is BulletinType {
  return (Object.values(BULLETIN_TYPE) as readonly string[]).includes(value);
}

/** `parseBoardQueryState`'s result: the chip a query selects, paired with the rest of it. */
export interface BoardQueryState {
  readonly filter: BoardTypeFilter;
  readonly search: string;
}

/**
 * Recover both the chip a query's `type:` term selects and the search text that chip
 * does not already cover — `buildBoardQuery`'s inverse, as one pass over the query
 * rather than two independent ones.
 *
 * Opening a saved view navigates straight to `/board?q=<source text>` (#173); this is
 * what lets the board's chip row show the term the saved text already carries instead of
 * resetting to "All" underneath it. Deriving `filter` and `search` from two separate
 * calls — the whole query text for one, a parse of the same text for the other — let a
 * saved `type:` term end up in both: once as the chip, once still sitting in the search
 * box for `buildBoardQuery` to add a second time. Reading them together here is what
 * keeps that impossible rather than merely untested.
 *
 * Degrades to `'all'` — with `search` left **exactly as the query read it, `type:` term
 * and all** — whenever the query does not name exactly one chip-backed type: no `type:`
 * term at all, `type:update` (a real server value with no chip — see
 * {@link BOARD_FILTER_CHIPS}), an unrecognised value, or more than one value from either
 * an OR'ed term or a repeated field. Every one of those is a term this milestone's chip
 * row cannot represent, so it stays in the search box rather than being silently
 * dropped — a person who typed it still sees it, and the server still receives it
 * unchanged. That last multi-value case is unreachable from today's client — it can
 * only ever *write* one type — but the server grammar already allows several, and #171
 * turns this into the multi-select chip row; this function already tells the cases
 * apart, so that work is a change to the `'all'` branch, not a rewrite of the parsing.
 *
 * @param query - A `?q=` value, exactly as the URL carries it.
 * @returns The one chip it selects (or `'all'`), and the search text alongside it.
 */
export function parseBoardQueryState(query: string): BoardQueryState {
  const values = queryTypeValues(query);
  const [value] = values;
  const filter = values.length === 1 && value !== undefined && isBulletinType(value) ? value : 'all';

  if (filter === 'all') {
    return { filter, search: query };
  }

  const search = query
    .split(/\s+/u)
    .filter((term) => term.length > 0 && !term.startsWith('type:'))
    .join(' ');

  return { filter, search };
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
