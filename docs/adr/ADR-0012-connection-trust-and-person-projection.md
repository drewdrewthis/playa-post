# ADR-0012 — Connection trust storage, the §6a person projection's export, and lane L2's amendments

- **Status:** proposed — **the trust-row model in Decision 1 is pending owner confirmation** (see
  Verification)
- **Date:** 2026-08-06
- **Amends:** [ADR-0002](ADR-0002-authorization-and-visibility-enforcement.md) §6a,
  [ADR-0004](ADR-0004-graph-traversal-and-visibility-queries.md) decisions 1/3/6/7,
  [ADR-0006](ADR-0006-outbox-and-queue-delivery.md)'s schema block
- **Drivers:** `docs/engineering/m2-lane-briefs.md` §L2 and ratified decisions (b) and (c); M2-AC3,
  M2-AC4, M2-AC5, M2-AC17, M2-AC18, M2-AC19

## Context

Lane L2 builds `modules/connections` and `modules/graph` — invitations, connections, directional
trust, and `app.visible_people`. The lane brief ratified two decisions before implementation
(`app.connection_trust` is its own table; L2 owns and exports the §6a person projection) and left one
sub-decision explicitly open **for L2's first PR**: whether "unset" trust is a row with `trust = NULL`
or the absence of a row. M2-AC4's evidence clause is a literal `SELECT trust`, so the two shapes
produce different evidence and the lane has to pick one and record it.

Implementing the lane surfaced six further decisions that no existing ADR settles and that later lanes
will copy. They are recorded here together rather than as six one-line PR comments, because C8's whole
risk is three lanes each inventing a slightly different answer.

## Decision

### 1. `unset` trust is the absence of a row, not a row holding `NULL`  *(pending owner confirmation)*

`app.connection_trust` is keyed `(owner_id, subject_id)`. Accepting a connection writes **no** trust
row; `trust.set` upserts one; a read `LEFT JOIN`s and surfaces the absence as `null`.

The column remains **nullable with no default**, exactly as ADR-0004:70-71 requires — the shape is not
weakened, it is simply never used to represent "unset" in the current flow. Two reasons the absence
model wins over the row-at-accept model:

- **It cannot be defaulted by accident.** A row written at accept time has to be written with `NULL`,
  and the first person to add `default 0` "so the column is easier to read" would silently turn every
  untouched connection into "I trust this person not at all". No row is not a value anybody can
  default.
- **It is one fewer write on the acceptance path**, which is the transaction M2-AC19 measures for
  zero-row side effects. Fewer rows written by a successful accept means a shorter list to prove
  *unwritten* by a refused one.

**Evidence this changes:** M2-AC4's `SELECT trust` for a never-touched connection returns **zero
rows**, not one row containing `NULL`. A deliberate `0` is one row containing `0`.

### 2. Disclosure is a stored *setting* and a computed *level*, with different vocabularies

`app.connections` carries `a_discloses_to_b_level` and `b_discloses_to_a_level` — each party's setting
toward the other, values `full` | `limited`. `app.visible_people` returns a computed `disclosure` of
`full` | `topology_only` per ADR-0004 decision 1.

They are deliberately two vocabularies because they are two things: ADR-0004 decision 3 says
disclosure is *computed* from "the target's own visibility settings", so a setting the person chose and
a level one viewer resolves cannot share a name without one of them lying. The computation **fails
closed**: anything that is not exactly `full` resolves to `topology_only`, so a value written by a
future migration withholds identity rather than disclosing it. M5 widens the setting vocabulary to the
prototype's "anyone / trust 50+ / trust 75+" without touching the level.

Two columns rather than one, because "I show you my name, you do not show me yours" is a state the
product has.

### 3. The §6a projection is exported as `GraphModule.visiblePeople` (lane-brief C8)

`createGraphModule` returns `{ router, visiblePeople }`, where `visiblePeople` is the
`ListVisibleGraphQuery` and the read model is the `VisiblePerson` DTO in
`modules/graph/application/visible-person.ts`. The *query* is exported rather than the repository, so a
consumer gets projected people and no seam at which to add a column to the underlying function.

Identity fields on `VisiblePerson` are **optional and absent** below `full` disclosure rather than
`null`: with `exactOptionalPropertyTypes` a consumer cannot read a name it was not given, and a
`topology_only` person serializes with no identity keys at all — which is the assertion B5's
person-projection sub-case makes. `avatarUrl` is declared and never populated in M2; a bucket key is
not a URL and minting a signed one passes through this same predicate (ADR-0002 §16), so the field
exists to stop a consumer sourcing an avatar anywhere else.

Per ratified (c), **the signature is not frozen** — L3a's first consuming PR may change it.

### 4. `app.visible_people` may read `app.connections`, `app.connection_trust`, and `app.users`

Recorded in `tests/fitness/sql-table-ownership-allowlist.json` rather than hardcoded in the walker, so
the cross-module grant is reviewable. ADR-0002 §6a's "no direct join to `app.users` for an author
card, ever" is a rule for *consumers* of the projection; the function that computes the projection is
the one place the join has to happen, and the allowlist is what keeps that a single sanctioned
exception instead of a precedent.

### 5. A module may grow an `infrastructure/` directory for non-persistence adapters

