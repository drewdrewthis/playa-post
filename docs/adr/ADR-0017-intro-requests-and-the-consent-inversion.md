# ADR-0017 — Intro requests: their own aggregate, eligibility composed on both sides, and the consent inversion (amends 0002, 0004)

- **Status:** proposed
- **Date:** 2026-08-11
- **Drivers:** issue #89; ADR-0002 §6 (one composition point), §6a (one person-projection
  rule), §10 (no user-existence oracle), B11 (person lifecycle fails closed);
  ADR-0004:75-77 (compose `app.visible_people`, never re-derive reachability);
  ADR-0012 (the §6a projection's export); decision D6 and PDF §6 (fixed-recipient
  messaging stays out of the bulletin model); `design/Playa Post.dc.html`'s intro hint on
  the bulletin detail sheet

## Context

Requesting an intro is the product's answer to "I can see this person, and I would like to
meet them". The owner's framing was that it is "just a special type of pinning a note" —
the same textarea, addressed to a person — and that framing is right about the *idiom* and
wrong about the *model*. Four differences decide it:

| | `app.notes` | intro request |
|---|---|---|
| Lifecycle | none — one write, no update, no delete | three states, and a second actor decides |
| Parties | 2 (author, recipient) | 3 (requester, via, target) |
| Write gate | `degree = 1` | `degree(target) = 2` **and** via ∈ shared-direct(requester, target) |
| Read model | `recipient_id = viewer_id`, one projection | three projections, one per role, gated on state |

Forcing it into `app.notes` means nullable `via_id`/`status` columns the note path must
always ignore, and a `visible_notes` that branches on subtype — the placeholder shape
addendum §4 refuses and `modules/notes/domain/note.ts` explicitly declines.

Three harder questions came with it, and none of them is answered by "copy the notes
module".

**1. Where does eligibility live?** "Is this via connected to the target" reads like one
join against `app.connections`. Taking that shortcut would put a second definition of
reachability inside the one module whose whole job is putting two strangers in touch —
R2, the plan's only Critical-severity risk — and would need a cross-module grant in
`sql-table-ownership-allowlist.json` to be permitted at all.

**2. Is a request a snapshot of the graph it was made in?** A request can sit open while
the graph moves under it: the via and the target part company, the target lowers their own
`visible_to_distance`, or the target deactivates. If eligibility is checked only at ask
time, passing on afterwards discloses the requester to somebody the current rules say may
not reach them.

**3. What does the target see, and how is that person projected?** ADR-0002 §6a is
categorical — every person representation is projected through `app.visible_people`, and
there is no direct join to `app.users` for a person card, ever. But the whole point of an
introduction is that the target is shown somebody they could not otherwise see: if the
requester's own `visible_to_distance` is `first`, the requester is *absent* from
`app.visible_people(target)`. §6a as written would hand the target a note with no name on
it, which is not an introduction.

And underneath all three, the privacy invariant the feature rests on: **a declined request
must be invisible to its target forever.** A target who could distinguish "somebody asked
and was declined" from "nobody asked" makes declining unsafe for the via, and a via who
cannot safely decline will pass things on to avoid the awkwardness.

## Decision

### D1 — Its own module, its own table, its own aggregate

`modules/intros`, `app.intro_requests`, and `IntroRequest`. Three party columns, a `note`,
a `status` (`requested` → `passed_on` | `declined`), and a `decided_at` the database keeps
consistent with the status:

```sql
constraint intro_requests_decided_at check ((status = 'requested') = (decided_at is null))
```

The **anti-spam control** is a partial unique index on `(requester_id, target_id) where
status = 'requested'` — one open ask per pair, whatever the via, because without it a
requester fans one ask out to every shared connection and the target hears about it from
all of them. It is partial deliberately: a decided request leaves the pair free to ask
again. That means **a decline imposes no cooldown**, which is a known harassment vector
recorded here rather than hidden — see Consequences.

### D2 — Eligibility is one function, composing `app.visible_people` on **both** sides

`app.intro_via_candidates(requester_id uuid, target_id uuid)`, `SECURITY INVOKER`,
`search_path = ''`, `STABLE`, checked in at `persistence/sql/intro-via-candidates.sql` and
copied byte-identically into its migration.

```
target ∈ app.visible_people(requester) at degree = 2
via    ∈ app.visible_people(requester) at degree = 1
       ∩ app.visible_people(target)    at degree = 1
```

The second half of that intersection is the load-bearing choice. "Who is directly
connected to the target" is `app.visible_people(target)` at degree 1 — **not** a join
against `app.connections`. At degree 1 a person's own reach filter cannot bind (the
function's `else 1` floor), so the two sets are identical for an active person, and the
composition inherits the rest of the person rules for free: a deactivated, suspended or
erased via is absent from the function and is therefore not a candidate (ADR-0002 B11),
and blocking will prune candidates the day it lands with nothing to change here.

