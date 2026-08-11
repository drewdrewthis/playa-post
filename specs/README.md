# Specs — BDD feature files

This directory began as the milestone-M2 vertical-slice suite (`docs/engineering/implementation-plan.md`
§"M2 — First production vertical slice", the addendum §23 flow exactly) and now also carries feature
files for later-milestone work (`bulletin-post-types.feature`, #87; `pin-a-note.feature`, #88;
`edit-display-name.feature`, #177). For M2
the completeness claim holds both ways: if a behavior is not captured in an M2 scenario below, it is not in M2 scope, and
every M2-AC1…AC26 is captured here or explicitly named as not cleanly mappable.

Sources of truth, in precedence order: `docs/engineering/implementation-plan.md` (M2 ACs) →
`docs/engineering/architecture-addendum.md` §21 (test levels) + §23 (slice flow) →
`docs/adr/ADR-0002` (authorization/visibility), `ADR-0005` (offline idempotency), `ADR-0006` (outbox),
`ADR-0008` (identity) → `docs/product/decisions.md` (D1–D3 for the M2 files; D5 for
`bulletin-post-types.feature`, D6 for `pin-a-note.feature`, D15 for
`edit-display-name.feature`) → the handoff PDF.

⚠ **`docs/product/decisions.md` is read newest-first for the later-milestone files.** D2 cut private
notes from v1; **D6 supersedes that for [#88](https://github.com/drewdrewthis/playa-post/issues/88)** and
reinstates them as a separate module — so a brief that reads only D1–D3 will conclude `pin-a-note.feature`
should not exist. What D2 still governs is the *shape*: `bulletins.create` refuses the value `note`, which
is PDF §6's constraint and is untouched by D6.

## Rule for implementation briefs

**Every implementation brief for M2 work must cite the scenario name(s) it makes pass**, not just the
feature file. A PR implementing `bulletin.archive`, for example, cites "Archived bulletin is gone for
non-authors but retained for the author" and "Archiving an already-archived bulletin is idempotent" from
`bulletin-request-lifecycle.feature`, not just "the bulletin lifecycle file."

## Tag table

| Tag | Tests | Mocking |
|---|---|---|
| `@e2e` | Happy paths, full system flow — reserved for the addendum §21 critical-user-flow matrix items that are in M2 scope | None |
| `@integration` | Authorization, transactions, events, repository/SQL correctness, module boundaries, error handling | External services only |
| `@unit` | Pure logic — domain policies, parsers, generators, invariants — no I/O | Collaborators |

Rule followed throughout: exactly one tag per scenario, one invariant per scenario, scenarios are
independent, no cross-level duplication of the same invariant. Three scenarios in
`request-an-intro.feature` carry `@unit @integration` and are the only exceptions; the counts below
name them rather than let the totals absorb them.

For M2 files, `@e2e` scenarios are reserved for the addendum §21 list, restricted to the rows M2
actually exercises:
Invite and connection acceptance · Directional trust changes · Graph visibility · Hidden identities ·
Bulletin visibility · Bulletin reporting · Viewer-controlled dismissal · Notify Me matching · Offline
mutation replay · Event idempotency. (Blocking and Account erasure are M5 — not tagged `@e2e` anywhere
in this directory because they are out of M2 scope entirely.) Later-milestone files tag `@e2e` only
where a browser-level Playwright spec exists — `bulletin-post-types.feature` (#87) tags exactly its
round-trip scenario, proved by `tests/e2e/bulletin-post-types.spec.ts`. `vertical-slice-e2e.feature` is the
composite Playwright proof point for M2-AC1; the other `@e2e` scenarios decompose the same flow
per-module for independent module-level suites — this is deliberate duplication of *flow lines*, not of
*invariants*, since each proves a different module's contract.

## Feature files

| File | Feature | Scenario counts |
|---|---|---|
| `identity-magic-link.feature` | Sign-in, actor resolution, onboarding, handle rules | 3 unit, 6 integration |
| `invitations.feature` | Invite token generation and lifecycle | 3 unit, 3 integration |
| `connections.feature` | Invite acceptance → accepted connection | 1 e2e, 4 integration |
| `directional-trust.feature` | Private directional trust | 1 e2e, 6 integration |
| `graph-visibility.feature` | First-degree graph rendering + disclosure | 1 e2e, 2 integration |
| `bulletin-request-lifecycle.feature` | Request create/archive, atomicity | 1 e2e, 5 integration |
| `board-visibility-query.feature` | Board listing + restricted grammar | 2 e2e, 2 integration, 4 unit |
| `notify-me.feature` | Single Notify Me query, grouped push, outbox | 2 e2e, 8 integration |
| `moderation-report-dismiss.feature` | Private report + viewer-local dismissal; the Dismissed category and un-dismissal (#170) | 2 e2e, 15 integration |
| `offline-replay.feature` | Mutation envelope replay, actorship precedence | 1 e2e, 2 integration |
| `vertical-slice-e2e.feature` | Composite M2-AC1 proof + log hygiene | 1 e2e, 1 integration |
| `bulletin-post-types.feature` | The six postable types; filterable ≠ postable (#87, M5) | 1 e2e, 3 integration |
| `pin-a-note.feature` | Private person-to-person notes, degree-1 gated (#88, D6); the expanded view and answering one (#176, D14) | 1 e2e, 16 integration, 9 unit |
| `request-an-intro.feature` | One-hop introductions: eligibility, the pass-on, and the target's answer (#89, #166, #175, D11, D12) | 25 integration, 4 unit |
| `edit-display-name.feature` | Editing your own display name; the handle stays immutable (#177, D15) | 1 e2e, 11 integration, 6 unit |
| **Total** | | **15 e2e, 109 integration, 29 unit — 150 scenarios** |

The three numbers sum to 153, not 150, and the gap is not an arithmetic slip: three scenarios in
`request-an-intro.feature` (lines 172, 182, 259) carry `@unit @integration` together, so each is
counted at both levels and once in the total. They are the standing exception to the one-tag rule
above, and they are counted here rather than quietly rounded away — a total that disagrees with its
own columns invites exactly the drift the last recount found.

## AC → scenario traceability

| AC | Covered by |
|---|---|
| M2-AC1 (slice e2e) | `vertical-slice-e2e.feature` › "The full addendum §23 flow passes as eleven named steps"; decomposed across the `@e2e` scenarios in `connections.feature`, `directional-trust.feature`, `graph-visibility.feature`, `bulletin-request-lifecycle.feature`, `board-visibility-query.feature`, `notify-me.feature`, `moderation-report-dismiss.feature`, `offline-replay.feature` |
| M2-AC2 (auth boundary) | `identity-magic-link.feature` › the three "no token / tampered token / incomplete onboarding" scenarios |
| M2-AC3 (trust privacy, B6) | `directional-trust.feature` › "Trust value is never present in a payload reachable by the other party" / "...by a third party" |
| M2-AC4 (unset ≠ zero) | `directional-trust.feature` › "A connection with no trust assigned serializes as null, not zero" / "A deliberately-set trust of zero serializes as zero, not null" |
| M2-AC5 (visibility, B5 + §6a) | `graph-visibility.feature` › "A viewer with no relationship..." / "A connection below full disclosure..."; `board-visibility-query.feature` › "A viewer with no relationship to the author gets zero board rows" / "A bulletin from an author below full disclosure hides the author's identity" |
| M2-AC6 (transaction atomicity) | `bulletin-request-lifecycle.feature` › "A fault after insert and before commit leaves no partial state" |
| M2-AC7 (outbox → grouped push window) | `notify-me.feature` › "A second matching bulletin at 59 seconds joins the same group" / "A matching bulletin at 61 seconds starts a new group" |
| M2-AC8 (consumer idempotency) | `notify-me.feature` › "Delivering the same event twice produces one notification" |
| M2-AC9 (offline replay) | `offline-replay.feature` › "The same bulletin.create envelope submitted twice..." / "Same mutationId with a different payload is rejected" |
| M2-AC10 (report privacy, B9) | `moderation-report-dismiss.feature` › "A reported bulletin remains visible to other eligible viewers" / "The reporter's identity never reaches the author" |
| M2-AC11 (dismissal is viewer-local) | `moderation-report-dismiss.feature` › "Dismissing a bulletin removes it only for the dismissing viewer" |
| Dismissed category + un-dismissal ([#170](https://github.com/drewdrewthis/playa-post/issues/170)) | `moderation-report-dismiss.feature` › the ten `@issue:170` scenarios — browsable, ordered by dismissal, reports excluded, viewer-scoped, narrowed to what is still visible, reversible, converging, report-preserving, author-invisible, and fail-closed for an unrelated actor |
| M2-AC12 (archive lifecycle) | `bulletin-request-lifecycle.feature` › "Archived bulletin is gone for non-authors..." / "Archiving an already-archived bulletin is idempotent" |
| M2-AC13 (grammar boundaries) | `board-visibility-query.feature` › the four grammar `@unit` scenarios |
| M2-AC14 (narrow-only + indistinguishability, B10/B17) | `board-visibility-query.feature` › "Unauthorized and non-existent bulletin IDs are indistinguishable"; `moderation-report-dismiss.feature` › "Reporting an invisible bulletin fails like reporting a non-existent one" |
| M2-AC15 (composition assertion, B12) | **Not mapped — see below** |
| M2-AC16 (log hygiene) | `vertical-slice-e2e.feature` › "The captured logs from a full slice run contain no sensitive data" |
| M2-AC17 (invite token) | `invitations.feature` › all six scenarios |
| M2-AC18 (failure surface, six cases) | `connections.feature` › "Accepting your own invite is rejected"; `directional-trust.feature` › "Setting trust on a non-connection is rejected"; `moderation-report-dismiss.feature` › "Reporting your own bulletin is rejected"; `bulletin-request-lifecycle.feature` › "Archiving another user's bulletin is rejected"; `notify-me.feature` › "Re-subscribing to push replaces the stored subscription" — the two *repeat* cases (this one and `connections.feature` › "Accepting an already-accepted invite is idempotent") are stated as legible successes rather than error codes |
| M2-AC19 (write-path IDOR, B13) | one scenario per mutation type: `connections.feature` (connection.accept), `directional-trust.feature` (trust.set), `bulletin-request-lifecycle.feature` (bulletin.create/archive), `moderation-report-dismiss.feature` (bulletin.report/dismiss), `notify-me.feature` (notifyMe.update), `offline-replay.feature` (actorship-before-version-comparison over the sync envelope) |
| M2-AC20 (viewerId provenance, B14) | **Not mapped — see below** |
| M2-AC21 (push payload minimization) | `notify-me.feature` › "Push payload carries only identifiers and a generic string" |
| M2-AC22 (delivery-time re-check) | `notify-me.feature` › "A recipient made unauthorized before flush does not receive the push" |
| M2-AC23 (outbox retry/dead-lettering) | `notify-me.feature` › "A throwing consumer is retried with growing backoff and eventually dead-lettered" |
| M2-AC24 (concurrent drainers) | `notify-me.feature` › "Two concurrent drainers claim disjoint events" |
| M2-AC25 (handle rules) | `identity-magic-link.feature` › the six handle-rule scenarios |
| M2-AC26 (regression) | **Not mapped — see below** |
| Editing your display name ([#177](https://github.com/drewdrewthis/playa-post/issues/177)) | `edit-display-name.feature` › the eighteen scenarios — the rename itself, the caller-follows-the-context authorization, the handle surviving untouched and a submitted handle being refused, the §6a projection returning the new name on the next read without disclosing one it withheld, and the shared bounds |

## ACs that do not map cleanly to a BDD scenario

Per the plan-feature procedure's instruction to name rather than force these:

- **M2-AC15** (composition assertion — every viewer-scoped query composes `app.visible_people` /
  `app.visible_bulletins`) and **M2-AC20** (viewerId provenance — no tRPC input schema carries a
  `viewerId`/`userId`/`actorId`/`ownerId` field) are **architectural fitness assertions**, proven by
  walking the router/query AST at build time (`tests/fitness/`), not by exercising observable product
  behavior through a Given/When/Then. Addendum §21 does not list a fitness-test tier alongside
  domain/application/repository/e2e — these two ACs belong to that separate discipline. Forcing them
  into a Gherkin scenario ("Given a query... When it doesn't compose the authorized set... Then the
  build fails") would describe a compiler check, not a behavior, and risks hiding a static-analysis rule
  inside what looks like a runtime test.
- **M2-AC26** (`pnpm lint:boundaries` and `pnpm test:security` stay green with the nine new modules
  present, no cross-module persistence imports) is a **CI regression gate** over the whole module set,
  not a single behavior with a Given/When/Then shape — it is the conjunction of M1's existing boundary
  fitness suite (already covered by M1's own fixtures) continuing to hold as M2 adds modules. It is
  tracked in `docs/engineering/ac-index.md` against the `lint:boundaries` and `test:security` CI jobs,
  not against a feature file here.

M2-AC1 and M2-AC16 were initially candidates for this list too (a composite multi-step Playwright run,
and a log-capture assertion over that run) but both were successfully expressed as Given/When/Then in
`vertical-slice-e2e.feature` and are included above rather than excluded.
