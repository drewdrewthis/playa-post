# `modules/intros` tests

Beside the code they test, not in a top-level `tests/` tree: a module's suites move,
split, and get deleted with the module.

**The filename is the price** (`CLAUDE.md`, "Conventions"). `*.integration.test.ts` runs
in the `integration` vitest project against a Testcontainers Postgres with
`supabase/migrations` applied; `*.unit.test.ts` runs in `unit` with no infrastructure at
all. Nothing here needs `pnpm db:start`.

| Directory | Suite | Feature-file scenarios |
|---|---|---|
| `integration/` | `intro-requests-migration.integration.test.ts` | `app.intro_requests`' and `app.intro_via_candidates`' catalog shape — RLS backstop and exactly one policy, table and EXECUTE grants (both halves), `SECURITY INVOKER`, `SET search_path = ''`, `STABLE`, the verbatim-migration pairing, the three CHECKs, the partial open-per-pair index, and the no-tsvector fact |
| `integration/` | `intro-via-candidates.integration.test.ts` | the eligibility set itself — the eligible A—B—C shape, several shared vias, §6a projection of a `limited` via, and nine ineligible shapes that must each be an **empty set rather than an error** |
| `integration/` | `request-an-intro.integration.test.ts` | `request-an-intro.feature` — the fifteen `@integration` scenarios: lifecycle, the seven-way refusal matrix, the open-per-pair rule and both concurrency races, decide authorization, lapsed eligibility, the two privacy invariants, the consent inversion, content-before-eligibility ordering, outbox atomicity and minimisation, and the requester's own record |
| `unit/` | `intro-note.policy.unit.test.ts` | `request-an-intro.feature` › "The intro note is trimmed, bounded, and never empty" |
| `unit/` | `intro-request.events.unit.test.ts` | the three event builders carry four identifiers and never the note, take their timestamps from the committed row, and refuse to describe an undecided row as decided |
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

**Two claims are asserted over storage or capture rather than over a response**, because
both are about something that outlives the request:

| Claim | Where it is proved |
|---|---|
| A note's text never reaches `app.outbox_events` | "Events ride the same transaction and carry no note" — asserted over the serialized whole rows, not just the payloads |
| A note's text never reaches a log line | the same scenario's log capture, which first writes a deliberate probe line through the same logger and asserts the capture saw it. A capture that received nothing satisfies "no line contains the note" forever while proving nothing |

**Outbox atomicity is proved by a forced failure, not by inspection.** A `CHECK
(event_type not like 'Intro%')` is added to `app.outbox_events` for the duration of one
test, so the intro row is already inserted when the event write fails — a green
"zero rows, zero events" is then evidence of a rollback rather than of a refusal. The
constraint is dropped in a `finally`, and the same write is re-run afterwards to prove the
path was not left broken.

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
