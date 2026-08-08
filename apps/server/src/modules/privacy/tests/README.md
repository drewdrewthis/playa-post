# `modules/privacy` tests

Beside the code they test, not in a top-level `tests/` tree: a module's suites move,
split, and get deleted with the module.

**The filename is the price** (`CLAUDE.md`, "Conventions"). `*.unit.test.ts` runs in the
`unit` project with no infrastructure; `*.integration.test.ts` runs in `integration`
against a Testcontainers Postgres with `supabase/migrations` applied. Nothing here needs
`pnpm db:start`.

| Directory | Suite | What it proves |
|---|---|---|
| `unit/` | `privacy-limits.unit.test.ts` | The stored vocabulary and the permissive default — the domain rule `app.privacy_settings`' check constraints back |
| `integration/` | `privacy-limits.integration.test.ts` | The row round-trips, an absent row reads as the permissive default, and the constraints agree with the domain |
| `integration/` | `name-disclosure-limit.integration.test.ts` | **The setting is real**: a tightened name limit changes what `app.visible_people` discloses |

The split between the two integration suites is deliberate. The first can be read as "does
this module store what it was told"; the second is the only one that answers "and does
anything happen as a result", which is the question a privacy control lives or dies on. It
reads through `graph.module.ts`'s public `visiblePeople` — never `graph/persistence/`,
which `no-cross-module-persistence` forbids — so it exercises the same §6a projection every
other consumer does.

There is deliberately **no suite here for the note limit's enforcement.** `app.bulletins`
has no recipient column, so nobody can pin to anybody's board and there is nothing to
enforce yet; `name-disclosure-limit.integration.test.ts` asserts only that tightening it
leaves name disclosure alone. The migration that gives a bulletin a recipient owes both the
enforcement point and its test.
