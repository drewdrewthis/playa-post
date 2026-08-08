import type { Person } from '@playa-post/contracts';

/**
 * What a node on the graph is allowed to say about the person it stands for.
 *
 * The comp draws a letter inside every dot and a name under the big ones. That is safe
 * in a prototype where every person is invented; here it is the exact spot where §6a
 * can leak, so the rule lives in one tested place instead of inside a JSX expression.
 */

/** The identity fields §6a either discloses in full or withholds entirely. */
export type GraphNodeIdentity = Pick<Person, 'displayName' | 'handle'>;

/** The first of these values that carries something a person could read. */
function firstLegible(...values: readonly (string | undefined)[]): string | undefined {
  for (const value of values) {
    const trimmed = value?.trim();

    if (trimmed !== undefined && trimmed !== '') {
      return trimmed;
    }
  }

  return undefined;
}

/**
 * The letter drawn inside a node's dot, or **nothing at all**.
 *
 * ⚠ **There is no fallback, deliberately** — the same rule `PersonIdentity` states for a
 * list row, restated for a dot. A person the projection withheld gets an empty dot: not
 * a `?`, not a letter taken from their `userId`, not a shape derived from anything the
 * payload happens to still contain. An initial is one character of a name, and one
 * character of a name is a name the server just decided this viewer may not have.
 *
 * Read by code point rather than by UTF-16 unit, so a name that begins with an emoji or
 * an astral character keeps its first *character* instead of half a surrogate pair.
 */
export function nodeInitial(identity: GraphNodeIdentity): string | undefined {
  const name = firstLegible(identity.displayName, identity.handle);

  if (name === undefined) {
    return undefined;
  }

  return [...name][0]?.toUpperCase();
}

/**
 * The name written under a node, or `undefined` when there is none to write.
 *
 * The handle, at-prefixed, stands in for a missing display name: both are disclosed
 * together, so a person with one and not the other has a name the viewer may see.
 */
export function nodeLabel(identity: GraphNodeIdentity): string | undefined {
  const displayName = firstLegible(identity.displayName);

  if (displayName !== undefined) {
    return displayName;
  }

  const handle = firstLegible(identity.handle);

  return handle === undefined ? undefined : `@${handle}`;
}
