# Migrations

One migration: `*_create_security_baseline.sql`, the ADR-0002 privilege model that
every later migration inherits. Product tables land in M2 with the identity and
connections modules.

## Every product table calls the backstop

The security baseline defines `app.apply_rls_backstop(regclass)`. A migration that
adds a product table **must** call it:

```sql
create table app.bulletins ( … );
select app.apply_rls_backstop('app.bulletins');
grant select, insert, update, delete on table app.bulletins to app_rw;
-- and, for a bigserial/identity column:
grant usage, select on sequence app.bulletins_id_seq to app_rw;
```

The function applies ADR-0002 §4 verbatim — `ENABLE` + `FORCE ROW LEVEL SECURITY`,
the single `app_rw_full_access` policy, and its comment — so the four statements
live in one place and cannot drift table by table. Grants stay explicit and
per-table: §2 forbids a blanket `ALL ON ALL TABLES`, and a missing sequence grant
fails inserts at deploy time, where the field fix under pressure is `GRANT ALL`.

`tests/security/` reads the catalog, not this file. A table that skips the call
fails B3 — as does one that calls it and then drifts.

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
| **`app_migrator` must never create objects outside schema `app`** | Its default-privilege revokes are declared per-role and **globally**, not `IN SCHEMA app` — the schema-scoped form cannot revoke a hard-wired default at all (ADR-0002 §3). The cost of the form that works is reach: anything `app_migrator` creates elsewhere, e.g. a `CREATE EXTENSION` landing in `public`, silently loses its `PUBLIC` grants too. Create outside `app` as a different role. |
| **RLS on, deny-by-default, on every product table** | The backstop for when application-side authorization has a bug. Enabling it later means auditing every table at once. |
| **Visibility logic goes in checked-in SQL functions, not in the app** | Addendum §15: visibility is enforced before data leaves the database, and §9: all SQL lives in a repository, a query, a checked-in `.sql` file, or a migration. |
| **A schema change ships with its integration test** | Addendum §25. `packages/testing` runs this directory against a throwaway Postgres 17 container, so the test is cheap. |

## How tests see this directory

`startPostgresTestDatabase({ migrationsDirectory })` from `@playa-post/testing`
boots `postgres:17`, applies every `.sql` file here in lexical order, and hands
back a connection. Same files, same order, throwaway database — so an integration
test proves the migration, not a hand-maintained fixture schema.

An absent or empty directory is not an error: it yields a schemaless database,
which is exactly what M1 has.
