# Migrations

Empty on purpose. M1 ships no schema — the first tables land in M2 with the
identity and connections modules.

## The workflow

Migrations are **checked-in SQL files, applied in filename order**. The Supabase
CLI owns them; we do not write a migration runner (addendum §18 forbids building
one).

```bash
supabase start                      # boot local Postgres, Auth, Storage, Studio
supabase migration new add_bulletins # creates <timestamp>_add_bulletins.sql
$EDITOR supabase/migrations/<timestamp>_add_bulletins.sql
supabase db reset                   # drop, re-apply every migration, re-seed
```

`supabase db reset` is the check that matters: it replays the whole history from
scratch. A migration that only works against *your* database is a migration that
will fail in CI and in production.

## Rules

| Rule | Why |
|---|---|
| **Filenames are `<timestamp>_<verb>_<subject>.sql`** | The timestamp is the ordering. The CLI generates it — never rename one. |
| **Never edit a migration that has been merged** | It has already run somewhere. Write a new one. |
| **Forward-only** | No down-migrations. Reversing a schema change is a new migration written deliberately, not an auto-generated guess. |
| **Product tables go in schema `app`** | `app` is not exposed to PostgREST (see `../config.toml`), which is the first layer of ADR-0002's authorization model. |
| **RLS on, deny-by-default, on every product table** | The backstop for when application-side authorization has a bug. Enabling it later means auditing every table at once. |
| **Visibility logic goes in checked-in SQL functions, not in the app** | Addendum §15: visibility is enforced before data leaves the database, and §9: all SQL lives in a repository, a query, a checked-in `.sql` file, or a migration. |
| **A schema change ships with its integration test** | Addendum §25. `packages/testing` runs this directory against a throwaway Postgres 16 container, so the test is cheap. |

## How tests see this directory

`startPostgresTestDatabase({ migrationsDirectory })` from `@playa-post/testing`
boots `postgres:16`, applies every `.sql` file here in lexical order, and hands
back a connection. Same files, same order, throwaway database — so an integration
test proves the migration, not a hand-maintained fixture schema.

An absent or empty directory is not an error: it yields a schemaless database,
which is exactly what M1 has.
