import type { VisibleEdge } from './visible-edge';

/**
 * The disclosure levels `app.visible_people` computes.
 *
 * Computed in SQL from the target's own settings, never in a client and never from the
 * viewer's wishes (ADR-0004 decision 3). Distinct from the stored *setting* on
 * `app.connections` — `full` | `limited` — which is what a person chose; this is what
 * one specific viewer is allowed to see because of it.
 *
 * Exported alongside {@link VisiblePerson} so a consumer branching on disclosure
 * compares against this rather than re-spelling the literal — three lanes each writing
 * `=== 'full'` is three places for a typo to read as "not fully disclosed", which
 * fails safe, or for a new level to be missed, which does not.
 */
export const PERSON_DISCLOSURE = {
  /** Name, handle and avatar may be shown. */
  full: 'full',
  /** The person exists in the viewer's network and carries no identifying field. */
  topologyOnly: 'topology_only',
} as const;

/** One of {@link PERSON_DISCLOSURE}'s values. */
export type PersonDisclosure = (typeof PERSON_DISCLOSURE)[keyof typeof PERSON_DISCLOSURE];

/**
 * One person, already projected through `app.visible_people`'s disclosure level.
 *
 * **This is lane-brief C8's exported read model, and it is a DTO rather than a domain
 * entity on purpose** (ratified decision (c)): addendum §19 forbids importing another
 * module's domain entity, so exporting one would make every consumer a boundary
 * violation and defeat the point of having one projection. The signature is
 * deliberately **not frozen** — the first consuming lane is explicitly allowed to
 * change it rather than work around a bad fit.
 *
 * ⚠ The identity fields are **optional, and absent rather than null**, below `full`
 * disclosure. That is ADR-0002 §6a at the type level: a consumer cannot render a name
 * it was not given, and `undefined` is harder to accidentally serialize into a payload
 * than a `null` that looks like a value the UI should hide. The projection happens in
 * SQL — the columns are never selected for a `topology_only` person — so nothing above
 * the database can forget to strip them ("hidden information must never be sent to the
 * client merely to be concealed by the UI", ADR-0004).
 *
 * Every other module that needs to render a person consumes this. **A payload that
 * builds a person card by joining `app.users` directly is the bug** §6a names, and
 * `tests/fitness/sql-table-ownership.fitness.test.ts` is what catches it at the SQL
 * layer where no import edge exists to see.
 */
export interface VisiblePerson {
  /** `app.users.id`. Safe as output: a caller *supplying* one is the hazard (§5a). */
  readonly userId: string;
  /** Hops from the viewer. `0` is the viewer; M2 returns nothing beyond `1`. */
  readonly degree: number;
  /** One of {@link PERSON_DISCLOSURE}. */
  readonly disclosure: string;
  /** Present only at `full` disclosure. */
  readonly displayName?: string;
  /** Present only at `full` disclosure. */
  readonly handle?: string;
  /**
   * Present only at `full` disclosure, and never in M2.
   *
   * `app.users.avatar_path` is a private bucket key, not a URL; minting a signed URL
   * has to pass through this same disclosure predicate (ADR-0002 §12/§16) and the
   * module that mints one is not built in this milestone. The field is declared
   * because a consumer must not go looking for an avatar anywhere else — the
   * §6a-projected person is the only place one may ever come from.
   */
  readonly avatarUrl?: string;
  /**
   * The **viewer's own** trust toward this person, or `null` when unset.
   *
   * ADR-0004 decision 6: edges incident to the viewer carry the viewer's own trust;
   * edges between two other people carry no weight at all. There is no shape here that
   * could hold somebody else's value, because `app.visible_people` joins the trust
   * table on `owner_id = viewer_id` and nothing else (ADR-0002 B6).
   */
  readonly trust: number | null;
}

/**
 * The viewer's visible network: the nodes, and the lines between them.
 *
 * A wrapper rather than a bare array because M5 adds `truncated` and its reason
 * (ADR-0004 decision 2: when `max_depth` or `node_budget` binds, the boundary is
 * stated, never silent), and widening an array into an object later is a change at
 * every call site. `edges` is the first thing that wrapper earned.
 *
 * ⚠ **One snapshot, one read.** People and edges are answered together rather than by
 * two procedures, because a client that fetched them separately could hold an edge whose
 * endpoint is not in the person list it already has — a line to nowhere, appearing only
 * under a connection change between the two calls, and only on somebody else's device.
 */
export interface VisibleGraph {
  /** Always includes the viewer, at degree 0. */
  readonly people: readonly VisiblePerson[];
  /**
   * Accepted connections between two people in {@link people}.
   *
   * Includes the viewer's own edges. Never introduces an identifier absent from
   * {@link people} — see {@link import('./visible-edge').VisibleEdge}.
   */
  readonly edges: readonly VisibleEdge[];
}
