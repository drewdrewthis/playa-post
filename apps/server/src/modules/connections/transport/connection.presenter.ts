import type { ConnectionView } from '../application/get-connection.query';

/**
 * A connection as this API renders one, **for one of its two parties**.
 *
 * ⚠ Not a general connection projection. `trust` here is the *reader's own*
 * directional value, and it is only correct to serialize because the query that
 * produced it was keyed on the reader as owner. A second caller wanting to render
 * somebody else's connection has no version of this: ADR-0002 B6 and M2-AC3 require a
 * trust value and its field name to be absent from every payload reachable by the
 * other party or a third party, at any nesting depth.
 *
 * `trust: null` means unset, and unset is not `0` (M2-AC4). JSON has no third
 * spelling, so the distinction lives in the two values themselves — which is why the
 * column is nullable with no default and why acceptance writes no trust row at all.
 */
export interface PresentedConnection {
  readonly status: string;
  readonly trust: number | null;
}

/** Project a connection for the party reading it. */
export function presentConnection(view: ConnectionView): PresentedConnection {
  return { status: view.status, trust: view.trust };
}
