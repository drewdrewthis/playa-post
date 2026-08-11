# `modules/intros` tests

Beside the code they test, not in a top-level `tests/` tree: a module's suites move,
split, and get deleted with the module.

**The filename is the price** (`CLAUDE.md`, "Conventions"). `*.integration.test.ts` runs
in the `integration` vitest project against a Testcontainers Postgres with
`supabase/migrations` applied; `*.unit.test.ts` runs in `unit` with no infrastructure at
all. Nothing here needs `pnpm db:start`.

| Directory | Suite | Feature-file scenarios |
|---|---|---|
| `integration/` | `intro-requests-migration.integration.test.ts` | `app.intro_requests`' and `app.intro_via_candidates`' catalog shape — RLS backstop and exactly one policy, table and EXECUTE grants (both halves), `SECURITY INVOKER`, `SET search_path = ''`, `STABLE`, the verbatim-migration pairing, the five CHECKs (#166 adds `intro_requests_responded_at` and widens two), the partial open-per-pair index, and the no-tsvector and no-index facts about both note columns and `responded_at` |
| `integration/` | `intro-via-candidates.integration.test.ts` | the eligibility set itself — the eligible A—B—C shape, several shared vias, §6a projection of a `limited` via, and nine ineligible shapes that must each be an **empty set rather than an error** |
| `integration/` | `request-an-intro.integration.test.ts` | `request-an-intro.feature` — every `@integration` scenario: lifecycle, the seven-way refusal matrix, the open-per-pair rule and both concurrency races, decide authorization, lapsed eligibility, the two privacy invariants, both consent inversions, content-before-eligibility ordering, outbox atomicity and minimisation, the requester's own record, #175's required via note, and #166's target answer — including the **connection itself**, formed by delivering `IntroAccepted` to `modules/connections`' own consumer |
| `unit/` | `intro-note.policy.unit.test.ts` | `request-an-intro.feature` › "The intro note is trimmed, bounded, and never empty", and #175's "Passing an intro on requires a note of the via's own" / "A decline carries no note" — `validateViaNote` is the one function that branches on the decision |
| `unit/` | `decide-intro.input.unit.test.ts` | the wire half of #175: a discriminated union on `decision`, whose decline arm is a `strictObject` so a note there is **refused rather than stripped**, and `decideIntroCommandFields` omitting the key entirely rather than passing `undefined` |
| `unit/` | `intro-request.events.unit.test.ts` | the four event builders carry four identifiers and never either note, take their timestamps from the committed row (`introResponded` from `responded_at`, never the via's `decided_at`), and each refuses a row the other one owns |
| `unit/` | `intro-response.unit.test.ts` | #166's vocabulary — `INTRO_RESPONSE` disjoint from `INTRO_DECISION`, `STATUS_FOR_RESPONSE` total and producing statuses no via decision produces, `ANSWERED_STATUSES` derived rather than restated, and `INTRO_UNAVAILABLE` still the one refusal, wording nothing |
| `unit/` | `respond-to-intro.input.unit.test.ts` | the wire half of #166: one `strictObject` with an enum rather than a union, refusing a note, a self-named `status`, a via's `pass_on`, and every spelling of an actor identifier |
| `unit/` | `intro-via-candidates-sql-composition.unit.test.ts` | the checked-in `persistence/sql/intro-via-candidates.sql` composes `app.visible_people` on **both** sides, joins neither `app.connections` nor `app.users`, gates the target at degree 2 and the candidate at degree 1, and inner-joins the two sides |

**Three assertion shapes carry most of the weight, and none of them is "an error was
thrown":**

| Shape | Why it, and not the obvious thing |
|---|---|
| **Zero rows *and* zero outbox events** | "Refused" and "refused without writing anything" are different claims. Only the second says the gate is inside the statement rather than in front of it |
| **A one-element `Set` of serialized refusals** | Seven ineligible targets, and separately a bad via versus a non-existent one. Any difference at all turns the endpoint into a user-existence *and* a graph-shape oracle in a product with no people search (ADR-0002 §10, B17). Wording several messages identically is a property that holds until somebody improves one of them; a `Set` is a property that holds |
| **`toEqual` against a control in the same graph position** | `seedSymmetricWorld()` puts three people at degree 2 from the requester through the same via. The target, the never-asked control and the uninvolved fourth party are then interchangeable *except* for the intro, so deep equality measures the rule and not the fixture. An absent-field check would go green the day a field is renamed |

**The two privacy invariants pull in opposite directions, and both are asserted:**

| Invariant | Where it is proved |
|---|---|
| A declined request is invisible to its target **forever** | "A declined request is invisible to its target forever" — every intros read for the target deep-equals the control's, with a control-of-the-control asserting the control is not itself empty everywhere |
| Asking **is** consent to be seen | "Asking is consent to be seen" — the requester sets their own reach to first degree, the suite proves `app.visible_people(target)` does not contain them, and the target is still shown their card after the pass-on. The card comes from `app.visible_people(requester, 0, 1)` — the requester's own self-projection — so §6a's "no direct join to `app.users` for a person card" holds even here |
| Passing on **is** consent to be named as the via (#175) | "names the via from their own self-projection, not from the target's world" — the via and target are severed *after* the introduction, the suite proves `app.visible_people(target)` no longer contains the via, and the vouch is still signed. The alternative leaves an unattributed note on the row, which is worse than no note |

**Two claims are asserted over storage or capture rather than over a response**, because
both are about something that outlives the request:

| Claim | Where it is proved |
|---|---|
| A note's text never reaches `app.outbox_events` | "Events ride the same transaction and carry no note" — asserted over the serialized whole rows, not just the payloads |
| A note's text never reaches a log line | the same scenario's log capture, which first writes a deliberate probe line through the same logger and asserts the capture saw it. A capture that received nothing satisfies "no line contains the note" forever while proving nothing |

⚠ **Two distinctive phrases since #175, one per note.** The row now carries the requester's
ask *and* the via's vouch, written by two people, so every "the text never reaches here"
assertion names both. A single-phrase version of those checks goes green against an outbox
payload or a log line that dropped one note and kept the other — and the via's is the one a
notification consumer would most want to quote.

**Outbox atomicity is proved by a forced failure, not by inspection.** A `CHECK
(event_type not like 'Intro%')` is added to `app.outbox_events` for the duration of one
test, so the intro row is already inserted when the event write fails — a green
"zero rows, zero events" is then evidence of a rollback rather than of a refusal. The
constraint is dropped in a `finally`, and the same write is re-run afterwards to prove the
path was not left broken.

**The connection an acceptance forms is asserted here, in another module's table, and the
delivery is driven by hand.** Decision D12 routes it through the `IntroAccepted` outbox
event, so this suite constructs `modules/connections`' consumer and offers it **every**
stored event — a consumer that had started acting on `IntroTargetDeclined` would connect
people, and offering it only the acceptance would never find that out. Two things the hand
delivery cannot prove, and their homes:

| Claim | Where it is proved |
|---|---|
| The composition root actually registers that consumer | `apps/server/src/composition/container-notification-wiring.integration.test.ts` — its absence is silent: the acceptance still records, nothing throws, and the two people are simply never connected |
| The payload is read as a pair or refused, never guessed | `modules/connections/tests/domain/introduced-pair.unit.test.ts` |

⚠ **`connectionsBetween(a, b)` rather than a bare `app.connections` count.**
`seedSymmetricWorld()` lays down four connections of its own, so a table-wide count would
be measuring the fixture; the pair query is order-agnostic for the same reason
`app.visible_people` walks both directions. A separate `connectionCount()` covers "and
nowhere else either".

**The eligibility gate has no unit suite, deliberately.** "May these three people be
introduced" is one `WHERE EXISTS` over `app.intro_via_candidates` inside the insert, and
one more inside the pass-on — it exists only in SQL, so a unit test could only assert
against a fake that reimplements it and would go green on exactly the bug that matters.
`intro-via-candidates.integration.test.ts` and the refusal matrix are that rule's only
real proof.

`tests/fitness/sql-table-ownership.fitness.test.ts` carries the other half: that no
checked-in `.sql` file here ever names `app.connections` or `app.users`. That is the most
tempting shortcut in the repository so far — "is this via connected to the target" reads
like one join against `app.connections` — and taking it would put a second definition of
reachability inside the one module whose job is putting two strangers in touch (ADR-0002
§6, R2).