`modules/intros` therefore needs **no allowlist entry**. It owns `app.intro_requests` and
`app.intro_via_candidates`; it names no other module's table. The ownership walker's
per-module registration (`sql-table-ownership.fitness.test.ts`) carries
`intro_via_candidates` — a *function*, not a table — through its owned-names channel,
because the walker's exemption is name-based and the module's own SQL must be allowed to
name its own function; that widening is deliberate and ratified here, not a test-local
convenience.

Both writes compose that function inside their own statement — an `INSERT … SELECT …
WHERE EXISTS` and a gated `UPDATE` — so there is no read-then-write window and no ordering
a later editor could rearrange.

### D3 — `pass_on` re-checks eligibility; `decline` does not

The pass-on's `UPDATE` carries the same `EXISTS (… app.intro_via_candidates …)` the insert
did. A request is not a snapshot: if the graph or the target's reach setting has moved, the
pass-on is refused with the ordinary `INTRO_UNAVAILABLE` and the target learns nothing.

Declining carries no such clause, and the asymmetry is the decision rather than an
oversight. A decline discloses nothing to anybody, so it must stay available for as long as
the request is open — a via who could neither pass on nor decline would be left holding
somebody else's ask forever, which is the failure mode that makes people stop answering.

### D4 — Requesting is consent to be seen, and the consent is projected, not asserted

If the via passes it on, the target is shown the requester's identity **even when the
requester's own `visible_to_distance` would hide them from somebody two hops away**.

This amends nothing in §6a's mechanism and everything in its input. The requester's card on
a target-role row is projected from `app.visible_people(requester_id, 0, 1)` — the
requester's own self-projection, where the function's `case when person_id = viewer_id then
'full'` applies. So:

- it is still `app.visible_people`, so "no direct join to `app.users` for a person card"
  holds, and the sanctioned-function exemption in `sql-table-ownership` still covers it;
- consent is **not a snapshot** either: the card is projected on every read, so a requester
  who deactivates afterwards takes their card away and leaves the introduction behind —
  identifier included, exactly as `app.visible_notes`' LEFT JOIN does for an author.

Every other card on every other intros surface is projected from the *reader's* own world
in the ordinary way: a via sees the requester and the target as their own settings disclose
them.

The UI obligation this creates is stated in `packages/contracts/src/intros.ts` and belongs
to the sheet: **it must say so before send.**

### D5 — One refusal for everything, and content is validated before eligibility

`INTRO_UNAVAILABLE` (`NOT_FOUND`) answers every refusal on both write paths — degree 1,
degree 3+, absent, deactivated, self, hidden by reach, a via who is not shared, a pair that
already has an open ask, "not yours to decide", "already decided", and "no longer
eligible". Serializing them yields exactly one element, asserted as a `Set`.

`INTRO_CONTENT_INVALID` (`BAD_REQUEST`) is the only other answer, and
`request-intro.service.ts` raises it **before** the repository is called. Reversed, a
caller could probe reachability by sending deliberate rubbish and reading which refusal
came back — the oracle §10 forbids, reopened by an ordering nobody would think to look at.

`intros.viaCandidates` never refuses at all: an unreachable, deactivated or invented
`targetUserId` returns an **empty list**.

### D6 — A dual-role inbox, discriminated by a server-computed `role`

`intros.listInbox` returns rows where `via_id = actor and status = 'requested'` (role
`via`, carrying both other parties and the note) unioned with rows where `target_id = actor
and status = 'passed_on'` (role `target`, carrying the requester and the note). **No other
combination is ever returned**, and there is no parameter that could add one — which is
what makes a declined request invisible to its target by construction rather than by a
filter somebody could widen.

### D7 — Online-only; not an offline-queued mutation

`intros.request` is absent from `QUEUED_MUTATION_TYPES` and `intros.module.ts` exports no
service for `sync.submitMutations` to register. Eligibility is time-varying, so a queued
ask could drain into a graph where it is no longer true, and ADR-0005's conflict matrix
defines no resolution for that. This is the same call `notifications.dismiss` makes.

## Alternatives considered

**A note subtype, or a seventh bulletin type.** Rejected — see the table in Context. PDF §6
forbids mixing fixed-recipient messaging into the bulletin model, decision D6 made that
separation structural for notes, and an aggregate with three parties and a lifecycle is
further from a note than a note is from a bulletin.

**Joining `app.connections` for the target side of eligibility.** Rejected. Identical
result for an active person, a second definition of reachability, and it would require a
cross-module grant a reviewer has to approve — for no gain.

