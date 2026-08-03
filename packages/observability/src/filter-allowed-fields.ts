/**
 * A JSON-serializable value as it appears in a log field or span attribute
 * before redaction. Deliberately loose — callers pass whatever they were
 * about to log, and this module's whole job is to decide what survives.
 */
export type FieldValue = unknown;

function isPlainObject(value: unknown): value is Record<string, FieldValue> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    !(value instanceof Date) &&
    !(value instanceof RegExp)
  );
}

function filterValue(value: FieldValue, allowedKeys: ReadonlySet<string>): FieldValue {
  if (Array.isArray(value)) {
    return value.map((entry) => filterValue(entry, allowedKeys));
  }
  if (isPlainObject(value)) {
    return filterAllowedFields(value, allowedKeys);
  }
  return value;
}

/**
 * Default-deny field filter: keep only keys named in `allowedKeys`, at every
 * nesting depth, and drop everything else.
 *
 * This is the allowlist redaction primitive behind both the structured
 * logger (`createLogger`) and the OpenTelemetry span redaction
 * (`createRedactingSpanProcessor`) — one definition of "what is safe to
 * emit", used by both surfaces, per ADR-0002 Q3 and addendum §25 ("no
 * bulletin content or private contact information in routine logs").
 *
 * An allowlist rather than a denylist is deliberate: a field nobody thought
 * to redact is invisible by default, not exposed by default. The cost is
 * that a genuinely new, safe field must be added to the allowlist before it
 * appears in output — a false negative the caller can see immediately in a
 * missing log field, rather than a false positive nobody notices until a
 * bulletin body reaches stdout.
 *
 * Filtering is by **key name**, not by path: a key called `body` is dropped
 * everywhere it appears, and a key called `userId` is kept everywhere it
 * appears, regardless of nesting. Callers must not reuse an allowlisted
 * field's name for a different, sensitive purpose.
 *
 * @param fields - The object about to be logged or attached to a span.
 * @param allowedKeys - The exact key names permitted to survive.
 * @returns A new object containing only the allowlisted keys, filtered
 *   recursively into any nested plain objects and arrays. `fields` is never
 *   mutated.
 */
export function filterAllowedFields(
  fields: Readonly<Record<string, FieldValue>>,
  allowedKeys: ReadonlySet<string>,
): Record<string, FieldValue> {
  // Object.fromEntries defines each key as an own data property, so a literal
  // "__proto__" key stays data instead of silently rewriting the prototype.
  return Object.fromEntries(
    Object.entries(fields)
      .filter(([key]) => allowedKeys.has(key))
      .map(([key, value]) => [key, filterValue(value, allowedKeys)]),
  );
}
