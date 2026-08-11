# ADR-0017 — Intro requests: their own aggregate, eligibility composed on both sides, and the consent inversion (amends 0002, 0004)

- **Status:** proposed
- **Date:** 2026-08-11
- **Drivers:** issues #89, #175 (D8) and #166 (D9, the target's answer); ADR-0002 §6 (one composition point), §6a (one person-projection
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
a `status`, and a `decided_at` the database keeps consistent with the status:

```sql
constraint intro_requests_decided_at check ((status = 'requested') = (decided_at is null))
```

The status is `requested` → `passed_on` | `declined`, and — **since D9** — `passed_on` →
`accepted` | `target_declined`, with a `responded_at` held to the same discipline
(`(responded_at is null) = (status not in ('accepted','target_declined'))`). Two actors
decide in sequence and neither may make the other's choice, which is why they are separate
columns and separate statuses rather than one shared vocabulary.

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

### D3 — `pass_on` re-checks eligibility; `decline` does not — and neither does the target's answer (D9)

The pass-on's `UPDATE` carries the same `EXISTS (… app.intro_via_candidates …)` the insert
did. A request is not a snapshot: if the graph or the target's reach setting has moved, the
pass-on is refused with the ordinary `INTRO_UNAVAILABLE` and the target learns nothing.

Declining carries no such clause, and the asymmetry is the decision rather than an
oversight. A decline discloses nothing to anybody, so it must stay available for as long as
the request is open — a via who could neither pass on nor decline would be left holding
somebody else's ask forever, which is the failure mode that makes people stop answering.

**D9's `respond` follows the decline's rule, not the pass-on's.** A pass-on re-asks the
graph because it is about to disclose the requester to somebody; an answer discloses
nothing new, because the target has already *read* the introduction — both notes, both
cards. Re-checking eligibility there would withdraw nothing while leaving somebody unable
to act on an introduction they were given, which is the same stranding this paragraph
refuses one person along. Accepting is also consent in its own right: the target is
choosing this connection rather than being placed in one.

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
them — **except the via's own card on a target-role row, which D8 extends this same
inversion to.**

The UI obligation this creates is stated in `packages/contracts/src/intros.ts` and belongs
to the sheet: **it must say so before send.**

### D5 — One refusal for everything, and content is validated before eligibility

`INTRO_UNAVAILABLE` (`NOT_FOUND`) answers every refusal on all three write paths — degree
1, degree 3+, absent, deactivated, self, hidden by reach, a via who is not shared, a pair
that already has an open ask, "not yours to decide", "already decided", "no longer
eligible", and — since D9 — "not yours to answer", "not passed on yet", "the via declined
it", and "already answered". Serializing them yields exactly one element, asserted as a
`Set`.

⚠ **"The via declined it" is the case that most has to stay indistinguishable.** A
distinct refusal there would let a target detect a decline simply by trying to accept —
reopening from the *other* side the exact oracle this feature's founding invariant closes.

`INTRO_CONTENT_INVALID` (`BAD_REQUEST`) is the other answer — since D8, on both write
paths — and both services raise it **before** the repository is called. Reversed, a
caller could probe reachability by sending deliberate rubbish and reading which refusal
came back — the oracle §10 forbids, reopened by an ordering nobody would think to look at.

D8 adds one more code, `INTRO_DECLINE_CARRIES_NO_NOTE`, that a tRPC caller never
observes: the wire's strict decline arm refuses the unknown `note` key first, as a plain
zod `BAD_REQUEST` with no application code. The domain error is the backstop for callers
that reach the service another way, and were it ever surfaced it would be safe beside the
two above for the same reason: it is a statement about the caller's own submission,
decided before the row is looked for, so it can never be the answer to "may I decide this
request".

`intros.viaCandidates` never refuses at all: an unreachable, deactivated or invented
`targetUserId` returns an **empty list**.

### D6 — A dual-role inbox, discriminated by a server-computed `role`