**Injecting `modules/graph`'s `visiblePeople` into `modules/intros`.** Rejected. The
composition happens in SQL, so there is no TypeScript edge to draw; adding one would put a
second answer one convenience method away, and `pnpm boundaries` would not see it because
the edge would be legal.

**Snapshotting the requester's identity onto the row at ask time**, to solve D4 without the
self-projection. Rejected: a second, ungated copy of a person's identity that no later
change to their account could withdraw — the opposite of what §6a exists to guarantee.

**Threading intro requests through `GroupedNotification`.** Rejected for #89. The
notifications contract is bulletin-shaped and has no `kind` discriminator; adding one
touches a contract four consumers read, and grouping-into-windows is the wrong semantics
for an individual, actionable request. If the bell must badge intro requests, that is an
additive follow-up reading `intros.listInbox`'s count.

**Telling the requester nothing when a via declines.** Rejected: it strands them waiting on
an answer that already came. `intros.listOutbox` shows `declined` with **no reason and no
re-ask control** — honest without exposing the via's rationale.

## Consequences

- `modules/intros` is the second module (after `modules/notes`) whose whole authorization
  lives in SQL that no TypeScript rule can inspect. `sql-table-ownership` keeps the
  checked-in escape hatch shut; the two gated write statements are Kysely `sql` literals
  and are covered only by the integration suite.
- **A declined request leaves the pair free to re-ask immediately.** No cooldown ships with
  #89. Recorded as a follow-up rather than resolved here, because a cooldown is a product
  decision about how long, not a schema gap.
- `app.intro_via_candidates` calls `app.visible_people` twice per invocation, and the
  gated pass-on calls it again per candidate row. Both are bounded by a person's own
  first-degree set and run at `max_depth` 2 and 1, so the cost is small — but it is two
  recursive CTEs on a sheet open, and is the first thing to measure if the intro sheet ever
  feels slow.
- The target-role card is the **only** place in the system where a person is disclosed to
  somebody their own visibility setting excludes. It is narrow (one row, one reader, only
  after the via acted) and it is projected rather than asserted, but it is a real widening
  of §6a's effect and any future person-disclosure surface must argue for itself
  separately rather than cite this one.
- `EXPECTED_PROCEDURE_COUNT` moves 29 → 34, and the contracts spec gains five keys.

## Verification

| # | Claim | Evidence |
|---|---|---|
| 1 | The table carries the §4 backstop, exactly one policy, `app_rw`-only grants, all three CHECKs, and the partial open-per-pair index | `modules/intros/tests/integration/intro-requests-migration.integration.test.ts` |
| 2 | The function is `SECURITY INVOKER`, `search_path = ''`, `STABLE`, and byte-identical to its checked-in source in exactly one migration | same suite |
| 3 | Eligibility composes `app.visible_people` on both sides and names neither `app.connections` nor `app.users` | `intro-via-candidates-sql-composition.unit.test.ts`; `tests/fitness/sql-table-ownership.fitness.test.ts`'s intros block, with **no** allowlist entry |
| 4 | Nine ineligible shapes each return an empty set rather than an error | `intro-via-candidates.integration.test.ts` |
| 5 | Seven ineligible targets, and a bad via versus a non-existent one, are indistinguishable | `request-an-intro.integration.test.ts` — serialized into a `Set` asserted to hold one element |
| 6 | A lapsed pass-on is refused and a decline still succeeds | same suite, AC7 scenarios |
| 7 | After a decline, every intros read answers the target exactly as it answers a control in the same graph position | same suite — `toEqual` against `seedSymmetricWorld()`'s never-asked control, with a control-of-the-control proving the control is not empty everywhere |
| 8 | The consent inversion works, and withdraws when the requester deactivates | same suite, AC11 scenarios — including a direct assertion that `app.visible_people(target)` does not contain the requester |
| 9 | Events ride the same transaction and carry no note | same suite — a forced `CHECK` on `app.outbox_events` proves the rollback; `intro-request.events.unit.test.ts` asserts over `JSON.stringify` |
| 10 | Contract and router agree | `tests/fitness/contracts-api-parity.fitness.test.ts` at `EXPECTED_PROCEDURE_COUNT` 34 |
| 11 | No procedure accepts a viewer identifier | `tests/fitness/viewer-id-provenance.fitness.test.ts`, walking the registered intros router |
| 12 | The web surface states the consent before send | `intro-copy.ts`'s `INTRO_CONSENT_LINE`, rendered by `intro-sheet.tsx` above the note field; `intro-sheet.unit.test.tsx` asserts it on screen before the send is pressable |
