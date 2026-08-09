import { ApplicationError } from '../../../shared/errors/application-error';

/**
 * The shape version of a stored AST — ADR-0007:70-72's `ast_version`.
 *
 * It versions **this grammar's output shape**, never a row. A grammar change ships as a
 * new value here plus a migration that re-validates or re-parses stored queries; until
 * that migration runs, a query saved under an older version is simply not evaluated by
 * this grammar. That is the point: silently reinterpreting somebody's saved query
 * notifies them about the wrong things while they are not there to notice.
 *
 * **One constant, because there is one grammar.** `app.saved_views.ast_version` and
 * `app.notify_me_queries.ast_version` both mean "which shape of {@link BoardQuery} is in
 * the `ast` column", and ADR-0007's "Reuse" section is explicit that the two tables hold
 * the same AST. Two constants could drift, and a drift would be invisible: each table's
 * reader would keep filtering on its own number and quietly stop seeing the other's rows.
 *
 * ⚠ Bump this and you owe the migration — for **both** tables.
 */
export const BOARD_QUERY_AST_VERSION = 1;

/**
 * The board grammar's hard bounds (ADR-0007:35).
 *
 * Both are counted on the **source text**, before any interpretation, so a query that
 * is refused is refused for a reason the person who typed it can see. M2-AC13 asserts
 * both sides of each boundary.
 */
export const BOARD_QUERY_LIMITS = {
  /** Characters in the whole query string. 256 is accepted, 257 is not. */
  maxCharacters: 256,
  /** Whitespace-separated terms. 16 is accepted, 17 is not. */
  maxTerms: 16,
  /** Alternatives within one field — `type:offer|request` (ADR-0007:37). */
  maxValuesPerField: 6,
} as const;

/**
 * The `type:` field's domain — the seven PDF types (ADR-0007's grammar table).
 *
 * **`note` is absent and is not an omission**: decision D2 cuts private notes from the
 * product entirely, so `type:note` is not "unbuilt", it is *never* a value. That is
 * why it is refused rather than accepted-and-empty, and why this list is the grammar's
 * vocabulary rather than "whatever this milestone can create".
 *
 * Deliberately **not** shared with `modules/bulletins`' `BULLETIN_TYPE`, which names
 * what a person can *post* (six of these seven — `update` is the system's, #87). They
 * answer different questions: a filter for a type nothing has been written as yet must
 * return zero rows, not a validation error — an error would make the grammar an oracle
 * for what the product has shipped.
 */
export const BOARD_BULLETIN_TYPES = [
  'offer',
  'request',
  'event',
  'collab',
  'thanks',
  'intro',
  'update',
] as const;

/** One of {@link BOARD_BULLETIN_TYPES}. */
export type BoardBulletinType = (typeof BOARD_BULLETIN_TYPES)[number];

/**
 * A parsed board query — ADR-0007's "validated AST", restricted to what M2 ships.
 *
 * ⚠ **Every field here narrows, and the type can express nothing else.** There is no
 * `authorId`, no `viewerId`, no raw fragment, no boolean-OR across fields, and no
 * escape hatch carrying source text through to the compiler. That is what makes
 * ADR-0002 B10 ("a filter narrows but never widens") a property of the *shape* rather
 * than of the compiler's care: a term cannot reach a row the authorized set never
 * produced, because there is nowhere in this structure to put one.
 *
 * `types` and `text` are ANDed together, and `text` terms are ANDed with each other
 * (ADR-0007:35, "implicit AND"). Empty arrays mean "no narrowing on this axis".
 */
export interface BoardQuery {
  /** `type:` alternatives, ORed within the field. Empty means every type. */
  readonly types: readonly BoardBulletinType[];
  /** Bare words, ANDed. Matched against bulletin text only — never author names. */
  readonly text: readonly string[];
}

/** A query with no narrowing at all — the default board. */
export const EMPTY_BOARD_QUERY: BoardQuery = { types: [], text: [] };

/**
 * The board query was refused, and the message names the token that caused it.
 *
 * ADR-0007:53-56: unknown fields, unknown enum values, malformed syntax, over-length
 * input, or more than 16 terms are **rejected with a structured validation error
 * naming the offending token, never silently ignored**. Dropping an unparsed term
 * shows the user results they did not ask for, and in a saved Notify Me query it
 * notifies them about the wrong things while they are not there to notice.
 *
 * This is the one error in the grammar that is *allowed* to name what the caller sent:
 * the token came from them, so echoing it discloses nothing they did not already know
 * (contrast {@link import('../../bulletins/domain/bulletin.errors').BulletinGoneError},
 * which must stay silent about everything).
 */
