# ADR-0017 — Standing privacy limits: a per-user policy ANDed onto the per-connection grant

- **Status:** proposed — **the default is the owner's to confirm** (see Verification)
- **Date:** 2026-08-08
- **Amends:** [ADR-0004](ADR-0004-graph-traversal-and-visibility-queries.md) decision 3
- **Drivers:** issue #49; `design/Playa Post.dc.html`, the You screen's "who sees your name" and
  "who can pin to your board"; ADR-0002 §6a

## Context

`app.connections` carries `a_discloses_to_b_level` / `b_discloses_to_a_level` — a binary
`full | limited`, one column per direction, per connection. ADR-0004 decision 3 makes them
authoritative for name disclosure and `app.visible_people` reads them.

**Nothing has ever written them.** Both default to `'full'`, no procedure sets either, and the
product has therefore shipped with every first-degree connection able to see every other's name.

The design's You screen describes a different shape. It offers two limits — who may see your
name, who may pin a note to your board — each with two dimensions: a **trust floor**
(`ANYONE | TRUST 50+ | TRUST 75+`) and a **degree limit** (`UP TO 3RD° | UP TO 2ND° | 1ST° ONLY`).
That is a *rule the owner states once*, not an answer recorded per connection.

The two models are not the same thing and neither subsumes the other. A per-connection column can
express "I show my name to Moss but not to Juno", which no rule can. A rule applies to people the
owner has never considered one at a time, including people they have not met yet — which no
per-connection column can, because there is no row until there is a connection.

## Decision

**1. A new table, `app.privacy_settings`, one row per user, holding both limits.**
`name_min_trust` / `name_max_degree` / `note_min_trust` / `note_max_degree`. Not columns on
`app.connections`: this is a statement about the owner, not about a pair, and hanging it on the pair
would mean rewriting every connection row whenever a rule changed.

**2. `NULL` is `ANYONE`, and it is not `0`.** The floor compares against `app.connection_trust`,
where unset trust is `NULL` (ADR-0004:70-71). A floor of `0` therefore still excludes everyone the
owner has never rated, because `null >= 0` is not true. Two different rules; only one of them is a
row on the screen. Storing `0` for "no requirement" would silently make the loosest setting one of
the tightest.

**3. `app.visible_people` ANDs the policy onto the existing grant — it does not replace it.**
The `disclosed` CTE keeps `granted.level = 'full'` and adds the degree and trust clauses. Neither
gate can widen the other, so adding the policy is incapable of disclosing anything that was
previously withheld. The binary columns stay, unwritten, as the per-connection override the rule
cannot express.

**4. An absent row is the permissive default, spelled out in SQL rather than backfilled.**
`coalesce(limits.name_max_degree, 3)` and `limits.name_min_trust is null`. A row is written the
first time somebody tightens something. This is what makes the migration a strict no-op on existing
data.

**5. The trust the floor compares is the *owner's*, toward the viewer** — `app.connection_trust`
keyed `owner_id = the person being looked at`. It is the only reading available: trust is private
and directional, so an owner cannot gate on a value they cannot see. `app.visible_people` therefore
reads a trust value the viewer does not hold, consumes it as a boolean, and never projects it; the
`trust` column it returns is still keyed `owner_id = viewer_id` (ADR-0002 B6).

**6. Reachability is untouched.** Only the `disclosure` column and the two identity columns it gates
can narrow. `app.visible_edges` composes `app.visible_people` for `user_id` alone and is provably
unaffected; `app.visible_bulletins` inherits the narrowing on the author card, which is correct — a
bulletin stays visible while its author becomes unnamed.

**7. `note_*` is stored and enforced by nothing, deliberately.** `app.bulletins` has no recipient
column, so nobody can pin to any board at all and the stored value cannot be violated. The migration
that gives a bulletin a recipient owes the enforcement point and its test.

## Alternatives not taken

**Replace the binary columns with the policy.** Rejected: it deletes the only representation of a
per-connection exception, and rewriting `app.visible_people`'s edge CTE to drop
`target_discloses_to_source` touches the one function ADR-0002 §6 makes the single composition point
— a change whose blast radius is every authorized read, taken for no capability the AND does not
already give.

**Materialise the policy into the per-connection columns on save.** Rejected: it needs an
invalidation story (every connection accepted later, every trust change) and the failure mode is a
stale row out-voting the rule the user is looking at.

**Default to the comp's `TRUST 50+ / UP TO 2ND°`.** Rejected as unshippable rather than merely
undesirable: real trust defaults to unset, so this default would withhold every name from every
viewer on day one. The comp's value is a demo's initial state, chosen to make its screenshot
legible. See Verification.

**Evaluate the policy in the application layer.** Rejected: ADR-0002 §6a puts the person-projection
rule in exactly one place, and a second evaluator is a second answer to "may this viewer see this
name". `modules/privacy` therefore exports nothing but its router, and `modules/graph` reads
`app.privacy_settings` under an allowlisted grant recorded in two places on purpose.

## Consequences

- `schema app` gains a fifteenth table; the L5 inventory assertion is reconciled in the same PR.
- `modules/graph`'s SQL-ownership grant widens by one table, restated in
  `tests/fitness/sql-table-ownership-allowlist.json` **and**
  `tests/security/composition-assertion.security.test.ts` — the duplication is that control's design.
- A viewer can infer one bit about an owner's private trust: whether they cleared the owner's
  threshold. That is inherent to the feature and is what the screen promises in as many words
  ("they know someone is there, not who"). No trust *value* becomes readable.
- The degree gate is inert in M2: `app.visible_people` caps the traversal at degree 1, so every
  visible person satisfies any degree limit. It is written now because M5 raises the cap, and a
  policy column added later would default the existing population to open.

## Verification

**Shown by the introducing PR** (issue #49):

- `apps/server/src/modules/privacy/tests/integration/name-disclosure-limit.integration.test.ts` —
  twelve rows through the real §6a projection: an untouched user discloses exactly as before, a
  floor withholds from an unrated connection, `>=` admits at the floor, the direction is the
  owner's trust and not the viewer's, `0` is not `ANYONE`, one person's limit moves nobody else's,
  the person stays on the graph with their edge intact, and the viewer still reads their own trust
  and never the owner's.
- `apps/server/src/modules/privacy/tests/integration/privacy-limits.integration.test.ts` — the
  absent row reads permissive without creating one; the check constraints agree with the domain.
- `tests/e2e/you-screen.spec.ts` — the pill cycles, and the value survives a reload, which is the
  only evidence the write landed.

**Pending owner confirmation:** decision 4's *permissive* default. It preserves today's behaviour
exactly and is the only default that does not hide every name on day one, but "what should a new
user's privacy be" is a product decision, not an implementation detail. Changing it later is a
migration plus a backfill, not a code change — which is why it is called out here rather than left
in a commit message.

**Owed by the milestone that gives a bulletin a recipient:** decision 7's enforcement point, and a
suite beside it.