`intros.listInbox` returns rows where `via_id = actor and status = 'requested'` (role
`via`, carrying both other parties and the note) unioned with rows where `target_id = actor
and status = 'passed_on'` (role `target`, carrying the requester and the note — and, since
D8, the via and the via's own note). **No other
combination is ever returned**, and there is no parameter that could add one — which is
what makes a declined request invisible to its target by construction rather than by a
filter somebody could widen.

D9 needed no change here, and the absence of one is the check that it fits: an answered
introduction leaves `passed_on` and therefore leaves the inbox, exactly as a decided ask
leaves the via's half. An inbox is what is waiting on you.

### D7 — Online-only; not an offline-queued mutation

`intros.request` is absent from `QUEUED_MUTATION_TYPES` and `intros.module.ts` exports no
service for `sync.submitMutations` to register. Eligibility is time-varying, so a queued
ask could drain into a graph where it is no longer true, and ADR-0005's conflict matrix
defines no resolution for that. This is the same call `notifications.dismiss` makes.

### D8 — Passing on requires the via's own note, and passing on is consent to be named as the via (issue #175)

`intros.decide` takes a **discriminated union on `decision`**: `pass_on` requires the via's
own note, `decline` refuses one. The target then reads two notes by two people, each under
its own author's card. Product decision D11 records the owner directive behind it ("you
have to add your own message") and the reasoning; this section records what it changes in
the model above.

**A pass-on is a vouch, not a relay**, which is why the note is required rather than
offered. An intro passed on with nothing added is a mutual connection's name attached to a
stranger's ask, with no way for the target to tell whether that person actually thought it
was a good idea — the exact state the one-hop design exists to prevent.

**The via's card on a target-role row extends D4's inversion one person.** It is projected
from `app.visible_people(via_id, 0, 1)` — the via's own self-projection — rather than from
the target's world, so a via who later severs their connection to the target is still named
beside the words they wrote. The alternative leaves an unattributed vouch on the row, which
is worse than no vouch. Everything D4 says about the mechanism holds unchanged: still
`app.visible_people`, still projected on every read, so a via who deactivates takes their
card away and leaves the introduction — and the note — behind.

This widens D4's consequence rather than adding a second one: **two** cards on that one row
are now disclosed by consent rather than by the reader's settings, and it remains the only
place in the system where that happens.

**A decline carries no note, and one sent with a decline is refused rather than stripped.**
The requester is told only that it was not passed on, so text written on a decline has no
reader at all — accepting the field and discarding it silently would let its writer believe
otherwise. Zod strips unknown keys by default, so the decline arm is a `strictObject` and
`INTRO_DECLINE_CARRIES_NO_NOTE` is its own code rather than a second meaning for
`INTRO_CONTENT_INVALID`, whose message ("empty or too long") would be false here.

**The requirement is split between the database and the domain, and the halves say
different things.** `app.intro_requests.via_note` carries `check (via_note is null or
status = 'passed_on')` — an *implication*, deliberately not the biconditional
`intro_requests_decided_at` uses beside it. "Only a passed-on request may carry a via note"
holds forever; "every passed-on request carries one" does not, because rows passed on
before the migration have none and migrations are forward-only. `validateViaNote` in
`domain/intro-note.policy.ts` states the present-tense half — required on every new pass-on
— and is the **one** function that branches on the decision, so `decide-intro.service.ts`
stays branch-free per D3's reasoning.

**Neither note reaches the requester.** `intros.listOutbox`, the decide receipt, and every
outbox payload stay note-free, and for the via's note that is a stronger rule than D4's
rather than the same one: the via wrote those words *to* the target, *about* the requester.

### D9 — The target answers, and an acceptance is what makes the connection (issue #166)

**This section makes D1's "terminal for #89" false on purpose.** `passed_on` was terminal
only because #89 declined to open a second authorization path, and the whole of what it
declined was: *may an introduction create a connection, and on whose authority.* Product
decision D12 records the answer and the rejected alternative; this section records what it
changes in the model above.

`intros.respond` takes `accept` | `decline` and is gated on
`where target_id = <actor> and status = 'passed_on'` — one statement, in the same shape
`decide` uses, so "only the target, only after a pass-on, only once" is a predicate rather
than a check anybody could reorder. `status = 'passed_on'` is doing three jobs at once
there: it is the transition rule, the terminal-once rule, and the concurrency control.

**A token-free mutation, not a minted bearer invite.** An invite token is bearer-shaped
because an invite is *meant* to be handed to somebody unnamed; an introduction names all
three parties when it is written, so a transferable claim would let somebody outside the
triangle act on it — the one thing the one-hop design forbids. The caller's identity is
already authenticated at the tRPC boundary and the row already names its target, so a token
would add storage, expiry, revocation and leak questions to an authorization that is
complete without them.

**The connection is written by `modules/connections`, from the `IntroAccepted` event.**
`modules/intros` writes the status and the event in one transaction and never learns
`modules/connections` exists; the seam is the event *name*, in the shape
`modules/notifications` already consumes `NotePinned`. The alternative — an injected
connections service called from the accepting service — puts the acceptance and the edge in
two transactions, and a failure between them leaves an introduction that says `accepted`
with no connection and no way to retry, because answering is terminal-once. Here the
failure mode is a delivery still owed, which ADR-0006's retry and dead-letter path already
handles. The price is that the edge lands on the drainer's next round rather than
instantly, and the acceptance copy says so rather than promising otherwise.

**The consent inversion is preserved, not extended.** Nothing new is disclosed at
acceptance: the requester consented by asking, the via by passing it on under their own
name, and the target has already read both cards and both notes by the time this mutation
is reachable. D9 adds a *write* to the model, and the two cards D4 and D8 disclose remain
the only place a person is shown to somebody their own settings exclude.

**The target's refusal gets the protection the via's has, and this is the half that
constrains a read.** A via's decline is invisible to the target because somebody who can be
seen refusing cannot safely refuse; the identical argument makes a target's decline
invisible to the requester. So `intros.listOutbox` reports the **via's** decision and never
the target's answer — `accepted` and `target_declined` both project as `passed_on`, and no
answer time is carried — which means a declined introduction and one nobody has opened are
byte-identical on that read. An acceptance still reaches the requester: it discloses itself
by connecting, which is the target's own act rather than the read's.

**Two new statuses and a new timestamp, both deliberately not reuses.** `target_declined`
is not a second meaning for `declined` — that one says the via would not pass it on and the
target was never told — and collapsing them would silently widen every read filtering on
the first. `responded_at` is not a reuse of `decided_at`: they are two people's timestamps,
the interval between them is the only record of how long an introduction sat unanswered,
and `IntroAccepted.occurredAt` reads the target's, because an acceptance stamped with the
via's time would claim the target answered before they were shown anything.

**One CHECK had to move, and it would have failed silently.** `intro_requests_via_note` was
written as `via_note is null or status = 'passed_on'` when `passed_on` was terminal; an
accepted introduction carries the same vouch under a different status, so the un-widened
form refuses the very UPDATE that accepts it. It is still an implication rather than an
equality, for D8's original reason.

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

**Minting a bearer invite token when an introduction is passed on, and reusing
`connections.acceptInvite`.** Rejected in D9. It reuses a working write path, and that is
its only merit: a token is a transferable claim in a model where all three parties are
named, and it arrives with storage, expiry, revocation and leak questions that the
introduction row does not have. See product decision D12.

**Calling a `modules/connections` application service from the accepting service.**
Rejected in D9. It is the obvious shape and `pnpm boundaries` would permit it, which is
exactly why the reasoning has to be written down: the acceptance and the edge would land in
two transactions, and answering is terminal-once, so a failure between them is a connection
nobody can recover.

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
- The target-role cards are the **only** place in the system where a person is disclosed to
  somebody their own visibility setting excludes — the requester's since #89, and the via's
  since D8. It is narrow (one row, one reader, only after the via acted) and it is
  projected rather than asserted, but it is a real widening of §6a's effect and any future
  person-disclosure surface must argue for itself separately rather than cite this one.
- **The vouch is written for one reader and stored beside the ask it answers.** `via_note`
  is on the same row as `note`, so a future read that forgot which is which would attribute
  a via's words to the requester. The two are separate wire fields with separate cards for
  that reason, and no read but the target's inbox carries either.
- **`app.connections` now has two writers, and one of them is an outbox consumer** (D9).
  `ConnectIntroducedPairHandler` is registered in `composition/container.ts`, and its
  absence is silent: `modules/intros` would still record the acceptance, nothing would
  throw, and the two people would simply never be connected.
  `container-notification-wiring.integration.test.ts` is the only check that can see it.
- **An accepted introduction connects on the drainer's next round, not on the request.**
  Bounded, self-healing, and stated in the copy ("you are being connected") rather than
  hidden behind a promise the write cannot keep. A client must re-read the graph rather
  than assume, and the e2e polls a reload for the same reason.
- **A target's answer is unreadable by anybody but the target.** That is deliberate and it
  costs something real: a requester whose introduction was refused waits on an answer that
  will never visibly come, exactly as this ADR's founding invariant makes a via's decline
  final in silence. The alternative makes refusing unsafe, and an introduction that cannot
  safely be refused is an obligation.
- `EXPECTED_PROCEDURE_COUNT` moved 29 → 34 with #89's five procedures, and D9's
  `intros.respond` moves it once more — to 36, since a procedure outside this feature
  landed in between. The contracts spec carries six intros keys.

## Verification

| # | Claim | Evidence |
|---|---|---|
| 1 | The table carries the §4 backstop, exactly one policy, `app_rw`-only grants, all five CHECKs (D8 adds `intro_requests_via_note`, an implication rather than an equality; D9 adds `intro_requests_responded_at`, an equality, and widens the other two), and the partial open-per-pair index | `modules/intros/tests/integration/intro-requests-migration.integration.test.ts` |
| 2 | The function is `SECURITY INVOKER`, `search_path = ''`, `STABLE`, and byte-identical to its checked-in source in exactly one migration | same suite |
| 3 | Eligibility composes `app.visible_people` on both sides and names neither `app.connections` nor `app.users` | `intro-via-candidates-sql-composition.unit.test.ts`; `tests/fitness/sql-table-ownership.fitness.test.ts`'s intros block, with **no** allowlist entry |
| 4 | Nine ineligible shapes each return an empty set rather than an error | `intro-via-candidates.integration.test.ts` |
| 5 | Seven ineligible targets, and a bad via versus a non-existent one, are indistinguishable | `request-an-intro.integration.test.ts` — serialized into a `Set` asserted to hold one element |
| 6 | A lapsed pass-on is refused and a decline still succeeds | same suite, AC7 scenarios |
| 7 | After a decline, every intros read answers the target exactly as it answers a control in the same graph position | same suite — `toEqual` against `seedSymmetricWorld()`'s never-asked control, with a control-of-the-control proving the control is not empty everywhere |
| 8 | The consent inversion works, and withdraws when the requester deactivates | same suite, AC11 scenarios — including a direct assertion that `app.visible_people(target)` does not contain the requester |
| 9 | Events ride the same transaction and carry no note | same suite — a forced `CHECK` on `app.outbox_events` proves the rollback; `intro-request.events.unit.test.ts` asserts over `JSON.stringify` |
| 10 | Contract and router agree | `tests/fitness/contracts-api-parity.fitness.test.ts` at `EXPECTED_PROCEDURE_COUNT` 36 |
| 11 | No procedure accepts a viewer identifier | `tests/fitness/viewer-id-provenance.fitness.test.ts`, walking the registered intros router |
| 12 | The web surface states the consent before send | `intro-copy.ts`'s `INTRO_CONSENT_LINE`, rendered by `intro-sheet.tsx` above the note field; `intro-sheet.unit.test.tsx` asserts it on screen before the send is pressable |
| 13 | A pass-on requires a note and a decline refuses one, at the wire and in the domain | `decide-intro.input.unit.test.ts` (the union, and the decline arm's `strictObject` refusing rather than stripping); `intro-note.policy.unit.test.ts`'s `validateViaNote` block; `request-an-intro.integration.test.ts`'s #175 scenarios, which write the ill-typed shapes past the compiler with `as never` |
| 14 | The target reads both notes, each attributed, and the via's card survives a severed connection but not a deactivation | `request-an-intro.integration.test.ts` — the AC9 scenario plus "names the via from their own self-projection" and "leaves the vouch standing, unattributed"; `intro-inbox.unit.test.tsx` renders the two notes under two cards |
| 15 | Neither note reaches the requester's record, an outbox payload, or a log line | same suite — **two** distinctive phrases, one per author, so a check that dropped one and kept the other cannot pass |
| 16 | Only the target answers, only from `passed_on`, and only once — with "the via declined it" refused identically to "no such introduction" | `request-an-intro.integration.test.ts`'s #166 scenarios — three one-element `Set`s, plus a race leaving one winner |
| 17 | Accepting connects the two at an accepted invite's own disclosure, and the **event** is what does it | same suite — the pair is asserted unconnected after the acceptance and connected only after the event is delivered; `app.visible_people` then answers with each on the other's graph at degree 1 |
| 18 | Declining, and not answering, connect nobody — with every event delivered, not just the acceptance | same suite |
| 19 | Delivery is idempotent: a redelivery and a second event for an already-connected pair each add no row and announce no second `ConnectionAccepted` | same suite |
| 20 | The requester cannot tell a decline from an unanswered introduction | same suite — `toEqual` between the two outbox rows with only id, person and the via's own timestamps set aside, plus an acceptance reading identically |
| 21 | The drainer this container builds actually forms the connection | `composition/container-notification-wiring.integration.test.ts` — the only proof of registration, and the failure it catches is silent |
| 22 | The payload is read as a pair or refused, never guessed | `modules/connections/tests/domain/introduced-pair.unit.test.ts` |
| 23 | The wire refuses a note, a self-named status, and every spelling of an actor id on the answer | `modules/intros/tests/unit/respond-to-intro.input.unit.test.ts`; the two vocabularies stay disjoint in `intro-response.unit.test.ts` |
| 24 | The target's row offers Accept and Decline, reaches `intros.respond` and never `intros.decide`, and says a refusal reaches nobody before it is pressed | `apps/web/src/app/intros/{intro-inbox,intro-copy}.unit.test.ts(x)`; browser walk in `tests/e2e/intro-request.spec.ts` |