`modules/connections/infrastructure/node-crypto-random-token.ts` holds the `node:crypto` CSPRNG behind
the invite-token port. `domain/` and `application/` may not import a Node builtin
(`no-domain-to-infrastructure`, whose own comment names this token as the first instance), and
`persistence/` is the one directory `domain/` may never import — so a third directory is the only place
the adapter can live. Addendum §4 already allows a module to grow the directories it needs.

The domain's `generateInviteToken` **defaults** its port to that adapter, which is the single
`domain/ → infrastructure/` edge in the tree. The generator is a pure function with no lifecycle, and
threading a source through every call site would buy ceremony rather than substitutability; a caller
that needs determinism passes its own.

### 6. `ApplicationError` serializes as `{ code, message }` — never a stack

M2-AC18 requires "a structured error with a stable code and **no stack or internal detail**". An
`Error` serializes its `stack` by default, so the wire form is declared once on the base class
(`toJSON`) rather than stripped at each transport — a second transport (the sync envelope, a
dead-letter record) would otherwise have to remember. The `stack` property is untouched on the object,
so logs and debuggers still have it; this governs what leaves the process.

### 7. Two naming and shape deviations, recorded rather than left to be noticed

- **No procedure input is called `userId`.** `trust.set` takes `subjectUserId`, `connection.get` takes
  `otherUserId`. ADR-0002:180-181 forbids `viewerId`/`userId`/`actorId`/`ownerId` on any input and
  `tests/fitness/viewer-id-provenance.fitness.test.ts` fails the build on one. Naming the *subject* of
  an opinion is a different act from asserting who holds it — ADR-0005's own precedence list uses
  `targetUserId` for the same reason.
- **`app.outbox_events.event_id` is a v4 UUID**, not the v7 ADR-0006's schema comment names.
  PostgreSQL 17 ships no `uuidv7()` and M2 adds no dependency for one. ADR-0006 guarantees no ordering
  and states consumers must not assume any, so v4 is a correct key; the upgrade is one line at the
  writer with no migration.

### 8. The checked-in function and the migration copy are compared, not trusted

ADR-0004:73-74 requires `app.visible_people` to be checked in at
`modules/graph/persistence/sql/visible-people.sql`; migrations are forward-only and cannot read a file.
The statement therefore exists twice, and
`modules/graph/tests/integration/visible-people-migration.integration.test.ts` asserts the checked-in
file appears **verbatim in exactly one migration**. Changing the function means editing the module file
and shipping a new migration with the new text.

## Alternatives considered

| Alternative | Why not |
|---|---|
| **Trust row written at accept time with `trust = NULL`** | Equally valid, and it makes `SELECT trust` return one row for an untouched connection. Rejected on the default-by-accident argument in Decision 1; the choice is genuinely close, which is why it is the one item flagged for owner confirmation. |
| **Trust as columns on `app.connections`** | Ratified against before implementation (lane-brief decision (b)): every query touching a connection would have to remember to project trust away, and ADR-0002:218-219's operator exclusion is table-granular. |
| **One `disclosure_level` column shared by both parties** | Makes asymmetric disclosure unrepresentable, and the product has it. |
| **Exporting the `VisiblePeopleRepository` instead of the query** | Hands consumers the SQL seam and invites "just one more column" onto the function's result — the R2 leak the projection exists to prevent. |
| **Putting the CSPRNG adapter in `persistence/`** | `no-domain-to-infrastructure` forbids `domain/ → persistence/` by name, so the default binding would fail the build. Renaming the rule around it would be changing the rule to fit the design. |
| **A repo-wide ban on `Math.random`** | The CSPRNG fitness rule is scoped to the invite-token generator's own import closure. A repo-wide ban is a larger rule nobody has asked for, and a rule that needs exceptions on day one is a rule nobody keeps. |
| **Stripping the stack at each transport instead of on the error** | Works until the second transport. The sync envelope (L4) and the outbox dead-letter record are both already planned. |

## Consequences

- **Positive:** one definition of "who can this viewer reach", exported as a DTO that later lanes
  consume rather than re-derive; trust that a forgetful query cannot leak because it never joins it;
  an invite token whose randomness is checkable by a fitness rule even though the CSPRNG lives in an
  adapter.
- **Negative:** the `visible-people.sql` statement is duplicated into a migration. Mitigated by the
  verbatim-containment assertion, not by discipline.
- **Negative:** `VisiblePerson.avatarUrl` is a declared field with no producer until the storage module
  exists. Accepted deliberately — the alternative is a consumer sourcing avatars outside the
  projection.
- **Risk:** the exported projection is one consumer old. L3a is expected to change it, and doing so is
  cheaper than L3a working around it (ratified (c)).

## Verification

`accepted` when:

1. **The owner confirms Decision 1** (absence-as-unset) or asks for the row-at-accept model instead.
   M2-AC4's evidence clause is written against the absence model — a `SELECT trust` returning zero
   rows for an untouched connection — and flipping the decision changes that evidence, this ADR, and
   `directional-trust.integration.test.ts`'s two `trustRowFor` assertions together.
2. `pnpm test:integration` and `pnpm test:security` are green with B5 and B6 live in
   `tests/security/b-rows.manifest.json`.
3. `pnpm boundaries` and the `sql-table-ownership` rule are green over
   `modules/graph/persistence/sql/`.
4. L3a's first consumer of `GraphModule.visiblePeople` reports whether the signature survived contact.
