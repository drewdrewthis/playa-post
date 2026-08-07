/**
 * How much of a person this viewer is allowed to see (ADR-0002 §6a).
 *
 * `full` carries a name, handle, and avatar; `topology_only` carries none of them —
 * and the payload **omits** those keys rather than sending `null`, which is why the
 * fields below are optional rather than nullable.
 */
export const PERSON_DISCLOSURE = {
  full: 'full',
  topologyOnly: 'topology_only',
} as const;

/** One of {@link PERSON_DISCLOSURE}'s values. */
export type PersonDisclosure = (typeof PERSON_DISCLOSURE)[keyof typeof PERSON_DISCLOSURE];

/**
 * One person on the viewer's graph.
 *
 * ⚠ `disclosure` is `string`, not {@link PersonDisclosure}: the column carries no check
 * constraint, so the server widens it deliberately and a narrower client type would be
 * a lie the compiler cannot catch. Compare against {@link PERSON_DISCLOSURE} and treat
 * an unrecognised value as *less* disclosure, never more.
 *
 * ⚠ **An absent `displayName`/`handle`/`avatarUrl` must render as no name at all** —
 * not initials, not a truncated `userId`, not "Unknown". Any placeholder derived from
 * the id re-identifies the person the projection just hid.
 */
export interface Person {
  readonly userId: string;
  readonly degree: number;
  readonly disclosure: string;
  readonly displayName?: string;
  readonly handle?: string;
  readonly avatarUrl?: string;
  /** The viewer's own directional trust. `null` is unset; `0` is a deliberate zero. */
  readonly trust: number | null;
}

/** `graph.list` output. One graph per viewer — no depth or pagination parameters. */
export interface Graph {
  readonly people: readonly Person[];
}
