# `@playa-post/database`

The typed handle on PostgreSQL, and the generated description of what is in it.

```ts
import { createDatabaseConnection, type Database } from '@playa-post/database';

const database = createDatabaseConnection({ connectionString: config.databaseUrl });
```

Two exports do all the work: `createDatabaseConnection`, which builds a pooled
`Kysely<Database>`, and `Database`, generated from the real schema by
`pnpm db:types` and checked in.

## The connection string is the security boundary

ADR-0002 puts the entire database-side backstop on **which role the URI names**.
`app_rw` is non-owning, `nobypassrls`, and holds per-table DML grants only, so
`FORCE ROW LEVEL SECURITY` applies to every statement the application issues.
Connect as the schema owner or as a superuser and RLS stops applying — with no
error, no log line, and no failing test outside `tests/security/`.

`createDatabaseConnection` takes the string and nothing else. It reads no
environment variable, because only `composition/` may (addendum §17): a package
that resolves its own credentials is a package you cannot point at a throwaway
container.

## Regenerating the types

```bash
pnpm db:start     # boot the local Supabase stack
pnpm db:migrate   # apply pending migrations   (or pnpm db:reset to replay all of them)
pnpm db:types     # rewrite src/schema.ts from the live database
git diff --exit-code packages/database/src/schema.ts
```

`pnpm db:types` asks the Supabase CLI where the local database is rather than
restating its port or its credentials — `supabase status -o env` is the source of
truth for both. The cost of that is a poor error when the stack is down: the CLI
prints `failed to inspect container health`, and the generator then dies with
`ReferenceError: Environment variable 'DATABASE_URL' could not be found`. Both
mean **run `pnpm db:start` first**.

To generate against some other database, run the package's own script with your
own URL:

```bash
DATABASE_URL=postgres://… pnpm --filter @playa-post/database db:types
```

Every flag lives in [`.kysely-codegenrc.json`](.kysely-codegenrc.json), not in a
script, so the command a developer runs and the check CI runs cannot describe
different schemas. `includePattern: "app.*"` is why the file contains product
tables only: the local stack also carries Supabase's own `auth`, `storage`, and
`realtime` schemas, and none of them are ours to model.

**`src/schema.ts` is generated. Never hand-edit it** — the next `pnpm db:types`
silently discards the change, and the drift check will not tell you which of the
two was right.

## Drift is checked in CI, without the Supabase stack

`src/database-schema.integration.test.ts` boots the Testcontainers Postgres from
`@playa-post/testing`, applies `supabase/migrations`, and runs the same generator
in `--verify` mode. It runs in the existing `test:integration` job — no Supabase
CLI, no second CI harness.

That substitution is only legitimate because both paths apply the same checked-in
SQL, and it was measured, not assumed: `--verify` passes against the local
Supabase stack and against the throwaway container from the same `src/schema.ts`.
The suite also creates a table the types do not declare and asserts verification
*fails*, so a check that has quietly stopped checking fails the build.

## Why `kysely-codegen`

`supabase gen types typescript` emits the PostgREST-shaped `Database` type —
`Tables<'x'>['Row' | 'Insert' | 'Update']` — which Kysely cannot consume. Adopting
it would mean hand-writing and maintaining a translation layer, and addendum §18
prefers a proven library over exactly that. `kysely-codegen` emits Kysely's own
interface shape, with `Generated<T>` and `ColumnType<S, I, U>` already correct.

The two tools also disagree about `app`: `gen types` reads the schemas exposed to
PostgREST, and `app` is deliberately not one of them (ADR-0002 §1). It is the
wrong tool for this schema in particular, not only in general.

## Not here yet

| Thing | Lands in |
|---|---|
| `seed/` and `sql/` | with the first seed and the first checked-in query — a directory is created when a real file lands in it (addendum §4) |
| Kysely query/error events routed into the structured logger | `packages/observability` (M1b.4). The default logger prints errors to `console.error`; silencing it before a replacement exists would remove the only signal there is. |
| `no-sql-outside-persistence` | L1, with the first repository |