export class InvalidBoardQueryError extends ApplicationError {
  static readonly code = 'INVALID_BOARD_QUERY';

  constructor(message: string) {
    super(InvalidBoardQueryError.code, message);
    this.name = 'InvalidBoardQueryError';
  }
}

/**
 * Parse board query text into a {@link BoardQuery}.
 *
 * **M2 implements two of ADR-0007's term shapes** — `type:<value>[|<value>…]` and a
 * bare word. `from:`, `tag:`, `loc:`, `deg:`, `trust:` and `is:` are M5, as are
 * negation (`-term`) and quoted phrases; each of them is *refused naming the token*
 * rather than reinterpreted, for the same reason unknown fields are. A `-hammock`
 * silently read as the literal word "-hammock" answers a question nobody asked, and
 * the person reading the results has no way to tell.
 *
 * @param source - Raw text as the person typed it. Empty or whitespace-only yields
 *   {@link EMPTY_BOARD_QUERY}, which is the default board rather than an error.
 * @returns The validated AST. Compiling it to SQL is
 *   `modules/bulletins/persistence/board-filter.ts`'s job — this layer never emits
 *   SQL, so a grammar change cannot become a query change by accident.
 * @throws {InvalidBoardQueryError} naming the offending token.
 */
export function parseBoardQuery(source: string): BoardQuery {
  if (source.length > BOARD_QUERY_LIMITS.maxCharacters) {
    throw new InvalidBoardQueryError(
      `A board query may be at most ${String(BOARD_QUERY_LIMITS.maxCharacters)} characters; this one is ${String(source.length)}.`,
    );
  }

  const terms = source.split(/\s+/u).filter((term) => term.length > 0);

  if (terms.length > BOARD_QUERY_LIMITS.maxTerms) {
    throw new InvalidBoardQueryError(
      `A board query may have at most ${String(BOARD_QUERY_LIMITS.maxTerms)} terms; this one has ${String(terms.length)}.`,
    );
  }

  const types: BoardBulletinType[] = [];
  const text: string[] = [];

  for (const term of terms) {
    if (term.startsWith('-')) {
      throw new InvalidBoardQueryError(
        `Negating a term is not supported yet, so "${term}" cannot be applied.`,
      );
    }
    if (term.includes('"')) {
      throw new InvalidBoardQueryError(
        `Quoted phrases are not supported yet, so "${term}" cannot be applied.`,
      );
    }

    const separator = term.indexOf(':');
    if (separator === -1) {
      text.push(term);
      continue;
    }

    const field = term.slice(0, separator);
    if (field !== 'type') {
      throw new InvalidBoardQueryError(`Unknown field "${field}" in "${term}".`);
    }

    types.push(...parseTypeValues(term.slice(separator + 1), term));
  }

  return { types, text };
}

/**
 * Validate one `type:` term's values against {@link BOARD_BULLETIN_TYPES}.
 *
 * @param values - Everything after the colon, `|`-separated (ADR-0007:37).
 * @param term - The whole term, so the error can quote what was actually typed.
 */
function parseTypeValues(values: string, term: string): readonly BoardBulletinType[] {
  const candidates = values.split('|');

  if (candidates.length > BOARD_QUERY_LIMITS.maxValuesPerField) {
    throw new InvalidBoardQueryError(
      `A field may take at most ${String(BOARD_QUERY_LIMITS.maxValuesPerField)} alternatives; "${term}" has ${String(candidates.length)}.`,
    );
  }

  return candidates.map((candidate) => {
    if (!isBoardBulletinType(candidate)) {
      // The token is quoted twice on purpose — the offending value and the term it
      // came from. `type:offer|note` has to name `note`, not the whole term, or the
      // person editing it cannot tell which alternative was refused.
      throw new InvalidBoardQueryError(`Unknown bulletin type "${candidate}" in "${term}".`);
    }
    return candidate;
  });
}

function isBoardBulletinType(candidate: string): candidate is BoardBulletinType {
  return (BOARD_BULLETIN_TYPES as readonly string[]).includes(candidate);
}
