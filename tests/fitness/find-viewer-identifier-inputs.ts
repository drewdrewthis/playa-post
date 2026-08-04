/**
 * The B14 / M2-AC20 walker: does any procedure accept an identifier the caller has no
 * business asserting?
 *
 * ADR-0002 §5a names the catastrophic bug in this architecture, and it is not a
 * missing `WHERE`. It is one Zod schema with `viewerId: z.string().uuid()`, which is
 * total, silent, trivially exploitable impersonation of every user in the system.
 * Ownership is **derived** from the authenticated actor, never asserted by the caller.
 *
 * **Not a grep** (M2-AC20 is explicit). This walks the built router — the same object
 * the server actually serves — so a field introduced through a shared schema, a
 * `.extend()`, a spread, or an import from another file is still found. A text search
 * would miss every one of those and report green.
 *
 * Built now, at one procedure wide, on the lane brief's instruction: retrofitting it
 * across nine modules once they exist is the expensive order, and the walker is worth
 * far less if it first runs on a tree that already has to be cleaned up to pass.
 */

/** Field names a procedure input must never carry (ADR-0002:180-181). */
export const FORBIDDEN_INPUT_FIELDS: readonly string[] = [
  'viewerId',
  'userId',
  'actorId',
  'ownerId',
];

/** One violation: the procedure that declared it and the field it declared. */
export interface ForbiddenInputField {
  /** Dotted procedure path, e.g. `bulletins.listVisible`. */
  readonly procedure: string;
  readonly field: string;
}

/**
 * The shape this walker needs from a tRPC router.
 *
 * Structural rather than `AnyRouter` so `tests/` needs no dependency on
 * `@trpc/server` — and so the walker keeps working if the router type changes shape
 * in a way that does not change the data.
 */
export interface WalkableRouter {
  readonly _def: { readonly procedures: Readonly<Record<string, unknown>> };
}

/** Depth ceiling for the schema walk. Generous; real input schemas nest two or three deep. */
const MAX_WALK_DEPTH = 24;

function isRecord(value: unknown): value is Record<string, unknown> {
  // Functions count: a tRPC v11 procedure is a *callable* carrying `_def` as a
  // property, so excluding functions makes every procedure invisible to the walk.
  return (typeof value === 'object' || typeof value === 'function') && value !== null;
}

/**
 * Read a property without letting a throwing getter abort the walk.
 *
 * Validation libraries use getters freely — `ZodObject.shape` is one, and it lives on
 * the prototype rather than being an own key, which is why the walk reads it by name
 * instead of relying on `Object.keys`. A getter that throws on an unusual schema must
 * not silently truncate a security control: it yields `undefined` here and the walk
 * continues through the object's other edges.
 *
 * Deliberately does **not** invoke functions it finds. Calling arbitrary methods
 * while crawling someone else's object graph is how a read-only inspection acquires
 * side effects.
 */
function readProperty(node: Record<string, unknown>, key: string): unknown {
  try {
    return node[key];
  } catch {
    return undefined;
  }
}

/**
 * A node's declared object shape, whether it is exposed as a value or as a thunk.
 *
 * The thunk form is the one older schema builders use for `_def.shape`; the value
 * form is the modern getter. Both are just "the record of fields this object
 * declares", and only this one call site is allowed to invoke anything.
 */
function readShape(node: Record<string, unknown>): unknown {
  const shape = readProperty(node, 'shape');
  if (typeof shape !== 'function') {
    return shape;
  }

  try {
    return (shape as () => unknown).call(node);
  } catch {
    return undefined;
  }
}

/**
 * Every property name reachable inside a validation schema, at any nesting depth.
 *
 * Deliberately **structural and over-inclusive**: it looks for anything shaped like a
 * `shape` record anywhere in the schema's object graph and harvests its keys, rather
 * than modelling one validation library's class hierarchy. Optionals, arrays, unions,
 * intersections, records, pipes, lazies and `.extend()`ed objects are all just more
 * graph, so none of them needs a case here — and none of them can hide a field by
 * being a shape this file had not heard of when it was written.
 *
 * Over-inclusion is the safe direction for a control like this: a false positive is a
 * loud failure someone fixes in a minute, while a false negative is R14.
 */
function collectSchemaFieldNames(
  node: unknown,
  visited: Set<object>,
  found: Set<string>,
  depth: number,
): void {
  if (depth > MAX_WALK_DEPTH || !isRecord(node) || visited.has(node)) {
    return;
  }
  visited.add(node);

  const shape = readShape(node);
  if (isRecord(shape) && !Array.isArray(shape)) {
    for (const key of Object.keys(shape)) {
      found.add(key);
    }
  }

  // `Object.keys` + `readProperty`, never `Object.values`: the latter evaluates every
  // getter eagerly, so one throwing getter anywhere in the graph would abort the walk
  // and this control would report "no violations" for the wrong reason.
  for (const key of Object.keys(node)) {
    collectSchemaFieldNames(readProperty(node, key), visited, found, depth + 1);
  }
}

/**
 * The field names one procedure's **input** schemas accept.
 *
 * Inputs only, never outputs: a presenter legitimately *returns* a `userId`, and
 * flagging that would train everyone to add exceptions until the rule means nothing.
 * What must never happen is a caller *supplying* one.
 *
 * @param procedure - A built tRPC procedure.
 */
export function inputFieldNames(procedure: unknown): ReadonlySet<string> {
  const found = new Set<string>();

  if (!isRecord(procedure) || !isRecord(procedure['_def'])) {
    return found;
  }

  const inputs = (procedure['_def'] as Record<string, unknown>)['inputs'];
  for (const input of Array.isArray(inputs) ? inputs : []) {
    collectSchemaFieldNames(input, new Set<object>(), found, 0);
  }

  return found;
}

/** Dotted paths of every procedure the router serves. */
export function procedurePaths(router: WalkableRouter): readonly string[] {
  return Object.keys(router._def.procedures);
}

/**
 * Every `(procedure, field)` pair violating ADR-0002 §5a, across the whole router.
 *
 * @returns an empty array when the router is clean. A non-empty result names the
 *   procedure and the field, because "something somewhere carries a viewerId" is not
 *   an actionable failure message.
 */
export function findForbiddenIdentifierInputs(
  router: WalkableRouter,
): readonly ForbiddenInputField[] {
  const violations: ForbiddenInputField[] = [];

  for (const [path, procedure] of Object.entries(router._def.procedures)) {
    const fields = inputFieldNames(procedure);
    for (const field of FORBIDDEN_INPUT_FIELDS) {
      if (fields.has(field)) {
        violations.push({ procedure: path, field });
      }
    }
  }

  return violations;
}
