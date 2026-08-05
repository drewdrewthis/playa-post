declare const handleBrand: unique symbol;

/**
 * A handle that has passed every syntactic rule in {@link import('./handle.policy').validateHandle}.
 *
 * Branded for the same reason `ViewerId` is (ADR-0002 §5a): a `string` is not
 * assignable to it, so an unvalidated handle cannot reach
 * {@link import('./user.repository').NewUser} and be written. There is exactly one
 * constructor — `validateHandle` — and adding a second would make the brand
 * decorative.
 *
 * Reads are deliberately **not** branded: a handle already in `app.users` is a fact,
 * not a claim, and branding it would force a cast in the mapper, which is the escape
 * hatch that turns a brand back into a comment.
 */
export type Handle = string & { readonly [handleBrand]: 'Handle' };

/** ADR-0008:54 — `[a-z0-9_]{3,24}`, lower bound. */
export const HANDLE_MIN_LENGTH = 3;

/** ADR-0008:54 — `[a-z0-9_]{3,24}`, upper bound. */
export const HANDLE_MAX_LENGTH = 24;

/**
 * The permitted character class, without the length quantifier.
 *
 * Split from the length bounds on purpose: one combined `^[a-z0-9_]{3,24}$` cannot
 * say *which* rule a rejection broke, and M2-AC25 requires a structured code naming
 * the rule.
 */
export const HANDLE_CHARSET = /^[a-z0-9_]+$/;

/**
 * The stored, compared form of a submitted handle.
 *
 * Lowercasing here rather than in the charset check is load-bearing: ADR-0008:54
 * states the charset as lowercase-only, which read literally would reject
 * `DustStorm` as a charset violation and make the citext case-collision scenario
 * unreachable. Normalising first means mixed case is a *uniqueness* question
 * answered by the database, which is what the feature file describes.
 */
export function normalizeHandle(rawHandle: string): string {
  return rawHandle.trim().toLowerCase();
}

/**
 * Character substitutions that produce a look-alike handle (ADR-0008:56).
 *
 * The ADR names "a confusable-normalization check" without fixing an algorithm, so
 * this is the minimum that closes the impersonation route the ADR is worried about:
 * digits standing in for the letters they resemble. Extend it by adding entries —
 * every consumer derives from this table rather than restating it.
 *
 * ⚠ Every value must be exactly one character. The persistence adapter compiles this
 * table into a Postgres `translate()` call, which is character-for-character;
 * {@link confusableTranslationTable} fails loudly rather than letting the two
 * definitions of "confusable" silently diverge.
 */
export const CONFUSABLE_SUBSTITUTIONS: Readonly<Record<string, string>> = {
  '0': 'o',
  '1': 'l',
  '3': 'e',
  '5': 's',
  '7': 't',
};

/**
 * The comparison key two look-alike handles share.
 *
 * `m00nlight` and `moonlight` both reduce to `moonlight`, so a skeleton collision is
 * the confusable check. Normalises first, so case never reaches the substitution.
 */
export function confusableSkeleton(handle: string): string {
  return [...normalizeHandle(handle)]
    .map((character) => CONFUSABLE_SUBSTITUTIONS[character] ?? character)
    .join('');
}

/** The two arguments Postgres' `translate(string, from, to)` takes. */
export interface ConfusableTranslationTable {
  readonly from: string;
  readonly to: string;
}

/**
 * {@link CONFUSABLE_SUBSTITUTIONS} compiled for SQL.
 *
 * Exists so the repository can evaluate the skeleton in the database — over every
 * existing handle at once, rather than by loading them all — without a second copy
 * of the substitution table living in SQL and drifting from this one.
 *
 * @throws {Error} if any substitution is not a single character, which `translate()`
 *   cannot express. A silent divergence here is an impersonation route that reports
 *   green.
 */
export function confusableTranslationTable(): ConfusableTranslationTable {
  const from = Object.keys(CONFUSABLE_SUBSTITUTIONS);
  const to = Object.values(CONFUSABLE_SUBSTITUTIONS);

  const offending = from.find(
    (character, index) => character.length !== 1 || to[index]?.length !== 1,
  );
  if (offending !== undefined) {
    throw new Error(
      `CONFUSABLE_SUBSTITUTIONS['${offending}'] is not a single-character substitution, ` +
        'so Postgres translate() cannot express it. Keep both sides one character.',
    );
  }

  return { from: from.join(''), to: to.join('') };
}
