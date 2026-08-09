# ADR-0004 — Graph traversal and visibility queries

- **Status:** proposed
- **Date:** 2026-07-30
- **Drivers:** PDF §4 "Graph home", §8 "Database and querying"; addendum §7, §9, §15, §21

## Context

The graph is the primary experience. Constraints from the PDF:

- *"The graph represents the full visible network the viewer is authorized to traverse. The product
  model should not impose an arbitrary depth cap."*
- *"Performance may use caching, projections, incremental loading, clustering, or layout optimization,
  provided behavior remains conceptually complete."*
- *"People visible only as topology may appear as Private nodes. Hidden information must never be sent
  to the client merely to be concealed by the UI."*
- Trust is private and directional; a block removes routing entirely.

The prototype renders degree 0–3 with `hidden: true` "ghost" nodes and per-edge weights derived from
trust. The prototype derives weight for *every* edge, including edges between two other people — that
would require exposing third parties' private trust values. It is product evidence, not a spec.

## Decision

**Recursive CTEs in checked-in `SECURITY INVOKER` SQL functions, producing a per-viewer read model.
No projections, no cache, no graph database in v1.**

1. **`app.visible_people(viewer_id uuid, max_depth int, node_budget int)`** — a recursive CTE over
   accepted connections, seeded at `viewer_id`, that:
   - prunes any edge incident to a block in either direction **inside the recursive term**, so blocked
     people are not merely filtered from the result — they are not traversable, and no path routes
     through them;
   - prunes deactivated and erased users;
   - returns, per person: `degree`, `path_via` (the first-hop connector's **name** only when that
     intermediary is at `full` disclosure for this viewer; otherwise the field carries the intermediary's
     ghost surrogate ID, never a name), `mutual_count` (returned **only** for `full`-disclosure people —
     a `topology_only` node carries no `mutual_count`, since polled over time it leaks the existence and
     timing of connections the viewer cannot see), and a `disclosure` level of `full` | `topology_only`.
2. **No product depth cap.** `max_depth` is an *operational safety bound* (default 4, configurable) and
   `node_budget` a row cap (default 1500). When either binds, the read model returns
   `truncated: true` with the reason, and the client shows an explicit "more of your network beyond
   here" affordance — a stated boundary, never a silent one. These knobs are ops levers, not product rules.
3. **Disclosure is computed in SQL, not in the client.** A person is `full` when the viewer is
   authorized to see identity (per the target's own visibility settings — the prototype's
   "name visible to: anyone / trust 50+ / trust 75+" and degree limits), otherwise `topology_only`.
4. **Topology-only nodes carry a per-viewer surrogate ID, never the internal user ID.**
   `ghost_id = encode(hmac(viewer_id || person_id, :graph_surrogate_key), 'base64url')` truncated to
   16 bytes. Rationale: a real ID on a hidden node lets a client correlate the ghost with a person it can
   see elsewhere (a shared bulletin author, a second-degree connector), which reconstructs exactly the
   identity the disclosure rule withheld. Surrogates are stable for one viewer (so layout is stable
   across reloads) and useless across viewers. Ghost nodes carry **no** name, handle, avatar, role, or
   mutual count — only their depth from the viewer (1st/2nd/3rd) and the restricted adjacency of
   decision 5. ("Depth" here is distance from the viewer; it is not a count of the ghost's connections,
   which decision 5 withholds.)

   > **Accepted deviation as of PR #78 (2026-08-09):** ghost surrogate IDs are not yet
   > implemented — `topology_only` rows returned by `app.visible_people` carry the real
   > `app.users.id`, so a client holding two views of the network can correlate a hidden
   > person against a named one. The product owner was shown this trade and accepted it
   > explicitly for alpha in order to ship multi-hop visibility now. What *is* enforced
   > is `visible_to_distance` (each person's own "who can see you" radius, ceiling
   > `sixth` per the six-degrees principle): past that distance a person is **absent
   > from the result entirely** — no row, not an unnamed node — which is the weaker half
   > of this decision doing the work the surrogate would otherwise do. The deviation is
   > also recorded in migration `20260810090000_visibility_ceiling_sixth.sql` and in
   > `modules/graph/persistence/sql/visible-people.sql`'s header. Implementing the
   > surrogate closes this deviation; nothing else in this decision changes.

