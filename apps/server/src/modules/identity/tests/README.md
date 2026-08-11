# `modules/identity` tests

Beside the code they test, not in a top-level `tests/` tree: a module's suites move,
split, and get deleted with the module.

**The filename is the price** (`CLAUDE.md`, "Conventions"). `*.unit.test.ts` runs in
the `unit` vitest project and touches no infrastructure; `*.integration.test.ts` runs
in `integration` against a Testcontainers Postgres with `supabase/migrations` applied.
Nothing here needs `pnpm db:start`.

| Directory | Suite | Feature-file scenarios |
|---|---|---|
| `application/` | `resolve-actor.query.unit.test.ts` | ADR-0008 rule 8 over a fake repository: the internal id resolved and never the auth user id (rule 2), `null` for an account that is unonboarded, deactivated, suspended or erased, and `null` for a status the rule has never heard of |
| `application/` | `update-display-name.service.unit.test.ts` | `edit-display-name.feature`'s `@unit` rename scenarios (#177) — the stored row's value answered rather than the argument it was handed, handle/visibility/lifecycle columns left exactly as they were (ADR-0008 rule 4), one actor renamed and no other, and a refusal rather than an invented row when the account is erased mid-request |
| `domain/` | `handle.policy.unit.test.ts` | the three `@unit` handle rules — reserved, charset, over-length |
| `domain/` | `visible-to-distance.unit.test.ts` | the application half of `app.visible_people`'s fail-closed `else 1`: an unrecognised stored value — including an `Object.prototype` member name — reads as `first` and never as the ceiling. The check constraint makes this branch unreachable from any integration test, which is why it is pure logic (PR #78) |
| `integration/` | `handle-uniqueness.integration.test.ts` | case collision, confusable, `HANDLE_IMMUTABLE` |
| `integration/` | `actor-resolution.integration.test.ts` | the three `@integration` auth-boundary scenarios (M2-AC2) |
| `integration/` | `app-users-migration.integration.test.ts` | the `app.users` migration's catalog shape (ADR-0008:22-34) |
| `integration/` | `visible-to-distance.integration.test.ts` | M5-B1a — the `visible_to_distance` column (migration 20260809140000), the repository write behind `identity.visibility.set`, and both of their effects on `app.visible_people`: multi-hop reach, and *absence* rather than an unnamed node once a person's own limit puts the viewer too far away |
| `integration/` | `edit-display-name.integration.test.ts` | `edit-display-name.feature`'s eleven `@integration` scenarios (#177) — driven through the module's own router, so one identical payload renames two different callers and a payload naming somebody else is refused rather than stripped; the handle survives the rename and still resolves; AC5 against the real §6a projection, both where it discloses a name and where it withholds one |
| `transport/` | `update-display-name.input.unit.test.ts` | `edit-display-name.feature`'s `@unit` schema scenarios (#177) — the edit's verdict asserted against *onboarding's own*, trimming as part of the rule, and the `strictObject` refusals of a supplied identifier or handle |

The split is not a preference. `citext` case-collision and confusable-normalization
are questions about *other rows*, so they cannot be answered without a database;
length, charset, and the reserved-word blocklist are questions about the submitted
string alone, which is what keeps `domain/handle.policy.ts` free of I/O.

**The rename splits the same way, along its own seam** (#177, decision D15). What a
display name may *be* is one schema shared with `identity.completeOnboarding`, so the
`transport/` suite asserts the edit's verdict against onboarding's verdict rather than
against copied literals — the only shape of test that fails when the two drift apart,
which is the whole point of there being one schema. Who may rename *whom* is a question
about the actor the transport resolved and the row the database holds, so it belongs to
`edit-display-name.integration.test.ts` alone: a fake repository could only answer it by
reimplementing the `WHERE id = …` that is the entire rule, and would go green on exactly
the bug that matters.
