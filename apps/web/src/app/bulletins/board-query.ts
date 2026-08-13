import { BULLETIN_TYPE, type BulletinType } from '@playa-post/contracts';

/**
 * The board's search state, compiled into the one query string the server parses.
 *
 * **There is no client-side grammar here, and there must never be one.** The board
 * query language is compiled server-side by `parseBoardQuery`, which refuses an
 * unimplemented token *naming it* rather than ignoring it (ADR-0007:53-56). The client
 * may *read* a query to reflect its own UI state — which chips are selected, what is left
 * in the search box — but must never rewrite, drop, or locally evaluate a term the
 * server would interpret differently. A client that did would show a person results
 * they did not ask for and give them no way to tell.
 *
 * `parseBoardQueryState` reads the `type:` term(s) out into `filter`, and
 * `buildBoardQuery` puts them back — lossless in meaning: the rebuilt query re-parses to
 * the same state; term order and spacing may normalise.
 */

/** The chip row's selection: zero or more types. Empty means no type restriction. */
export type BoardTypeFilter = readonly BulletinType[];

/** One chip in the board's filter row. */
export interface BoardFilterChip {
  readonly filter: 'all' | BulletinType;
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
 * `types`, deduplicated and ordered to match {@link BULLETIN_TYPE}'s own declaration
 * order — `buildBoardQuery`'s canonical `type:` value order, so which order chips were
 * clicked in never changes the compiled query.
 */
function canonicalTypeOrder(types: BoardTypeFilter): readonly BulletinType[] {
  const selected = new Set(types);
  return Object.values(BULLETIN_TYPE).filter((type) => selected.has(type));
}

/**
 * Compile the selected chips and the typed text into `bulletins.board`'s `query`.
 *
 * Chips are sugar over the grammar's own `type:` term rather than a second filter
 * mechanism: more than one selected type becomes one `type:` term, OR'ed
 * (`type:a|b`) — ADR-0007's own alternation production, not a client invention. One
 * filter, one place it is applied, and the server remains the only thing that decides
 * what a query means.
 *
 * @param filter - The selected chips, in any order — canonicalised before compiling, so
 *   selection order never changes the query.
 * @param search - Whatever the person typed, unedited.
 * @returns The query string, or `undefined` for the unfiltered board. `undefined`
 *   rather than `''`: an empty string is a query the server would parse, and the
 *   default board is the absence of one.
 */
export function buildBoardQuery(filter: BoardTypeFilter, search: string): string | undefined {
  const types = canonicalTypeOrder(filter);

  const terms = [
    ...(types.length === 0 ? [] : [`type:${types.join('|')}`]),
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

/**
 * `values`, narrowed to {@link BulletinType}s when every one is chip-backed and there is
 * at least one; `null` when any value has no chip (including no values at all).
 */
function recognizedTypes(values: readonly string[]): readonly BulletinType[] | null {
  return values.length > 0 && values.every(isBulletinType) ? values : null;
}

/** `parseBoardQueryState`'s result: the chips a query selects, paired with the rest of it. */
export interface BoardQueryState {
  readonly filter: BoardTypeFilter;
  readonly search: string;
}

/**
 * Recover the chips a query's `type:` term(s) select and the search text they do not
 * already cover — `buildBoardQuery`'s inverse. `filter` and `search` come from this one
 * function together, deliberately: deriving them from two separate reads of the same
 * query text is how a stored `type:` term once ended up counted twice — recovered as a
 * chip by one read, left sitting in the search box by the other, for `buildBoardQuery`
 * to add back a second time.
 *
 * Populates `filter` with every value from a query's `type:` term(s) once every one of
 * them is a chip-backed type: an OR'ed term (`type:offer|request`) and the field
 * repeated (`type:offer type:request`) populate the same chips, because
 * `parseBoardQuery` gives them the same AST — `queryTypeValues` flattens both shapes the
 * same way, mirroring ADR-0007's `values` production. Every matched `type:` term is then
 * stripped from `search`.
 *
 * Degrades to `filter: []` — with `search` left **exactly as the query read it, every
 * `type:` term and all** — whenever any value the query names is not a chip-backed type:
 * `type:update` (a real server value with no chip — see {@link BOARD_FILTER_CHIPS}), an
 * unrecognised value, or a mix of recognised and unrecognised values in the same query.
 * That value is a term this chip row cannot represent, so it stays in the search box
 * rather than being silently dropped — a person who typed it still sees it, and the
 * server still receives it unchanged.
 *
 * @param query - A `?q=` value, exactly as the URL carries it.
 * @returns The chips it selects (`[]` for none), and the search text alongside them.
 */
export function parseBoardQueryState(query: string): BoardQueryState {
  const types = recognizedTypes(queryTypeValues(query));

  if (types === null) {
    return { filter: [], search: query };
  }

  const search = query
    .split(/\s+/u)
    .filter((term) => term.length > 0 && !term.startsWith('type:'))
    .join(' ');

  return { filter: canonicalTypeOrder(types), search };
}

/**
 * One chip's next selection state after being clicked.
 *
 * `'all'` always clears every type — it is not itself a member of `filter` to toggle —
 * and a type toggles its own membership, independent of every other selected type.
 */
export function toggleBoardType(filter: BoardTypeFilter, clicked: 'all' | BulletinType): BoardTypeFilter {
  if (clicked === 'all') {
    return [];
  }

  return filter.includes(clicked) ? filter.filter((type) => type !== clicked) : [...filter, clicked];
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