5. **Ghost adjacency is restricted to fully-visible neighbours; topology-only nodes carry no counts.**
   The surrogate ID (decision 4) makes a hidden person non-correlatable *across* viewers; it does nothing
   about re-identification *within* one viewer's own view — a ghost adjacent to exactly {Moss, Juniper,
   Kestrel}, three people the viewer already sees at `full` disclosure, is uniquely determined by
   structure alone to anyone with ordinary social knowledge of that network. Decided, privacy-
   conservatively: a topology-only node's returned adjacency is restricted to edges incident to people
   the viewer can already see at `full` disclosure, and the node exposes **no** `mutual_count` and no
   degree-of-connection count. This keeps the ghost meaningful as topology ("your network continues
   here") while removing the neighbour-set fingerprint that identifies them. Residual, stated honestly:
   a ghost adjacent to three or more fully-visible people is still narrowable by a viewer with ordinary
   social knowledge of the group. Accepted as a bounded residual, not eliminated, and escalated to the
   product owner (cross-reference: escalation E4, `docs/engineering/implementation-plan.md`).
6. **Trust never leaves its owner.** Edges incident to the viewer carry the viewer's own trust value
   (0–100, plus a distinct `unset`). Edges between two other people carry **no** weight — they render at
   uniform width. *(This is a visible deviation from the prototype; see Escalations in the
   implementation plan.)* `unset` is a first-class value distinct from `0` (PDF §4) and must be modelled
   as `NULL` with a `NOT NULL`-free column, never defaulted to zero.
7. **Read model, not domain entities** (§7). The graph query returns a purpose-built projection; no
   aggregate reconstruction. It lives in `modules/graph/persistence/sql/visible-people.sql` +
   `ListVisibleGraphQuery`.
8. **Bulletin visibility uses the same authorized-people CTE**, composed as a subquery — one definition
   of "who can this viewer reach", used by graph, board, search, Notify Me, and intro eligibility
   (ADR-0002 §6).
9. **Incremental loading before caching.** If the graph read exceeds budget, first response is degree
   ≤ 2; further degrees load on pan/zoom demand. Only if measured p95 still exceeds the budget do we add
   a materialized per-viewer projection — and that will need its own ADR because it introduces staleness
   into a privacy-critical read.

**Performance budget (the trigger for step 9):** p95 for the initial graph read < 300 ms server-side at
a synthetic 5 000-person network with 20 connections per person. Measured by a benchmark integration
test checked in at M2 and run in CI as a non-blocking report, blocking in M5.

## Alternatives considered

| Alternative | Why not |
|---|---|
| **Application-side BFS over `SELECT`-ed edges** | N round trips, moves visibility rules out of the one place ADR-0002 requires, and cannot prune blocked edges during traversal without fetching them first. |
| **Materialized per-viewer projection from the start** | Staleness in a privacy-critical read: a block or an erasure must be effective *immediately*, and a cached projection makes "immediately" an invalidation bug. Premature per §24 — no measurement justifies it yet. |
| **Graph database (Neo4j / AGE)** | A second datastore, second consistency model, and second authorization surface for a graph that is small and shallow. PostgreSQL is named as the source of truth (PDF §8). |
| **Postgres `ltree` / closure table** | Both model hierarchies; this is a general undirected graph with per-viewer pruning. Materialized closure would need invalidation on every connection, block, and erasure. |
| **Depth cap of 3 (as the prototype shows)** | The PDF explicitly forbids an arbitrary *product* depth cap. Our bound is operational and disclosed. |
| **Real IDs on ghost nodes** | Enables cross-referencing that defeats the disclosure rule. See B8 in ADR-0002. *(Alpha temporarily ships this rejected alternative — see the accepted deviation under decision 4.)* |

## Consequences

- **Positive:** one traversal definition, enforced in the database, unit-testable with fixtures;
  blocks and erasure are effective on the next read with no invalidation logic; nothing to keep in sync.
- **Negative:** every graph load costs a recursive CTE. Accepted at v1 scale; step 9 is the escape hatch,
  gated on measurement.
- **Negative:** surrogate ghost IDs mean the client cannot cache ghost nodes across viewers or sessions
  keyed by identity. That is intended. *(Not yet in effect — see the accepted deviation under decision 4:
  alpha returns real `app.users.id` values on `topology_only` rows.)*
- **Negative (accepted residual):** structural re-identification of ghosts is bounded, not eliminated —
  restricting adjacency to fully-visible neighbours (decision 5) removes the neighbour-set fingerprint but
  a ghost adjacent to three or more fully-visible people remains narrowable by ordinary social knowledge.
- **Risk:** the recursive CTE is the highest-complexity SQL in the system and the easiest place to write
  a leak. Mitigation: it is covered by ADR-0002's B5/B7/B8 scenario matrix and by property-style fixture
  tests over hand-drawn graphs with known expected visibility per viewer.
- **Data constraint (one-way-ish):** `graph_surrogate_key` must be stable forever, or every viewer's
  ghost layout shuffles. Store it in platform secrets with an explicit "do not rotate without a
  migration plan" note.

## Verification

`accepted` when `modules/graph` renders the M2 slice's connection, the fixture-graph visibility matrix
(including a blocked path and a topology-only node) is green in CI, and B8 passes, including its extended
structural re-identification case (a fixture graph where a ghost's neighbour set would uniquely determine
it, asserting the decision-5 adjacency restriction holds).
