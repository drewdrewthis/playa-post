# Specs — M2 vertical-slice BDD feature files

This directory holds the BDD feature files for milestone M2 (`docs/engineering/implementation-plan.md`
§"M2 — First production vertical slice"), which implements the addendum §23 flow exactly. If a behavior
is not captured in a scenario below, it is not in M2 scope — the inverse also holds: every M2-AC1…AC26
is captured here or explicitly named as not cleanly mappable.

Sources of truth, in precedence order: `docs/engineering/implementation-plan.md` (M2 ACs) →
`docs/engineering/architecture-addendum.md` §21 (test levels) + §23 (slice flow) →
`docs/adr/ADR-0002` (authorization/visibility), `ADR-0005` (offline idempotency), `ADR-0006` (outbox),
`ADR-0008` (identity) → `docs/product/decisions.md` (D1–D3) → the handoff PDF.

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
independent, no cross-level duplication of the same invariant.

`@e2e` scenarios are reserved for the addendum §21 list, restricted to the rows M2 actually exercises:
Invite and connection acceptance · Directional trust changes · Graph visibility · Hidden identities ·
Bulletin visibility · Bulletin reporting · Viewer-controlled dismissal · Notify Me matching · Offline
mutation replay · Event idempotency. (Blocking and Account erasure are M5 — not tagged `@e2e` anywhere
in this directory because they are out of M2 scope entirely.) `vertical-slice-e2e.feature` is the
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
| `moderation-report-dismiss.feature` | Private report + viewer-local dismissal | 2 e2e, 5 integration |
| `offline-replay.feature` | Mutation envelope replay, actorship precedence | 1 e2e, 2 integration |
| `vertical-slice-e2e.feature` | Composite M2-AC1 proof + log hygiene | 1 e2e, 1 integration |
| **Total** | | **12 e2e, 44 integration, 10 unit — 66 scenarios** |

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
| M2-AC12 (archive lifecycle) | `bulletin-request-lifecycle.feature` › "Archived bulletin is gone for non-authors..." / "Archiving an already-archived bulletin is idempotent" |
| M2-AC13 (grammar boundaries) | `board-visibility-query.feature` › the four grammar `@unit` scenarios |
| M2-AC14 (narrow-only + indistinguishability, B10/B17) | `board-visibility-query.feature` › "Unauthorized and non-existent bulletin IDs are indistinguishable"; `moderation-report-dismiss.feature` › "Reporting an invisible bulletin fails like reporting a non-existent one" |
| M2-AC15 (composition assertion, B12) | **Not mapped — see below** |
| M2-AC16 (log hygiene) | `vertical-slice-e2e.feature` › "The captured logs from a full slice run contain no sensitive data" |
| M2-AC17 (invite token) | `invitations.feature` › all six scenarios |
| M2-AC18 (failure surface, six cases) | `connections.feature` › "Accepting your own invite is rejected"; `directional-trust.feature` › "Setting trust on a non-connection is rejected"; `moderation-report-dismiss.feature` › "Reporting your own bulletin is rejected"; `bulletin-request-lifecycle.feature` › "Archiving another user's bulletin is rejected"; `notify-me.feature` › "Subscribing to push twice is rejected" |
| M2-AC19 (write-path IDOR, B13) | one scenario per mutation type: `connections.feature` (connection.accept), `directional-trust.feature` (trust.set), `bulletin-request-lifecycle.feature` (bulletin.create/archive), `moderation-report-dismiss.feature` (bulletin.report/dismiss), `notify-me.feature` (notifyMe.update), `offline-replay.feature` (actorship-before-version-comparison over the sync envelope) |
| M2-AC20 (viewerId provenance, B14) | **Not mapped — see below** |
| M2-AC21 (push payload minimization) | `notify-me.feature` › "Push payload carries only identifiers and a generic string" |
| M2-AC22 (delivery-time re-check) | `notify-me.feature` › "A recipient made unauthorized before flush does not receive the push" |
| M2-AC23 (outbox retry/dead-lettering) | `notify-me.feature` › "A throwing consumer is retried with growing backoff and eventually dead-lettered" |
| M2-AC24 (concurrent drainers) | `notify-me.feature` › "Two concurrent drainers claim disjoint events" |
| M2-AC25 (handle rules) | `identity-magic-link.feature` › the six handle-rule scenarios |
| M2-AC26 (regression) | **Not mapped — see below** |

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
